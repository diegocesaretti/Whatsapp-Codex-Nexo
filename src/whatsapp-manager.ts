import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  fetchLatestWaWebVersion,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
  type WAMessage,
} from "baileys";
import pino from "pino";
import * as QRCode from "qrcode";
import { randomUUID } from "node:crypto";
import { OutputConversationStore } from "./output-conversation-store.js";
import { isAuthorizedPhone, phoneNumberFromJid, safePhoneJid } from "./output-conversation-auth.js";
import { AppSettingsStore } from "./settings.js";
import { SolPluginClient } from "./sol-plugin-client.js";
import { BridgeStore } from "./store.js";
import {
  detectWhatsappMessageType,
  extractWhatsappText,
  normalizeSendTarget,
  shouldIgnoreJid,
  whatsappTimestamp,
} from "./message.js";
import type {
  AccountRecord,
  OutboundAudit,
  OutboundReplyContext,
  OutputConversationMessage,
  RuntimeStatus,
  StoredMessage,
} from "./types.js";

type Socket = ReturnType<typeof makeWASocket>;
type WaWebVersion = Awaited<ReturnType<typeof fetchLatestWaWebVersion>>["version"];
type OutputPresence = "available" | "unavailable" | "composing" | "paused";
type ExtendedMessageKey = WAMessage["key"] & {
  remoteJidAlt?: string | null;
  participantAlt?: string | null;
  addressingMode?: string | null;
};

interface RuntimeSession {
  accountId: string;
  socket?: Socket;
  state: RuntimeStatus["state"];
  qrDataUrl?: string;
  phoneJid?: string;
  displayName?: string;
  reconnectAttempt: number;
  lastError?: string;
  updatedAt: Date;
  manualStop: boolean;
  generation: number;
  reconnectTimer?: NodeJS.Timeout;
  queue: Promise<void>;
  receivedMessages: number;
  storedMessages: number;
  historyMessages: number;
  lastMessageAt?: Date;
}

const logger = pino({ level: "silent" });
const NON_RECONNECTABLE = new Set<number>([
  DisconnectReason.loggedOut,
  DisconnectReason.badSession,
  DisconnectReason.connectionReplaced,
  DisconnectReason.forbidden,
  DisconnectReason.multideviceMismatch,
]);

let waVersionPromise: Promise<WaWebVersion | undefined> | undefined;

async function resolveWaWebVersion(): Promise<WaWebVersion | undefined> {
  if (!waVersionPromise) {
    waVersionPromise = (async () => {
      try {
        const latest = await fetchLatestWaWebVersion();
        console.log(`[whatsapp] using live WA Web version ${latest.version.join(".")}`);
        return latest.version;
      } catch (liveError) {
        console.warn("[whatsapp] live WA Web version lookup failed; trying Baileys fallback", liveError);
        try {
          const fallback = await fetchLatestBaileysVersion();
          console.log(`[whatsapp] using Baileys fallback version ${fallback.version.join(".")}`);
          return fallback.version;
        } catch (fallbackError) {
          console.warn("[whatsapp] WA version lookup failed; using library default", fallbackError);
          return undefined;
        }
      }
    })();
  }
  return waVersionPromise;
}

function disconnectStatusCode(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const value = error as { output?: { statusCode?: number }; statusCode?: number };
  return value.output?.statusCode ?? value.statusCode;
}

function disconnectMessage(error: unknown): string | undefined {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message ?? "");
  }
  return undefined;
}

function pairingError(statusCode: number | undefined, message: string | undefined): string | undefined {
  if (statusCode === 405) {
    return `WhatsApp rejected the pairing client (405/client_too_old). Nexo resolved the live WA Web version and will retry${message ? `: ${message}` : "."}`;
  }
  if (statusCode === 428) {
    return `WhatsApp terminated the pairing handshake (428). Nexo now advertises a WEB_BROWSER profile instead of Windows Desktop${message ? `: ${message}` : "."}`;
  }
  if (statusCode !== undefined) return message || `WhatsApp disconnected with status ${statusCode}`;
  return message;
}

function isOutputConversationMessage(
  account: AccountRecord,
  message: StoredMessage,
  outputAccount?: AccountRecord,
): boolean {
  if (account.role !== "input" || !outputAccount?.phoneJid) return false;
  const outputPhone = phoneNumberFromJid(outputAccount.phoneJid);
  if (!outputPhone) return false;
  return [message.chatJid, message.chatAltJid, message.senderJid, message.senderAltJid]
    .some((jid) => phoneNumberFromJid(jid) === outputPhone);
}

