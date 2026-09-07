import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, rm, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { Pool, type QueryResultRow } from "pg";
import { writeTextAtomic } from "./atomic-file.js";
import type { AccountRecord, AccountRole, OutboundAudit, StoredMessage, WhatsappChatSummary } from "./types.js";

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
  await writeTextAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

function terms(query: string): string[] {
  return query
    .toLocaleLowerCase("es-AR")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function isPhoneJid(jid: string | undefined): boolean {
  return Boolean(jid?.endsWith("@s.whatsapp.net"));
}

function isGroupJid(jid: string | undefined): boolean {
  return Boolean(jid?.endsWith("@g.us"));
}

function chatSendTarget(message: StoredMessage): string | undefined {
  if (isGroupJid(message.chatJid)) return message.chatJid;
  if (isGroupJid(message.chatAltJid)) return message.chatAltJid;
  if (isPhoneJid(message.chatJid)) return message.chatJid;
  if (isPhoneJid(message.chatAltJid)) return message.chatAltJid;
  return undefined;
}

function chatIdentity(message: StoredMessage): string {
  return chatSendTarget(message) ?? message.chatAltJid ?? message.chatJid;
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}

function accountFromRow(row: QueryResultRow): AccountRecord {
  return {
    id: String(row.id),
    label: String(row.label),
    role: row.role as AccountRole,
    enabled: Boolean(row.enabled),
    createdAt: iso(row.created_at),
    linkedAt: row.linked_at ? iso(row.linked_at) : undefined,
    phoneJid: row.phone_jid ? String(row.phone_jid) : undefined,
    displayName: row.display_name ? String(row.display_name) : undefined,
    lastError: row.last_error ? String(row.last_error) : undefined,
  };
}

function messageFromRow(row: QueryResultRow): StoredMessage {
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    accountLabel: String(row.account_label),
    sourceMessageId: String(row.source_message_id),
    chatJid: String(row.chat_jid),
    chatAltJid: row.chat_alt_jid ? String(row.chat_alt_jid) : undefined,
    chatName: row.chat_name ? String(row.chat_name) : undefined,
    senderJid: row.sender_jid ? String(row.sender_jid) : undefined,
    senderAltJid: row.sender_alt_jid ? String(row.sender_alt_jid) : undefined,
    senderName: row.sender_name ? String(row.sender_name) : undefined,
    addressingMode: row.addressing_mode ? String(row.addressing_mode) : undefined,
    fromMe: Boolean(row.from_me),
    text: row.text_content === null || row.text_content === undefined ? undefined : String(row.text_content),
    messageType: row.message_type ? String(row.message_type) : undefined,
    occurredAt: iso(row.occurred_at),
    origin: row.origin as StoredMessage["origin"],
  };
}

export class BridgeStore {
  private readonly accountsPath: string;
  private readonly chatsPath: string;
  private readonly messageDir: string;
  private readonly outboundPath: string;
  private readonly writeChains = new Map<string, Promise<void>>();
  private readonly seenIds = new Map<string, Promise<Set<string>>>();
  private metadataChain: Promise<unknown> = Promise.resolve();
  private readonly pool?: Pool;

  constructor(private readonly dataDir: string, databaseUrl?: string) {
    this.accountsPath = join(dataDir, "accounts.json");
    this.chatsPath = join(dataDir, "chats.json");
    this.messageDir = join(dataDir, "messages");
    this.outboundPath = join(dataDir, "outbound.jsonl");
    if (databaseUrl) {
      this.pool = new Pool({
        connectionString: databaseUrl,
        max: 4,
        idleTimeoutMillis: 15_000,
        connectionTimeoutMillis: 15_000,
        application_name: "whatsapp-codex-nexo",
      });
    }
  }

  get storageMode(): "neon" | "local" {
    return this.pool ? "neon" : "local";
  }

  async init(): Promise<void> {
    await Promise.all([
      mkdir(this.dataDir, { recursive: true }),
      mkdir(this.messageDir, { recursive: true }),
      mkdir(join(this.dataDir, "auth"), { recursive: true }),
    ]);
    if (this.pool) {
      const result = await this.pool.query<{ exists: boolean }>(
        "SELECT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'whatsapp_nexo') AS exists",
      );
      if (!result.rows[0]?.exists) {
        throw new Error("Neon is configured but schema whatsapp_nexo is missing. Apply the Nexo database migration first.");
      }
    }
  }

