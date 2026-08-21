import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import type { AccountRecord, AccountRole, OutboundAudit, StoredMessage } from "./types.js";

interface AccountsFile {
  version: 1;
  accounts: AccountRecord[];
}

interface ChatsFile {
  version: 1;
  chats: Record<string, Record<string, string>>;
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
}

async function atomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temp, path);
}

function terms(query: string): string[] {
  return query
    .toLocaleLowerCase("es-AR")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 20);
}

export class BridgeStore {
  private readonly accountsPath: string;
  private readonly chatsPath: string;
  private readonly messageDir: string;
  private readonly outboundPath: string;
  private readonly writeChains = new Map<string, Promise<void>>();
  private readonly seenIds = new Map<string, Promise<Set<string>>>();
  private metadataChain: Promise<void> = Promise.resolve();

  constructor(private readonly dataDir: string) {
    this.accountsPath = join(dataDir, "accounts.json");
    this.chatsPath = join(dataDir, "chats.json");
    this.messageDir = join(dataDir, "messages");
    this.outboundPath = join(dataDir, "outbound.jsonl");
  }

  async init(): Promise<void> {
    await Promise.all([
      mkdir(this.dataDir, { recursive: true }),
      mkdir(this.messageDir, { recursive: true }),
      mkdir(join(this.dataDir, "auth"), { recursive: true }),
    ]);
  }

  authDir(accountId: string): string {
    return join(this.dataDir, "auth", accountId);
  }

