import { BridgeStore } from "./store.js";

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

export class NexoBridgeStore extends BridgeStore {
  override async updateChatNames(accountId: string, entries: ChatNameEntry[]): Promise<void> {
    return super.updateChatNames(accountId, dedupeChatNameEntries(entries));
  }
}