  async close(): Promise<void> {
    await this.pool?.end();
  }

  authDir(accountId: string): string {
    return join(this.dataDir, "auth", accountId);
  }

  private mutateMetadata<T>(task: () => Promise<T>): Promise<T> {
    const run = this.metadataChain.then(task, task);
    this.metadataChain = run.then(() => undefined, () => undefined);
    return run;
  }

  async listAccounts(): Promise<AccountRecord[]> {
    if (this.pool) {
      const result = await this.pool.query("SELECT * FROM whatsapp_nexo.accounts ORDER BY created_at");
      return result.rows.map(accountFromRow);
    }
    const file = await readJson<AccountsFile>(this.accountsPath, { version: 1, accounts: [] });
    return file.accounts;
  }

  async getAccount(id: string): Promise<AccountRecord | undefined> {
    if (this.pool) {
      const result = await this.pool.query("SELECT * FROM whatsapp_nexo.accounts WHERE id = $1", [id]);
      return result.rows[0] ? accountFromRow(result.rows[0]) : undefined;
    }
    return (await this.listAccounts()).find((account) => account.id === id);
  }

  async createAccount(label: string, role: AccountRole): Promise<AccountRecord> {
    return this.mutateMetadata(async () => {
      const cleanLabel = label.trim().slice(0, 120) || (role === "output" ? "Codex Output" : "WhatsApp Input");
      const account: AccountRecord = {
        id: randomUUID(),
        label: cleanLabel,
        role,
        enabled: true,
        createdAt: new Date().toISOString(),
      };
      if (this.pool) {
        try {
          const result = await this.pool.query(
            `INSERT INTO whatsapp_nexo.accounts (id,label,role,enabled,created_at)
             VALUES ($1,$2,$3,$4,$5) RETURNING *`,
            [account.id, account.label, account.role, account.enabled, account.createdAt],
          );
          return accountFromRow(result.rows[0]!);
        } catch (error) {
          if ((error as { code?: string }).code === "23505" && role === "output") {
            throw new Error("Only one WhatsApp output account is allowed");
          }
          throw error;
        }
      }
      const accounts = await this.listAccounts();
      if (role === "output" && accounts.some((item) => item.role === "output")) {
        throw new Error("Only one WhatsApp output account is allowed");
      }
      accounts.push(account);
      await atomicJson(this.accountsPath, { version: 1, accounts } satisfies AccountsFile);
      return account;
    });
  }

  async updateAccount(id: string, patch: Partial<Omit<AccountRecord, "id" | "role" | "createdAt">>): Promise<AccountRecord> {
    return this.mutateMetadata(async () => {
      const current = await this.getAccount(id);
      if (!current) throw new Error("WhatsApp account not found");
      const updated: AccountRecord = { ...current, ...patch, id: current.id, role: current.role, createdAt: current.createdAt };
      if (this.pool) {
        const result = await this.pool.query(
          `UPDATE whatsapp_nexo.accounts SET label=$2,enabled=$3,linked_at=$4,phone_jid=$5,display_name=$6,last_error=$7
           WHERE id=$1 RETURNING *`,
          [id, updated.label, updated.enabled, updated.linkedAt ?? null, updated.phoneJid ?? null, updated.displayName ?? null, updated.lastError ?? null],
        );
        return accountFromRow(result.rows[0]!);
      }
      const accounts = await this.listAccounts();
      const index = accounts.findIndex((account) => account.id === id);
      accounts[index] = updated;
      await atomicJson(this.accountsPath, { version: 1, accounts } satisfies AccountsFile);
      return updated;
    });
  }

