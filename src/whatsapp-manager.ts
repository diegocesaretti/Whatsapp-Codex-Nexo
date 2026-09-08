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

function publicStatus(runtime: RuntimeSession): RuntimeStatus {
  return {
    accountId: runtime.accountId,
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

function emptyStatus(accountId: string): RuntimeStatus {
  return {
    accountId,
    state: "idle",
    reconnectAttempt: 0,
    updatedAt: new Date().toISOString(),
    receivedMessages: 0,
    storedMessages: 0,
    historyMessages: 0,
  };
}

export class WhatsappManager {
  private readonly sessions = new Map<string, RuntimeSession>();

  constructor(
    private readonly store: BridgeStore,
    private readonly settingsStore?: AppSettingsStore,
    private readonly conversationStore?: OutputConversationStore,
    private readonly solPlugin?: SolPluginClient,
  ) {}

  getStatus(accountId: string): RuntimeStatus {
    const runtime = this.sessions.get(accountId);
    return runtime ? publicStatus(runtime) : emptyStatus(accountId);
  }

  async startLinkedAccounts(): Promise<void> {
    const accounts = await this.store.listAccounts();
    await Promise.all(
      accounts
        .filter((account) => account.enabled && account.linkedAt)
        .map((account) => this.start(account.id).catch((error) => {
          console.error(`[whatsapp:${account.id}] autostart failed`, error);
        })),
    );
  }

  async start(accountId: string): Promise<RuntimeStatus> {
    const account = await this.store.getAccount(accountId);
    if (!account) throw new Error("WhatsApp account not found");
    if (!account.enabled) throw new Error("WhatsApp account is disabled");

    let runtime = this.sessions.get(accountId);
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
      this.sessions.set(accountId, runtime);
    }
    runtime.manualStop = false;
    if (runtime.socket && ["connecting", "qr", "open", "reconnecting"].includes(runtime.state)) {
      return publicStatus(runtime);
    }
    await this.connect(account, runtime);
    return publicStatus(runtime);
  }

  async restart(accountId: string): Promise<RuntimeStatus> {
    const runtime = this.sessions.get(accountId);
    if (runtime) await this.stopRuntime(runtime, false);
    return this.start(accountId);
  }

  async logout(accountId: string): Promise<void> {
    const account = await this.store.getAccount(accountId);
    const runtime = this.sessions.get(accountId);
    if (runtime) {
      runtime.manualStop = true;
      if (runtime.reconnectTimer) clearTimeout(runtime.reconnectTimer);
      try { await runtime.socket?.logout("Codex Nexo unlink"); } catch {}
      try { runtime.socket?.end(undefined); } catch {}
      await runtime.queue.catch(() => undefined);
      this.sessions.delete(accountId);
    }
    if (account?.role === "input" && this.solPlugin) {
      await this.solPlugin.unregisterInput(account).catch((error) => {
        // Never make local account removal depend on SOL uptime. Old/stale
        // host projections can be removed later from SOL > Conexiones.
        this.solPlugin?.log("warn", `Could not unregister deleted account ${account.label} from SOL: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
    await this.store.deleteAccount(accountId);
    if (this.settingsStore) {
      await this.settingsStore.syncInputIdentities(await this.store.listAccounts()).catch(() => undefined);
    }
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.sessions.values()].map((runtime) => this.stopRuntime(runtime, true)));
    this.sessions.clear();
  }

  private async setOutputConversationPresence(to: string, presence: OutputPresence): Promise<void> {
    const output = await this.store.getOutputAccount();
    if (!output) throw new Error("No WhatsApp output account is configured");
    await this.start(output.id);
    const runtime = this.sessions.get(output.id);
    if (!runtime?.socket || runtime.state !== "open") throw new Error("WhatsApp output account is not connected");
    if (presence === "available" || presence === "unavailable") {
      await runtime.socket.sendPresenceUpdate(presence);
    } else {
      await runtime.socket.sendPresenceUpdate(presence, normalizeSendTarget(to));
    }
    runtime.updatedAt = new Date();
  }

  async beginOutputConversationActivity(to: string): Promise<void> {
    await this.setOutputConversationPresence(to, "available");
    await this.setOutputConversationPresence(to, "composing");
  }

  async refreshOutputConversationActivity(to: string): Promise<void> {
    await this.setOutputConversationPresence(to, "composing");
  }

  async endOutputConversationActivity(to: string): Promise<void> {
    await this.setOutputConversationPresence(to, "paused").catch(() => undefined);
    await this.setOutputConversationPresence(to, "unavailable").catch(() => undefined);
  }

  async replyToArchivedMessage(input: {
    storedMessageId: string;
    text: string;
    reason?: string;
  }): Promise<OutboundAudit> {
    const resolved = await this.store.resolveMessageTarget(input.storedMessageId);
    if (!resolved) {
      const source = await this.store.getMessage(input.storedMessageId);
      if (!source) throw new Error("Archived WhatsApp message not found");
      throw new Error("Archived WhatsApp message does not expose a safe send target");
    }
    const source = resolved.message;
    const replyTo: OutboundReplyContext = {
      storedMessageId: source.id,
      sourceAccountId: source.accountId,
      sourceMessageId: source.sourceMessageId,
      chatJid: source.chatJid,
      chatAltJid: source.chatAltJid,
      chatName: source.chatName,
      senderName: source.senderName,
      occurredAt: source.occurredAt,
    };
    return this.sendText({
      to: resolved.sendTarget,
      text: input.text,
      reason: input.reason,
      replyTo,
    });
  }

  async replyToOutputConversationMessage(input: {
    inboundMessageId: string;
    text: string;
    reason?: string;
  }): Promise<OutboundAudit> {
    if (!this.settingsStore || !this.conversationStore) throw new Error("OUTPUT conversation channel is unavailable");
    const settings = await this.settingsStore.get();
    if (!settings.outputConversation.enabled) throw new Error("OUTPUT conversation channel is disabled");
    const source = await this.conversationStore.get(input.inboundMessageId);
    if (!source || source.direction !== "inbound" || !source.authorized) {
      throw new Error("Authorized inbound OUTPUT conversation message not found");
    }
    if (!isAuthorizedPhone(settings.outputConversation.authorizedNumbers, source.peerPhone)) {
      throw new Error("The sender is no longer authorized for OUTPUT conversation");
    }
    const audit = await this.sendText({
      to: source.peerJid,
      text: input.text,
      reason: input.reason?.trim() || "Codex OUTPUT conversation reply",
      conversationReplyToId: source.id,
    });
    await this.conversationStore.acknowledge([source.id]);
    return audit;
  }

  async sendText(input: {
    to: string;
    text: string;
    reason?: string;
    replyTo?: OutboundReplyContext;
    conversationReplyToId?: string;
  }): Promise<OutboundAudit> {
    const output = await this.store.getOutputAccount();
    if (!output) throw new Error("No WhatsApp output account is configured");
    const message = input.text.trim();
    if (!message) throw new Error("Message text is required");
    if (message.length > 12_000) throw new Error("Message text is too long");
    await this.start(output.id);
    const runtime = this.sessions.get(output.id);
    if (!runtime?.socket || runtime.state !== "open") {
      throw new Error("WhatsApp output account is not connected");
    }
    const to = normalizeSendTarget(input.to);
    await runtime.socket.sendPresenceUpdate("available").catch(() => undefined);
    try {
      const result = await runtime.socket.sendMessage(to, { text: message });
      const audit: OutboundAudit = {
        id: randomUUID(),
        accountId: output.id,
        to,
        text: message,
        reason: input.reason?.trim().slice(0, 500) || undefined,
        replyTo: input.replyTo,
        messageId: result?.key.id ?? undefined,
        sentAt: new Date().toISOString(),
      };
      await this.store.appendOutbound(audit);
      await this.captureOutboundConversation(output, audit, input.conversationReplyToId);
      runtime.lastMessageAt = new Date();
      runtime.updatedAt = new Date();
      return audit;
    } finally {
      await runtime.socket.sendPresenceUpdate("unavailable").catch(() => undefined);
    }
  }

  private async captureOutboundConversation(
    output: AccountRecord,
    audit: OutboundAudit,
    replyToId?: string,
  ): Promise<void> {
    if (!this.settingsStore || !this.conversationStore) return;
    const settings = await this.settingsStore.get();
    if (!settings.outputConversation.enabled) return;
    const peerJid = safePhoneJid(audit.to);
    const peerPhone = phoneNumberFromJid(peerJid);
    if (!peerJid || !isAuthorizedPhone(settings.outputConversation.authorizedNumbers, peerPhone)) return;
    const whatsappMessageId = audit.messageId ?? `audit-${audit.id}`;
    const stored: OutputConversationMessage = {
      id: `${output.id}:${whatsappMessageId}:outbound`,
      accountId: output.id,
      whatsappMessageId,
      peerJid,
      peerPhone: peerPhone!,
      direction: "outbound",
      text: audit.text,
      messageType: "conversation",
      senderName: output.displayName,
      authorized: true,
      occurredAt: audit.sentAt,
      replyToId,
    };
    await this.conversationStore.append(stored);
  }

  private async connect(account: AccountRecord, runtime: RuntimeSession): Promise<void> {
    runtime.generation += 1;
    const generation = runtime.generation;
    runtime.state = runtime.reconnectAttempt ? "reconnecting" : "connecting";
    runtime.qrDataUrl = undefined;
    runtime.lastError = undefined;
    runtime.updatedAt = new Date();

    const { state, saveCreds } = await useMultiFileAuthState(this.store.authDir(account.id));
    const version = await resolveWaWebVersion();
    const socket = makeWASocket({
      ...(version ? { version } : {}),
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      logger,
      browser: Browsers.ubuntu(account.role === "output" ? "Codex WhatsApp Output" : `Codex Input · ${account.label}`),
      printQRInTerminal: false,
      markOnlineOnConnect: false,
      syncFullHistory: account.role === "input",
      shouldSyncHistoryMessage: () => account.role === "input",
      shouldIgnoreJid,
      emitOwnEvents: true,
    });
    runtime.socket = socket;

    socket.ev.on("creds.update", () => {
      void saveCreds().catch((error) => {
        runtime.lastError = `Failed to persist WhatsApp credentials: ${error instanceof Error ? error.message : String(error)}`;
        runtime.updatedAt = new Date();
      });
    });

    socket.ev.on("connection.update", (update) => {
      if (runtime.generation !== generation) return;
      if (update.qr) {
        void QRCode.toDataURL(update.qr, { width: 320, margin: 1, errorCorrectionLevel: "M" })
          .then((dataUrl) => {
            if (runtime.generation !== generation) return;
            runtime.qrDataUrl = dataUrl;
            runtime.state = "qr";
            runtime.lastError = undefined;
            runtime.updatedAt = new Date();
          })
          .catch((error) => {
            runtime.lastError = `QR generation failed: ${String(error)}`;
            runtime.updatedAt = new Date();
          });
      }
      if (update.connection === "open") {
        runtime.state = "open";
        runtime.qrDataUrl = undefined;
        runtime.reconnectAttempt = 0;
        runtime.lastError = undefined;
        runtime.phoneJid = socket.user?.id;
        runtime.displayName = socket.user?.name ?? undefined;
        runtime.updatedAt = new Date();
        void this.store.updateAccount(account.id, {
          linkedAt: account.linkedAt ?? new Date().toISOString(),
          phoneJid: socket.user?.id,
          displayName: socket.user?.name ?? undefined,
          lastError: undefined,
        }).catch((error) => console.error(`[whatsapp:${account.id}] account state update failed`, error));
        if (account.role === "input" && this.solPlugin) {
          const linkedAccount = {
            ...account,
            phoneJid: socket.user?.id ?? account.phoneJid,
            displayName: socket.user?.name ?? account.displayName,
          };
          void this.solPlugin.setStatus(linkedAccount, "connected", new Date().toISOString()).catch((error) => {
            this.solPlugin?.log("warn", `Could not mark ${account.label} connected in SOL: ${error instanceof Error ? error.message : String(error)}`);
          });
        }
      }
      if (update.connection === "close") {
        if (account.role === "input" && this.solPlugin) {
          void this.solPlugin.setStatus(account, "disconnected").catch(() => undefined);
        }
        void this.handleClose(account, runtime, generation, update.lastDisconnect?.error);
      }
    });

    socket.ev.on("messages.upsert", (upsert) => {
      runtime.receivedMessages += upsert.messages.length;
      runtime.lastMessageAt = new Date();
      if (account.role === "input") {
        const origin = upsert.type === "notify" ? "realtime" : "history";
        this.enqueue(runtime, async () => {
          for (const message of upsert.messages) {
            await this.ingestMessage(account, runtime, message, origin, socket.user?.id);
          }
        });
        return;
      }
      if (upsert.type !== "notify") return;
      this.enqueue(runtime, async () => {
        for (const message of upsert.messages) {
          await this.ingestOutputConversationMessage(account, runtime, message);
        }
      });
    });

    socket.ev.on("messaging-history.set", (history) => {
      if (account.role !== "input") return;
      runtime.historyMessages += history.messages.length;
      this.enqueue(runtime, async () => {
        const contacts = (history as unknown as {
          contacts?: Array<{ id: string; name?: string | null; notify?: string | null }>;
        }).contacts ?? [];
        await this.store.updateChatNames(account.id, [
          ...history.chats.map((chat) => ({ jid: chat.id, name: (chat as { name?: string | null }).name })),
          ...contacts.map((contact) => ({ jid: contact.id, name: contact.name ?? contact.notify })),
        ]);
        for (const message of history.messages) {
          await this.ingestMessage(account, runtime, message, "history", socket.user?.id);
        }
      });
    });
  }

  private enqueue(runtime: RuntimeSession, task: () => Promise<void>): void {
    runtime.queue = runtime.queue
      .catch(() => undefined)
      .then(task)
      .catch((error) => {
        runtime.lastError = error instanceof Error ? error.message : String(error);
        runtime.updatedAt = new Date();
        console.error(`[whatsapp:${runtime.accountId}] queue task failed`, error);
      });
  }

  private async ingestOutputConversationMessage(
    account: AccountRecord,
    runtime: RuntimeSession,
    message: WAMessage,
  ): Promise<void> {
    if (!this.settingsStore || !this.conversationStore) return;
    const key = message.key as ExtendedMessageKey;
    if (key.fromMe) return;
    const remoteJid = key.remoteJid;
    const sourceMessageId = key.id;
    if (!remoteJid || !sourceMessageId || shouldIgnoreJid(remoteJid) || remoteJid.endsWith("@g.us")) return;
    const remoteAltJid = key.remoteJidAlt ?? undefined;
    const peerJid = safePhoneJid(remoteJid, remoteAltJid);
    const peerPhone = phoneNumberFromJid(peerJid);
    if (!peerJid || !peerPhone) return;

    const settings = await this.settingsStore.get();
    if (!settings.outputConversation.enabled || !isAuthorizedPhone(settings.outputConversation.authorizedNumbers, peerPhone)) return;

    const stored: OutputConversationMessage = {
      id: `${account.id}:${sourceMessageId}:inbound`,
      accountId: account.id,
      whatsappMessageId: sourceMessageId,
      peerJid,
      peerAltJid: remoteJid !== peerJid ? remoteJid : remoteAltJid,
      peerPhone,
      direction: "inbound",
      text: extractWhatsappText(message.message),
      messageType: detectWhatsappMessageType(message.message),
      senderName: message.pushName ?? undefined,
      authorized: true,
      occurredAt: whatsappTimestamp(message.messageTimestamp).toISOString(),
    };
    if (await this.conversationStore.append(stored)) {
      runtime.storedMessages += 1;
      runtime.updatedAt = new Date();
    }
  }

  private async ingestMessage(
    account: AccountRecord,
    runtime: RuntimeSession,
    message: WAMessage,
    origin: "history" | "realtime",
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
    if (await this.store.appendMessage(stored)) {
      runtime.storedMessages += 1;
      runtime.updatedAt = new Date();
    }
    if (this.solPlugin) {
      const sourceAccount = { ...account, phoneJid: account.phoneJid ?? runtime.phoneJid };
      await this.solPlugin.ingestWhatsappMessage(sourceAccount, stored).catch((error) => {
        runtime.lastError = `SOL ingestion: ${error instanceof Error ? error.message : String(error)}`;
        runtime.updatedAt = new Date();
        this.solPlugin?.reportHealth("degraded", { accountId: account.id, reason: runtime.lastError });
        this.solPlugin?.log("warn", `SOL ingestion failed for ${account.label}: ${runtime.lastError}`);
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
      runtime.reconnectTimer = undefined;
      void this.start(account.id).catch((reconnectError) => {
        runtime.state = "error";
        runtime.lastError = reconnectError instanceof Error ? reconnectError.message : String(reconnectError);
        runtime.updatedAt = new Date();
      });
    }, delay);
    runtime.reconnectTimer.unref();
  }

  private async stopRuntime(runtime: RuntimeSession, manualStop: boolean): Promise<void> {
    runtime.manualStop = manualStop;
    if (runtime.reconnectTimer) clearTimeout(runtime.reconnectTimer);
    runtime.reconnectTimer = undefined;
    try { runtime.socket?.end(undefined); } catch {}
    runtime.socket = undefined;
    await runtime.queue.catch(() => undefined);
    runtime.state = "idle";
    runtime.updatedAt = new Date();
    if (this.solPlugin) await this.solPlugin.setDisconnectedByAccountId(runtime.accountId).catch(() => undefined);
  }
}