  private async mutateMetadata<T>(task: () => Promise<T>): Promise<T> {
    let resolveResult!: (value: T | PromiseLike<T>) => void;
    let rejectResult!: (reason?: unknown) => void;
    const result = new Promise<T>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });
    this.metadataChain = this.metadataChain
      .catch(() => undefined)
      .then(async () => {
        try { resolveResult(await task()); }
        catch (error) { rejectResult(error); }
      });
    await this.metadataChain;
    return result;
  }

  async listAccounts(): Promise<AccountRecord[]> {
    const file = await readJson<AccountsFile>(this.accountsPath, { version: 1, accounts: [] });
    return file.accounts;
  }

  async getAccount(id: string): Promise<AccountRecord | undefined> {
    return (await this.listAccounts()).find((account) => account.id === id);
  }

  async createAccount(label: string, role: AccountRole): Promise<AccountRecord> {
    return this.mutateMetadata(async () => {
      const accounts = await this.listAccounts();
      if (role === "output" && accounts.some((account) => account.role === "output")) {
        throw new Error("Only one WhatsApp output account is allowed");
      }
      const cleanLabel = label.trim().slice(0, 120) || (role === "output" ? "Codex Output" : "WhatsApp Input");
      const account: AccountRecord = {
        id: randomUUID(),
        label: cleanLabel,
        role,
        enabled: true,
        createdAt: new Date().toISOString(),
      };
      accounts.push(account);
      await atomicJson(this.accountsPath, { version: 1, accounts } satisfies AccountsFile);
      return account;
    });
  }

  async updateAccount(id: string, patch: Partial<Omit<AccountRecord, "id" | "role" | "createdAt">>): Promise<AccountRecord> {
    return this.mutateMetadata(async () => {
      const accounts = await this.listAccounts();
      const index = accounts.findIndex((account) => account.id === id);
      const current = accounts[index];
      if (!current) throw new Error("WhatsApp account not found");
      const updated: AccountRecord = { ...current, ...patch, id: current.id, role: current.role, createdAt: current.createdAt };
      accounts[index] = updated;
      await atomicJson(this.accountsPath, { version: 1, accounts } satisfies AccountsFile);
      return updated;
    });
  }

  async deleteAccount(id: string): Promise<void> {
    await this.mutateMetadata(async () => {
      const accounts = await this.listAccounts();
      const remaining = accounts.filter((account) => account.id !== id);
      if (remaining.length === accounts.length) throw new Error("WhatsApp account not found");
      await atomicJson(this.accountsPath, { version: 1, accounts: remaining } satisfies AccountsFile);
      const chats = await readJson<ChatsFile>(this.chatsPath, { version: 1, chats: {} });
      delete chats.chats[id];
      await atomicJson(this.chatsPath, chats);
    });
    await Promise.all([
      rm(this.authDir(id), { recursive: true, force: true }),
      rm(this.messagePath(id), { force: true }),
    ]);
    this.seenIds.delete(id);
    this.writeChains.delete(id);
  }

  async getOutputAccount(): Promise<AccountRecord | undefined> {
    return (await this.listAccounts()).find((account) => account.role === "output");
  }

  async updateChatNames(accountId: string, entries: Array<{ jid: string; name?: string | null }>): Promise<void> {
    if (!entries.length) return;
    await this.mutateMetadata(async () => {
      const file = await readJson<ChatsFile>(this.chatsPath, { version: 1, chats: {} });
      const bucket = file.chats[accountId] ?? {};
      for (const entry of entries) {
        const name = entry.name?.trim();
        if (entry.jid && name) bucket[entry.jid] = name.slice(0, 240);
      }
      file.chats[accountId] = bucket;
      await atomicJson(this.chatsPath, file);
    });
  }

  async chatName(accountId: string, jid: string): Promise<string | undefined> {
    const file = await readJson<ChatsFile>(this.chatsPath, { version: 1, chats: {} });
    return file.chats[accountId]?.[jid];
  }

  private messagePath(accountId: string): string {
    return join(this.messageDir, `${accountId}.jsonl`);
  }

  private async loadSeen(accountId: string): Promise<Set<string>> {
    const existing = this.seenIds.get(accountId);
    if (existing) return existing;
    const promise = (async () => {
      const ids = new Set<string>();
      await this.scanFile(this.messagePath(accountId), (message) => {
        ids.add(message.id);
      });
      return ids;
    })();
    this.seenIds.set(accountId, promise);
    return promise;
  }

  async appendMessage(message: StoredMessage): Promise<boolean> {
    const seen = await this.loadSeen(message.accountId);
    if (seen.has(message.id)) return false;
    seen.add(message.id);
    const path = this.messagePath(message.accountId);
    const previous = this.writeChains.get(message.accountId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        await mkdir(dirname(path), { recursive: true });
        await appendFile(path, `${JSON.stringify(message)}\n`, "utf8");
      });
    this.writeChains.set(message.accountId, next);
    await next;
    return true;
  }

  async appendOutbound(audit: OutboundAudit): Promise<void> {
    await appendFile(this.outboundPath, `${JSON.stringify(audit)}\n`, "utf8");
  }

  private async scanFile(path: string, visit: (message: StoredMessage) => void | Promise<void>): Promise<void> {
    try {
      await stat(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    const lines = createInterface({ input: createReadStream(path, { encoding: "utf8" }), crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line.trim()) continue;
      let parsed: StoredMessage;
      try { parsed = JSON.parse(line) as StoredMessage; }
      catch { continue; }
      await visit(parsed);
    }
  }

  async recentMessages(input: { accountIds?: string[]; limit?: number } = {}): Promise<StoredMessage[]> {
    const accounts = (await this.listAccounts()).filter((account) => account.role === "input");
    const selected = input.accountIds?.length
      ? accounts.filter((account) => input.accountIds!.includes(account.id))
      : accounts;
    const matches: StoredMessage[] = [];
    for (const account of selected) {
      await this.scanFile(this.messagePath(account.id), (message) => matches.push(message));
    }
    matches.sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
    return matches.slice(0, Math.max(1, Math.min(200, Math.trunc(input.limit ?? 40))));
  }

  async searchMessages(input: {
    query: string;
    accountIds?: string[];
    after?: string;
    before?: string;
    limit?: number;
  }): Promise<StoredMessage[]> {
    const needles = terms(input.query);
    if (!needles.length) return [];
    const afterMs = input.after ? Date.parse(input.after) : Number.NEGATIVE_INFINITY;
    const beforeMs = input.before ? Date.parse(input.before) : Number.POSITIVE_INFINITY;
    const accounts = (await this.listAccounts()).filter((account) => account.role === "input");
    const selected = input.accountIds?.length
      ? accounts.filter((account) => input.accountIds!.includes(account.id))
      : accounts;
    const matches: StoredMessage[] = [];
    for (const account of selected) {
      await this.scanFile(this.messagePath(account.id), (message) => {
        const timestamp = Date.parse(message.occurredAt);
        if (timestamp < afterMs || timestamp > beforeMs) return;
        const haystack = [message.text, message.chatName, message.chatJid, message.senderName, message.senderJid, account.label]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase("es-AR");
        if (needles.every((needle) => haystack.includes(needle))) matches.push(message);
      });
    }
    matches.sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
    return matches.slice(0, Math.max(1, Math.min(200, Math.trunc(input.limit ?? 50))));
  }
}