  async deleteAccount(id: string): Promise<void> {
    if (this.pool) {
      const result = await this.pool.query("DELETE FROM whatsapp_nexo.accounts WHERE id=$1 RETURNING id", [id]);
      if (!result.rowCount) throw new Error("WhatsApp account not found");
      await rm(this.authDir(id), { recursive: true, force: true });
      return;
    }
    await this.mutateMetadata(async () => {
      const accounts = await this.listAccounts();
      const remaining = accounts.filter((account) => account.id !== id);
      if (remaining.length === accounts.length) throw new Error("WhatsApp account not found");
      await atomicJson(this.accountsPath, { version: 1, accounts: remaining } satisfies AccountsFile);
      const chats = await readJson<ChatsFile>(this.chatsPath, { version: 1, chats: {} });
      delete chats.chats[id];
      await atomicJson(this.chatsPath, chats);
    });
    await Promise.all([rm(this.authDir(id), { recursive: true, force: true }), rm(this.messagePath(id), { force: true })]);
    this.seenIds.delete(id);
    this.writeChains.delete(id);
  }

  async getOutputAccount(): Promise<AccountRecord | undefined> {
    if (this.pool) {
      const result = await this.pool.query("SELECT * FROM whatsapp_nexo.accounts WHERE role='output' LIMIT 1");
      return result.rows[0] ? accountFromRow(result.rows[0]) : undefined;
    }
    return (await this.listAccounts()).find((account) => account.role === "output");
  }

  async updateChatNames(accountId: string, entries: Array<{ jid?: string | null; name?: string | null }>): Promise<void> {
    const clean = entries
      .map((entry) => ({ jid: entry.jid, name: entry.name?.trim().slice(0, 240) }))
      .filter((entry): entry is { jid: string; name: string } => Boolean(entry.jid && entry.name));
    if (!clean.length) return;
    if (this.pool) {
      for (let offset = 0; offset < clean.length; offset += 300) {
        const chunk = clean.slice(offset, offset + 300);
        const values: unknown[] = [];
        const rows = chunk.map((entry, i) => {
          const p = i * 3;
          values.push(accountId, entry.jid, entry.name);
          return `($${p + 1}::uuid,$${p + 2},$${p + 3},now())`;
        });
        await this.pool.query(
          `INSERT INTO whatsapp_nexo.chat_names (account_id,jid,name,updated_at) VALUES ${rows.join(",")}
           ON CONFLICT (account_id,jid) DO UPDATE SET name=EXCLUDED.name, updated_at=now()`,
          values,
        );
      }
      return;
    }
    await this.mutateMetadata(async () => {
      const file = await readJson<ChatsFile>(this.chatsPath, { version: 1, chats: {} });
      const bucket = file.chats[accountId] ?? {};
      for (const entry of clean) bucket[entry.jid] = entry.name;
      file.chats[accountId] = bucket;
      await atomicJson(this.chatsPath, file);
    });
  }