export class WhatsappManager {
  private readonly runtimes = new Map<string, RuntimeSession>();

  constructor(
    private readonly store: BridgeStore,
    private readonly settingsStore: AppSettingsStore,
    private readonly outputConversationStore: OutputConversationStore,
    private readonly solPlugin?: SolPluginClient,
  ) {}

  private session(accountId: string): RuntimeSession {
    let runtime = this.runtimes.get(accountId);
    if (!runtime) {
      runtime = {
        accountId,
        state: "idle",
        reconnectAttempt: 0,
        updatedAt: new Date(),
        manualStop: false,
        generation: 0,
        queue: Promise.resolve(),
        receivedMessages: 0,
        storedMessages: 0,
        historyMessages: 0,
      };
      this.runtimes.set(accountId, runtime);
    }
    return runtime;
  }

  getStatus(accountId: string): RuntimeStatus {
    const runtime = this.session(accountId);
    return {
      accountId,
      state: runtime.state,
      qrDataUrl: runtime.qrDataUrl,
      phoneJid: runtime.phoneJid,
      displayName: runtime.displayName,
      reconnectAttempt: runtime.reconnectAttempt,
      lastError: runtime.lastError,
      updatedAt: runtime.updatedAt.toISOString(),
      receivedMessages: runtime.receivedMessages,
      storedMessages: runtime.storedMessages,
      historyMessages: runtime.historyMessages,
      lastMessageAt: runtime.lastMessageAt?.toISOString(),
    };
  }

  async startLinkedAccounts(): Promise<void> {
    const accounts = await this.store.listAccounts();
    for (const account of accounts) {
      if (account.enabled && account.linkedAt) {
        await this.start(account.id).catch((error) => {
          console.error(`[whatsapp] failed to auto-start ${account.label}`, error);
        });
      }
    }
  }

  async start(accountId: string): Promise<RuntimeStatus> {
    const account = await this.store.getAccount(accountId);
    if (!account) throw new Error("account_not_found");
    const runtime = this.session(accountId);
    runtime.manualStop = false;
    if (runtime.state === "open" || runtime.state === "connecting" || runtime.state === "qr" || runtime.state === "reconnecting") return this.getStatus(accountId);
    await this.connect(account, runtime);
    return this.getStatus(accountId);
  }

  async restart(accountId: string): Promise<RuntimeStatus> {
    await this.stop(accountId);
    const runtime = this.session(accountId);
    runtime.manualStop = false;
    const account = await this.store.getAccount(accountId);
    if (!account) throw new Error("account_not_found");
    await this.connect(account, runtime);
    return this.getStatus(accountId);
  }

