import { phoneNumberFromJid } from "./output-conversation-auth.js";
import { isCodexControlMirrorChat, isCodexControlMirrorMessage } from "./source-policy.js";
import { AppSettingsStore } from "./settings.js";
import { BridgeStore } from "./store.js";
import type { AccountRecord, StoredMessage, WhatsappChatSummary } from "./types.js";

export interface ChatNameEntry {
  jid?: string | null;
  name?: string | null;
}

export type InputArchiveResult = "stored" | "duplicate" | "rejected";

export function dedupeChatNameEntries(entries: ChatNameEntry[]): ChatNameEntry[] {
  const byJid = new Map<string, string>();
  for (const entry of entries) {
    const jid = entry.jid?.trim();
    const name = entry.name?.trim().slice(0, 240);
    if (!jid || !name) continue;
    // Keep the last occurrence. Baileys commonly exposes the same JID in both
    // history.chats and history.contacts; contact metadata is appended last.
    byJid.set(jid, name);
  }
  return [...byJid].map(([jid, name]) => ({ jid, name }));
}

function bounded(value: number | undefined, fallback: number, max = 200): number {
  return Math.max(1, Math.min(max, Math.trunc(value ?? fallback)));
}

export class NexoBridgeStore extends BridgeStore {
  private outputPhoneCache?: { value?: string; expiresAt: number };

  constructor(dataDir: string, databaseUrl?: string, private readonly settingsStore?: AppSettingsStore) {
    super(dataDir, databaseUrl);
  }

  private async outputPhone(): Promise<string | undefined> {
    if (this.outputPhoneCache && Date.now() < this.outputPhoneCache.expiresAt) {
      return this.outputPhoneCache.value;
    }
    const output = await super.getOutputAccount();
    const value = phoneNumberFromJid(output?.phoneJid);
    this.outputPhoneCache = { value, expiresAt: Date.now() + 5_000 };
    return value;
  }

  override async updateAccount(
    id: string,
    patch: Partial<Omit<AccountRecord, "id" | "role" | "createdAt">>,
  ): Promise<AccountRecord> {
    const updated = await super.updateAccount(id, patch);
    if (updated.role === "output") this.outputPhoneCache = undefined;
    if (updated.role === "input" && updated.phoneJid && this.settingsStore) {
      await this.settingsStore.ensureInputIdentity(updated);
    }
    return updated;
  }

  override async updateChatNames(accountId: string, entries: ChatNameEntry[]): Promise<void> {
    return super.updateChatNames(accountId, dedupeChatNameEntries(entries));
  }

  async appendInputMessage(message: StoredMessage): Promise<InputArchiveResult> {
    const account = await super.getAccount(message.accountId);
    if (!account || account.role !== "input") {
      throw new Error("Only INPUT accounts may be written to the searchable WhatsApp archive");
    }
    const outputPhone = await this.outputPhone();
    if (isCodexControlMirrorMessage(message, outputPhone)) return "rejected";
    return await super.appendMessage(message) ? "stored" : "duplicate";
  }

  override async appendMessage(message: StoredMessage): Promise<boolean> {
    return await this.appendInputMessage(message) === "stored";
  }

  override async getMessage(id: string): Promise<StoredMessage | undefined> {
    const message = await super.getMessage(id);
    if (!message) return undefined;
    return isCodexControlMirrorMessage(message, await this.outputPhone()) ? undefined : message;
  }

  override async recentMessages(input: { accountIds?: string[]; limit?: number } = {}): Promise<StoredMessage[]> {
    const requested = bounded(input.limit, 40);
    const raw = await super.recentMessages({
      ...input,
      limit: Math.min(200, Math.max(requested, requested * 3)),
    });
    const outputPhone = await this.outputPhone();
    return raw.filter((message) => !isCodexControlMirrorMessage(message, outputPhone)).slice(0, requested);
  }

  override async searchMessages(input: {
    query: string;
    accountIds?: string[];
    after?: string;
    before?: string;
    limit?: number;
  }): Promise<StoredMessage[]> {
    const requested = bounded(input.limit, 50);
    const raw = await super.searchMessages({
      ...input,
      limit: Math.min(200, Math.max(requested, requested * 3)),
    });
    const outputPhone = await this.outputPhone();
    return raw.filter((message) => !isCodexControlMirrorMessage(message, outputPhone)).slice(0, requested);
  }

  override async listChats(input: { query?: string; accountIds?: string[]; limit?: number } = {}): Promise<WhatsappChatSummary[]> {
    const requested = bounded(input.limit, 50);
    const raw = await super.listChats({
      ...input,
      limit: Math.min(200, Math.max(requested, requested * 3)),
    });
    const outputPhone = await this.outputPhone();
    return raw.filter((chat) => !isCodexControlMirrorChat(chat, outputPhone)).slice(0, requested);
  }
}
