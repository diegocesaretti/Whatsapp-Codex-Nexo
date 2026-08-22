import { phoneNumberFromJid } from "./output-conversation-auth.js";
import { isCodexControlMirrorChat, isCodexControlMirrorMessage } from "./source-policy.js";
import { BridgeStore } from "./store.js";
import type { StoredMessage, WhatsappChatSummary } from "./types.js";

export interface ChatNameEntry {
  jid?: string | null;
  name?: string | null;
}

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
  private async outputPhone(): Promise<string | undefined> {
    const output = await super.getOutputAccount();
    return phoneNumberFromJid(output?.phoneJid);
  }

  override async updateChatNames(accountId: string, entries: ChatNameEntry[]): Promise<void> {
    return super.updateChatNames(accountId, dedupeChatNameEntries(entries));
  }

  override async appendMessage(message: StoredMessage): Promise<boolean> {
    const account = await super.getAccount(message.accountId);
    if (!account || account.role !== "input") {
      throw new Error("Only INPUT accounts may be written to the searchable WhatsApp archive");
    }
    const outputPhone = await this.outputPhone();
    if (isCodexControlMirrorMessage(message, outputPhone)) return false;
    return super.appendMessage(message);
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