  async chatName(accountId: string, jid: string): Promise<string | undefined> {
    if (this.pool) {
      const result = await this.pool.query("SELECT name FROM whatsapp_nexo.chat_names WHERE account_id=$1 AND jid=$2", [accountId, jid]);
      return result.rows[0]?.name ? String(result.rows[0].name) : undefined;
    }
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
      await this.scanFile(this.messagePath(accountId), (message) => { ids.add(message.id); });
      return ids;
    })();
    this.seenIds.set(accountId, promise);
    return promise;
  }

  async appendMessage(message: StoredMessage): Promise<boolean> {
    if (this.pool) {
      const result = await this.pool.query(
        `INSERT INTO whatsapp_nexo.messages
        (id,account_id,account_label,source_message_id,chat_jid,chat_alt_jid,chat_name,sender_jid,sender_alt_jid,sender_name,addressing_mode,from_me,text_content,message_type,occurred_at,origin)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
        ON CONFLICT (id) DO NOTHING RETURNING id`,
        [message.id,message.accountId,message.accountLabel,message.sourceMessageId,message.chatJid,message.chatAltJid ?? null,message.chatName ?? null,message.senderJid ?? null,message.senderAltJid ?? null,message.senderName ?? null,message.addressingMode ?? null,message.fromMe,message.text ?? null,message.messageType ?? null,message.occurredAt,message.origin],
      );
      return Boolean(result.rowCount);
    }
    const seen = await this.loadSeen(message.accountId);
    if (seen.has(message.id)) return false;
    seen.add(message.id);
    const path = this.messagePath(message.accountId);
    const previous = this.writeChains.get(message.accountId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(async () => {
      await mkdir(dirname(path), { recursive: true });
      await appendFile(path, `${JSON.stringify(message)}\n`, "utf8");
    });
    this.writeChains.set(message.accountId, next);
    await next;
    return true;
  }

  async appendOutbound(audit: OutboundAudit): Promise<void> {
    if (this.pool) {
      await this.pool.query(
        `INSERT INTO whatsapp_nexo.outbound_audit (id,account_id,to_jid,text_content,reason,message_id,reply_to,sent_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [audit.id,audit.accountId,audit.to,audit.text,audit.reason ?? null,audit.messageId ?? null,audit.replyTo ? JSON.stringify(audit.replyTo) : null,audit.sentAt],
      );
      return;
    }
    await appendFile(this.outboundPath, `${JSON.stringify(audit)}\n`, "utf8");
  }

  async hasOutboundReason(reason: string): Promise<boolean> {
    if (this.pool) {
      const result = await this.pool.query(`SELECT 1 FROM whatsapp_nexo.outbound_audit WHERE reason=$1 LIMIT 1`, [reason]);
      return Boolean(result.rowCount);
    }
    let found = false;
    await this.scanFile(this.outboundPath, (audit) => {
      if ((audit as unknown as OutboundAudit).reason === reason) found = true;
    });
    return found;
  }

  private async scanFile(path: string, visit: (message: StoredMessage) => void | Promise<void>): Promise<void> {
    try { await stat(path); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    const lines = createInterface({ input: createReadStream(path, { encoding: "utf8" }), crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line.trim()) continue;
      let parsed: StoredMessage;
      try { parsed = JSON.parse(line) as StoredMessage; } catch { continue; }
      await visit(parsed);
    }
  }

  async getMessage(id: string): Promise<StoredMessage | undefined> {
    const cleanId = id.trim();
    if (!cleanId) return undefined;
    if (this.pool) {
      const result = await this.pool.query(
        `SELECT m.* FROM whatsapp_nexo.messages m JOIN whatsapp_nexo.accounts a ON a.id=m.account_id
         WHERE m.id=$1 AND a.role='input'`,
        [cleanId],
      );
      return result.rows[0] ? messageFromRow(result.rows[0]) : undefined;
    }
    const separator = cleanId.indexOf(":");
    if (separator <= 0) return undefined;
    const accountId = cleanId.slice(0, separator);
    const account = await this.getAccount(accountId);
    if (!account || account.role !== "input") return undefined;
    let found: StoredMessage | undefined;
    await this.scanFile(this.messagePath(accountId), (message) => { if (message.id === cleanId) found = message; });
    return found;
  }

  async resolveMessageTarget(id: string): Promise<{ message: StoredMessage; sendTarget: string } | undefined> {
    const message = await this.getMessage(id);
    if (!message) return undefined;
    const sendTarget = chatSendTarget(message);
    return sendTarget ? { message, sendTarget } : undefined;
  }

  async recentMessages(input: { accountIds?: string[]; limit?: number } = {}): Promise<StoredMessage[]> {
    const limit = Math.max(1, Math.min(200, Math.trunc(input.limit ?? 40)));
    if (this.pool) {
      const values: unknown[] = [];
      let filter = "";
      if (input.accountIds?.length) { values.push(input.accountIds); filter = ` AND m.account_id = ANY($${values.length}::uuid[])`; }
      values.push(limit);
      const result = await this.pool.query(
        `SELECT m.* FROM whatsapp_nexo.messages m JOIN whatsapp_nexo.accounts a ON a.id=m.account_id
         WHERE a.role='input'${filter} ORDER BY m.occurred_at DESC LIMIT $${values.length}`,
        values,
      );
      return result.rows.map(messageFromRow);
    }
    const accounts = (await this.listAccounts()).filter((account) => account.role === "input");
    const selected = input.accountIds?.length ? accounts.filter((account) => input.accountIds!.includes(account.id)) : accounts;
    const matches: StoredMessage[] = [];
    for (const account of selected) await this.scanFile(this.messagePath(account.id), (message) => { matches.push(message); });
    matches.sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
    return matches.slice(0, limit);
  }

  async listChats(input: { query?: string; accountIds?: string[]; limit?: number } = {}): Promise<WhatsappChatSummary[]> {
    const limit = Math.max(1, Math.min(200, Math.trunc(input.limit ?? 50)));
    if (this.pool) {
      const values: unknown[] = [];
      let accountFilter = "";
      if (input.accountIds?.length) { values.push(input.accountIds); accountFilter = ` AND m.account_id = ANY($${values.length}::uuid[])`; }
      const needles = terms(input.query ?? "");
      const queryFilters = needles.map((needle) => {
        values.push(`%${needle}%`);
        return `lower(concat_ws(' ',chat_name,chat_jid,chat_alt_jid,send_target,last_sender_name,account_label)) LIKE $${values.length}`;
      });
      values.push(limit);
      const result = await this.pool.query(
        `WITH normalized AS (
           SELECT m.*,
             CASE WHEN m.chat_jid LIKE '%@g.us' THEN m.chat_jid WHEN m.chat_alt_jid LIKE '%@g.us' THEN m.chat_alt_jid
                  WHEN m.chat_jid LIKE '%@s.whatsapp.net' THEN m.chat_jid WHEN m.chat_alt_jid LIKE '%@s.whatsapp.net' THEN m.chat_alt_jid END AS send_target,
             COALESCE(CASE WHEN m.chat_jid LIKE '%@g.us' OR m.chat_jid LIKE '%@s.whatsapp.net' THEN m.chat_jid
                           WHEN m.chat_alt_jid LIKE '%@g.us' OR m.chat_alt_jid LIKE '%@s.whatsapp.net' THEN m.chat_alt_jid END, m.chat_alt_jid, m.chat_jid) AS identity,
             m.sender_name AS last_sender_name
           FROM whatsapp_nexo.messages m JOIN whatsapp_nexo.accounts a ON a.id=m.account_id
           WHERE a.role='input'${accountFilter}
         ), latest AS (
           SELECT DISTINCT ON (account_id, identity)
             account_id,account_label,chat_jid,chat_alt_jid,chat_name,send_target,last_sender_name,text_content,occurred_at,
             count(*) OVER (PARTITION BY account_id,identity) AS message_count
           FROM normalized ORDER BY account_id,identity,occurred_at DESC
         )
         SELECT * FROM latest ${queryFilters.length ? `WHERE ${queryFilters.join(" AND ")}` : ""}
         ORDER BY occurred_at DESC LIMIT $${values.length}`,
        values,
      );
      return result.rows.map((row) => ({
        accountId: String(row.account_id), accountLabel: String(row.account_label), chatJid: String(row.chat_jid),
        chatAltJid: row.chat_alt_jid ? String(row.chat_alt_jid) : undefined, chatName: row.chat_name ? String(row.chat_name) : undefined,
        kind: isGroupJid(String(row.chat_jid)) || isGroupJid(row.chat_alt_jid ? String(row.chat_alt_jid) : undefined) ? "group" : "direct",
        sendTarget: row.send_target ? String(row.send_target) : undefined, messageCount: Number(row.message_count), lastMessageAt: iso(row.occurred_at),
        lastText: row.text_content === null || row.text_content === undefined ? undefined : String(row.text_content),
        lastSenderName: row.last_sender_name ? String(row.last_sender_name) : undefined,
      }));
    }
    const accounts = (await this.listAccounts()).filter((account) => account.role === "input");
    const selected = input.accountIds?.length ? accounts.filter((account) => input.accountIds!.includes(account.id)) : accounts;
    const summaries = new Map<string, WhatsappChatSummary>();
    for (const account of selected) {
      await this.scanFile(this.messagePath(account.id), (message) => {
        const identity = chatIdentity(message), key = `${account.id}:${identity}`, existing = summaries.get(key);
        const kind: WhatsappChatSummary["kind"] = isGroupJid(message.chatJid) || isGroupJid(message.chatAltJid) ? "group" : "direct";
        const sendTarget = chatSendTarget(message);
        if (!existing) {
          summaries.set(key, { accountId: account.id, accountLabel: account.label, chatJid: message.chatJid, chatAltJid: message.chatAltJid, chatName: message.chatName, kind, sendTarget, messageCount: 1, lastMessageAt: message.occurredAt, lastText: message.text, lastSenderName: message.senderName });
          return;
        }
        existing.messageCount += 1;
        if (!existing.chatName && message.chatName) existing.chatName = message.chatName;
        if (!existing.chatAltJid && message.chatAltJid) existing.chatAltJid = message.chatAltJid;
        if (!existing.sendTarget && sendTarget) existing.sendTarget = sendTarget;
        if (Date.parse(message.occurredAt) >= Date.parse(existing.lastMessageAt)) {
          existing.lastMessageAt = message.occurredAt; existing.lastText = message.text; existing.lastSenderName = message.senderName;
          if (message.chatName) existing.chatName = message.chatName;
        }
      });
    }
    const needles = terms(input.query ?? "");
    const matches = [...summaries.values()].filter((chat) => !needles.length || needles.every((needle) => [chat.chatName,chat.chatJid,chat.chatAltJid,chat.sendTarget,chat.lastSenderName,chat.accountLabel].filter(Boolean).join(" ").toLocaleLowerCase("es-AR").includes(needle)));
    matches.sort((a,b) => Date.parse(b.lastMessageAt)-Date.parse(a.lastMessageAt));
    return matches.slice(0,limit);
  }

  async searchMessages(input: { query: string; accountIds?: string[]; after?: string; before?: string; limit?: number }): Promise<StoredMessage[]> {
    const needles = terms(input.query);
    if (!needles.length) return [];
    const limit = Math.max(1, Math.min(200, Math.trunc(input.limit ?? 50)));
    if (this.pool) {
      const values: unknown[] = [];
      const filters = ["a.role='input'"];
      if (input.accountIds?.length) { values.push(input.accountIds); filters.push(`m.account_id=ANY($${values.length}::uuid[])`); }
      if (input.after) { values.push(input.after); filters.push(`m.occurred_at >= $${values.length}::timestamptz`); }
      if (input.before) { values.push(input.before); filters.push(`m.occurred_at <= $${values.length}::timestamptz`); }
      for (const needle of needles) { values.push(`%${needle}%`); filters.push(`lower(concat_ws(' ',m.text_content,m.chat_name,m.chat_jid,m.chat_alt_jid,m.sender_name,m.sender_jid,m.sender_alt_jid,m.account_label)) LIKE $${values.length}`); }
      values.push(limit);
      const result = await this.pool.query(
        `SELECT m.* FROM whatsapp_nexo.messages m JOIN whatsapp_nexo.accounts a ON a.id=m.account_id
         WHERE ${filters.join(" AND ")} ORDER BY m.occurred_at DESC LIMIT $${values.length}`,
        values,
      );
      return result.rows.map(messageFromRow);
    }
    const afterMs = input.after ? Date.parse(input.after) : Number.NEGATIVE_INFINITY;
    const beforeMs = input.before ? Date.parse(input.before) : Number.POSITIVE_INFINITY;
    const accounts = (await this.listAccounts()).filter((account) => account.role === "input");
    const selected = input.accountIds?.length ? accounts.filter((account) => input.accountIds!.includes(account.id)) : accounts;
    const matches: StoredMessage[] = [];
    for (const account of selected) {
      await this.scanFile(this.messagePath(account.id), (message) => {
        const timestamp = Date.parse(message.occurredAt);
        if (timestamp < afterMs || timestamp > beforeMs) return;
        const haystack = [message.text,message.chatName,message.chatJid,message.chatAltJid,message.senderName,message.senderJid,message.senderAltJid,account.label].filter(Boolean).join(" ").toLocaleLowerCase("es-AR");
        if (needles.every((needle) => haystack.includes(needle))) matches.push(message);
      });
    }
    matches.sort((a,b) => Date.parse(b.occurredAt)-Date.parse(a.occurredAt));
    return matches.slice(0,limit);
  }
}