  async stop(accountId: string): Promise<void> {
    const runtime = this.session(accountId);
    runtime.manualStop = true;
    runtime.generation += 1;
    if (runtime.reconnectTimer) clearTimeout(runtime.reconnectTimer);
    runtime.reconnectTimer = undefined;
    runtime.socket?.end(undefined);
    runtime.socket = undefined;
    runtime.state = "idle";
    runtime.qrDataUrl = undefined;
    runtime.updatedAt = new Date();
    await this.solPlugin?.setDisconnectedByAccountId(accountId).catch(() => undefined);
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.runtimes.keys()].map((accountId) => this.stop(accountId)));
  }

  async logout(accountId: string): Promise<void> {
    const account = await this.store.getAccount(accountId);
    if (!account) throw new Error("account_not_found");
    const runtime = this.session(accountId);
    runtime.manualStop = true;
    runtime.generation += 1;
    if (runtime.reconnectTimer) clearTimeout(runtime.reconnectTimer);
    runtime.reconnectTimer = undefined;
    try {
      await runtime.socket?.logout();
    } catch {}
    runtime.socket?.end(undefined);
    runtime.socket = undefined;
    runtime.state = "logged_out";
    runtime.qrDataUrl = undefined;
    runtime.phoneJid = undefined;
    runtime.displayName = undefined;
    runtime.updatedAt = new Date();
    await this.store.clearAuth(accountId);
    await this.store.updateAccount(accountId, { linkedAt: undefined, phoneJid: undefined, displayName: undefined });
    await this.solPlugin?.setDisconnectedByAccountId(accountId).catch(() => undefined);
  }

  async sendText(input: { to: string; text: string; reason?: string }): Promise<OutboundAudit> {
    const destination = normalizeSendTarget(input.to);
    const output = await this.store.getOutputAccount();
    if (!output) throw new Error("output_account_not_configured");
    const runtime = this.session(output.id);
    if (!runtime.socket || runtime.state !== "open") throw new Error("output_account_not_connected");
    const text = input.text.trim();
    if (!text) throw new Error("text_required");
    const sent = await runtime.socket.sendMessage(destination, { text });
    const audit: OutboundAudit = {
      id: randomUUID(),
      accountId: output.id,
      to: destination,
      text,
      reason: input.reason,
      messageId: sent?.key.id ?? undefined,
      sentAt: new Date().toISOString(),
    };
    await this.store.appendOutboundAudit(audit);
    return audit;
  }

  async replyToArchivedMessage(input: { storedMessageId: string; text: string; reason?: string }): Promise<OutboundAudit> {
    const context = await this.store.getReplyContext(input.storedMessageId);
    if (!context) throw new Error("stored_message_not_found");
    const destination = normalizeSendTarget(context.chatAltJid || context.chatJid);
    const output = await this.store.getOutputAccount();
    if (!output) throw new Error("output_account_not_configured");
    const runtime = this.session(output.id);
    if (!runtime.socket || runtime.state !== "open") throw new Error("output_account_not_connected");
    const text = input.text.trim();
    if (!text) throw new Error("text_required");
    const sent = await runtime.socket.sendMessage(destination, { text });
    const audit: OutboundAudit = {
      id: randomUUID(),
      accountId: output.id,
      to: destination,
      text,
      reason: input.reason,
      replyTo: context,
      messageId: sent?.key.id ?? undefined,
      sentAt: new Date().toISOString(),
    };
    await this.store.appendOutboundAudit(audit);
    return audit;
  }

  async replyToOutputConversationMessage(input: { inboundMessageId: string; text: string; reason?: string }): Promise<OutboundAudit> {
    const settings = await this.settingsStore.get();
    if (!settings.outputConversation.enabled) throw new Error("output_conversation_disabled");
    const inbound = await this.outputConversationStore.get(input.inboundMessageId);
    if (!inbound || inbound.direction !== "inbound") throw new Error("output_conversation_message_not_found");
    if (!inbound.authorized || !isAuthorizedPhone(settings.outputConversation.authorizedNumbers, inbound.peerPhone)) {
      throw new Error("output_conversation_sender_not_authorized");
    }
    const output = await this.store.getOutputAccount();
    if (!output) throw new Error("output_account_not_configured");
    const runtime = this.session(output.id);
    if (!runtime.socket || runtime.state !== "open") throw new Error("output_account_not_connected");
    const text = input.text.trim();
    if (!text) throw new Error("text_required");
    const sent = await runtime.socket.sendMessage(safePhoneJid(inbound.peerJid, inbound.peerAltJid) || `${inbound.peerPhone}@s.whatsapp.net`, { text });
    const audit: OutboundAudit = {
      id: randomUUID(),
      accountId: output.id,
      to: `${inbound.peerPhone}@s.whatsapp.net`,
      text,
      reason: input.reason,
      messageId: sent?.key.id ?? undefined,
      sentAt: new Date().toISOString(),
    };
    await this.store.appendOutboundAudit(audit);
    await this.outputConversationStore.append({
      id: `out:${audit.id}`,
      accountId: output.id,
      whatsappMessageId: audit.messageId || audit.id,
      peerJid: `${inbound.peerPhone}@s.whatsapp.net`,
      peerPhone: inbound.peerPhone,
      direction: "outbound",
      text,
      authorized: true,
      occurredAt: audit.sentAt,
      replyToId: inbound.id,
    });
    return audit;
  }

  async sendOutputPresence(peer: string, presence: OutputPresence): Promise<void> {
    const output = await this.store.getOutputAccount();
    if (!output) throw new Error("output_account_not_configured");
    const runtime = this.session(output.id);
    if (!runtime.socket || runtime.state !== "open") throw new Error("output_account_not_connected");
    const destination = normalizeSendTarget(peer);
    await runtime.socket.sendPresenceUpdate(presence, destination);
  }

  private async connect(account: AccountRecord, runtime: RuntimeSession): Promise<void> {
    runtime.generation += 1;
    const generation = runtime.generation;
    runtime.state = "connecting";
    runtime.lastError = undefined;
    runtime.updatedAt = new Date();

    const { state, saveCreds } = await useMultiFileAuthState(await this.store.authDirectory(account.id));
    const version = await resolveWaWebVersion();
    const socket = makeWASocket({
      ...(version ? { version } : {}),
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      browser: Browsers.macOS("Desktop"),
      logger,
      printQRInTerminal: false,
      syncFullHistory: account.role === "input",
      markOnlineOnConnect: false,
      generateHighQualityLinkPreview: false,
    });
    runtime.socket = socket;

    socket.ev.on("creds.update", saveCreds);
    socket.ev.on("connection.update", (update) => {
      void this.handleConnectionUpdate(account, runtime, generation, update);
    });
    socket.ev.on("messaging-history.set", ({ messages }) => {
      if (account.role !== "input") return;
      runtime.queue = runtime.queue.then(async () => {
        for (const message of messages) {
          await this.captureMessage(account, runtime, message, "history", runtime.phoneJid);
          runtime.historyMessages += 1;
        }
      }).catch((error) => {
        runtime.lastError = error instanceof Error ? error.message : String(error);
        runtime.updatedAt = new Date();
      });
    });
    socket.ev.on("messages.upsert", ({ messages }) => {
      runtime.queue = runtime.queue.then(async () => {
        for (const message of messages) {
          if (account.role === "output") {
            await this.captureOutputConversationMessage(account, runtime, message);
          } else {
            await this.captureMessage(account, runtime, message, "realtime", runtime.phoneJid);
          }
        }
      }).catch((error) => {
        runtime.lastError = error instanceof Error ? error.message : String(error);
        runtime.updatedAt = new Date();
      });
    });
  }

  private async handleConnectionUpdate(
    account: AccountRecord,
    runtime: RuntimeSession,
    generation: number,
    update: Record<string, any>,
  ): Promise<void> {
    if (runtime.generation !== generation) return;
    if (update.qr) {
      runtime.state = "qr";
      runtime.qrDataUrl = await QRCode.toDataURL(update.qr, { margin: 1, width: 320 });
      runtime.updatedAt = new Date();
    }
    if (update.connection === "open") {
      runtime.state = "open";
      runtime.qrDataUrl = undefined;
      runtime.reconnectAttempt = 0;
      runtime.lastError = undefined;
      runtime.phoneJid = safePhoneJid(runtime.socket?.user?.id, runtime.socket?.user?.lid) ?? runtime.socket?.user?.id ?? undefined;
      runtime.displayName = runtime.socket?.user?.name ?? undefined;
      runtime.updatedAt = new Date();
      await this.store.updateAccount(account.id, {
        linkedAt: account.linkedAt ?? new Date().toISOString(),
        phoneJid: runtime.phoneJid,
        displayName: runtime.displayName,
        lastError: undefined,
      });
      await this.settingsStore.syncInputIdentities(await this.store.listAccounts()).catch((error) => {
        console.error(`[identity] failed to sync linked INPUT identities after connecting ${account.label}`, error);
      });
      const sourceAccount = { ...account, phoneJid: runtime.phoneJid, displayName: runtime.displayName };
      await this.solPlugin?.setStatus(sourceAccount, "connected", new Date().toISOString()).catch((error) => {
        this.solPlugin?.reportHealth("degraded", { accountId: account.id, reason: String(error) });
      });
    }
    if (update.connection === "close") {
      await this.handleClose(account, runtime, generation, update.lastDisconnect?.error);
    }
  }

  private async captureOutputConversationMessage(
    account: AccountRecord,
    runtime: RuntimeSession,
    message: WAMessage,
  ): Promise<void> {
    const settings = await this.settingsStore.get();
    if (!settings.outputConversation.enabled) return;
    const key = message.key as ExtendedMessageKey;
    const chatJid = key.remoteJid;
    const whatsappMessageId = key.id;
    if (!chatJid || !whatsappMessageId || shouldIgnoreJid(chatJid) || chatJid.endsWith("@g.us")) return;
    const chatAltJid = key.remoteJidAlt ?? undefined;
    const fromMe = Boolean(key.fromMe);
    const peerPhone = phoneNumberFromJid(fromMe ? safePhoneJid(chatJid, chatAltJid) : safePhoneJid(key.participant, key.participantAlt, chatJid, chatAltJid));
    if (!peerPhone || !isAuthorizedPhone(settings.outputConversation.authorizedNumbers, peerPhone)) return;
    const stored: OutputConversationMessage = {
      id: `${account.id}:${chatJid}:${whatsappMessageId}:${fromMe ? "out" : "in"}`,
      accountId: account.id,
      whatsappMessageId,
      peerJid: chatJid,
      peerAltJid: chatAltJid,
      peerPhone,
      direction: fromMe ? "outbound" : "inbound",
      text: extractWhatsappText(message.message),
      messageType: detectWhatsappMessageType(message.message),
      senderName: fromMe ? account.displayName ?? runtime.displayName : message.pushName ?? undefined,
      authorized: true,
      occurredAt: whatsappTimestamp(message.messageTimestamp).toISOString(),
    };
    await this.outputConversationStore.append(stored);
  }

  private async captureMessage(
    account: AccountRecord,
    runtime: RuntimeSession,
    message: WAMessage,
    origin: StoredMessage["origin"],
    ownJid?: string,
  ): Promise<void> {
    const key = message.key as ExtendedMessageKey;
    const chatJid = key.remoteJid;
    const sourceMessageId = key.id;
    if (!chatJid || !sourceMessageId || shouldIgnoreJid(chatJid)) return;
    const chatAltJid = key.remoteJidAlt ?? undefined;
    const chatName =
      (await this.store.chatName(account.id, chatJid)) ??
      (chatAltJid ? await this.store.chatName(account.id, chatAltJid) : undefined);
    const fromMe = Boolean(key.fromMe);
    const senderJid = key.participant ?? (fromMe ? ownJid : chatJid) ?? undefined;
    const senderAltJid =
      key.participantAlt ??
      (!fromMe && !key.participant ? key.remoteJidAlt ?? undefined : undefined);
    const stored: StoredMessage = {
      id: `${account.id}:${chatJid}:${sourceMessageId}`,
      accountId: account.id,
      accountLabel: account.label,
      sourceMessageId,
      chatJid,
      chatAltJid,
      chatName,
      senderJid,
      senderAltJid,
      senderName: fromMe ? account.displayName ?? runtime.displayName : message.pushName ?? undefined,
      addressingMode: key.addressingMode ?? undefined,
      fromMe,
      text: extractWhatsappText(message.message),
      messageType: detectWhatsappMessageType(message.message),
      occurredAt: whatsappTimestamp(message.messageTimestamp).toISOString(),
      origin,
    };
    const accepted = await this.store.appendMessage(stored);
    if (!accepted) return;

    runtime.storedMessages += 1;
    runtime.updatedAt = new Date();

    if (this.solPlugin) {
      const sourceAccount = { ...account, phoneJid: account.phoneJid ?? runtime.phoneJid };
      await this.solPlugin.ingestWhatsappMessage(sourceAccount, stored).catch((error) => {
        runtime.lastError = `SOL outbox: ${error instanceof Error ? error.message : String(error)}`;
        runtime.updatedAt = new Date();
        this.solPlugin?.reportHealth("degraded", { accountId: account.id, reason: runtime.lastError });
        this.solPlugin?.log("warn", `Could not persist SOL ingestion outbox for ${account.label}: ${runtime.lastError}`);
      });
    }
  }

  private async handleClose(
    account: AccountRecord,
    runtime: RuntimeSession,
    generation: number,
    error: unknown,
  ): Promise<void> {
    if (runtime.generation !== generation || runtime.manualStop) return;
    const statusCode = disconnectStatusCode(error);
    const message = disconnectMessage(error);
    runtime.socket = undefined;
    runtime.qrDataUrl = undefined;
    runtime.updatedAt = new Date();

    if (statusCode !== undefined && NON_RECONNECTABLE.has(statusCode)) {
      runtime.state = statusCode === DisconnectReason.loggedOut ? "logged_out" : "error";
      runtime.lastError = pairingError(statusCode, message);
      await this.store.updateAccount(account.id, { lastError: runtime.lastError }).catch(() => undefined);
      return;
    }

    runtime.reconnectAttempt += 1;
    runtime.state = "reconnecting";
    runtime.lastError = pairingError(statusCode, message);
    const delay = Math.min(30_000, 1_000 * 2 ** Math.min(runtime.reconnectAttempt, 5));
    runtime.reconnectTimer = setTimeout(() => {
      if (runtime.generation !== generation || runtime.manualStop) return;
      void this.connect(account, runtime).catch((connectError) => {
        runtime.lastError = connectError instanceof Error ? connectError.message : String(connectError);
        runtime.updatedAt = new Date();
      });
    }, delay);
  }
}
