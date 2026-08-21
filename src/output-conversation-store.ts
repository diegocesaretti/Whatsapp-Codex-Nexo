import { appendFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { Pool, type QueryResultRow } from "pg";
import { normalizePhoneNumber } from "./output-conversation-auth.js";
import type { OutputConversationDirection, OutputConversationMessage } from "./types.js";

interface AckFile {
  version: 1;
  acknowledged: Record<string, string>;
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}

function fromRow(row: QueryResultRow): OutputConversationMessage {
  return {
    id: String(row.id),
    accountId: row.account_id ? String(row.account_id) : undefined,
    whatsappMessageId: String(row.whatsapp_message_id),
    peerJid: String(row.peer_jid),
    peerAltJid: row.peer_alt_jid ? String(row.peer_alt_jid) : undefined,
    peerPhone: String(row.peer_phone),
    direction: row.direction as OutputConversationDirection,
    text: row.text_content === null || row.text_content === undefined ? undefined : String(row.text_content),
    messageType: row.message_type ? String(row.message_type) : undefined,
    senderName: row.sender_name ? String(row.sender_name) : undefined,
    authorized: Boolean(row.authorized),
    occurredAt: iso(row.occurred_at),
    replyToId: row.reply_to_id ? String(row.reply_to_id) : undefined,
    acknowledgedAt: row.acknowledged_at ? iso(row.acknowledged_at) : undefined,
  };
}

async function atomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temp, path);
}

export class OutputConversationStore {
  private readonly messagesPath: string;
  private readonly ackPath: string;
  private readonly pool?: Pool;
  private seenPromise?: Promise<Set<string>>;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly dataDir: string, databaseUrl?: string) {
    this.messagesPath = join(dataDir, "output-conversation.jsonl");
    this.ackPath = join(dataDir, "output-conversation-acks.json");
    if (databaseUrl) {
      this.pool = new Pool({
        connectionString: databaseUrl,
        max: 2,
        idleTimeoutMillis: 15_000,
        connectionTimeoutMillis: 15_000,
        application_name: "whatsapp-codex-nexo-conversation",
      });
    }
  }

  get storageMode(): "neon" | "local" {
    return this.pool ? "neon" : "local";
  }

  async init(): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    if (!this.pool) return;
    const result = await this.pool.query<{ exists: boolean }>(
      "SELECT to_regclass('whatsapp_nexo.output_conversation_messages') IS NOT NULL AS exists",
    );
    if (!result.rows[0]?.exists) {
      throw new Error("Neon is configured but whatsapp_nexo.output_conversation_messages is missing. Apply migration 002_output_conversation.sql first.");
    }
  }

  async close(): Promise<void> {
    await this.pool?.end();
  }

  private async scanLocal(): Promise<OutputConversationMessage[]> {
    try { await stat(this.messagesPath); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const result: OutputConversationMessage[] = [];
    const lines = createInterface({ input: createReadStream(this.messagesPath, { encoding: "utf8" }), crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line.trim()) continue;
      try { result.push(JSON.parse(line) as OutputConversationMessage); } catch {}
    }
    return result;
  }

  private async localAcks(): Promise<AckFile> {
    try {
      return JSON.parse(await readFile(this.ackPath, "utf8")) as AckFile;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, acknowledged: {} };
      throw error;
    }
  }

  private async seen(): Promise<Set<string>> {
    if (!this.seenPromise) {
      this.seenPromise = this.scanLocal().then((messages) => new Set(messages.map((message) => message.id)));
    }
    return this.seenPromise;
  }

  async append(message: OutputConversationMessage): Promise<boolean> {
    if (this.pool) {
      const result = await this.pool.query(
        `INSERT INTO whatsapp_nexo.output_conversation_messages
          (id,account_id,whatsapp_message_id,peer_jid,peer_alt_jid,peer_phone,direction,text_content,message_type,sender_name,authorized,occurred_at,reply_to_id,acknowledged_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (id) DO NOTHING RETURNING id`,
        [
          message.id,
          message.accountId ?? null,
          message.whatsappMessageId,
          message.peerJid,
          message.peerAltJid ?? null,
          message.peerPhone,
          message.direction,
          message.text ?? null,
          message.messageType ?? null,
          message.senderName ?? null,
          message.authorized,
          message.occurredAt,
          message.replyToId ?? null,
          message.acknowledgedAt ?? null,
        ],
      );
      return Boolean(result.rowCount);
    }

    const seen = await this.seen();
    if (seen.has(message.id)) return false;
    seen.add(message.id);
    this.writeChain = this.writeChain.catch(() => undefined).then(async () => {
      await mkdir(dirname(this.messagesPath), { recursive: true });
      await appendFile(this.messagesPath, `${JSON.stringify(message)}\n`, "utf8");
    });
    await this.writeChain;
    return true;
  }

  async get(id: string): Promise<OutputConversationMessage | undefined> {
    const clean = id.trim();
    if (!clean) return undefined;
    if (this.pool) {
      const result = await this.pool.query("SELECT * FROM whatsapp_nexo.output_conversation_messages WHERE id=$1", [clean]);
      return result.rows[0] ? fromRow(result.rows[0]) : undefined;
    }
    const acks = await this.localAcks();
    const found = (await this.scanLocal()).find((message) => message.id === clean);
    if (!found) return undefined;
    const acknowledgedAt = acks.acknowledged[found.id];
    return acknowledgedAt ? { ...found, acknowledgedAt } : found;
  }

  async list(input: {
    peer?: string;
    limit?: number;
    pendingOnly?: boolean;
    direction?: OutputConversationDirection;
  } = {}): Promise<OutputConversationMessage[]> {
    const limit = Math.max(1, Math.min(500, Math.trunc(input.limit ?? 80)));
    const peerPhone = input.peer ? normalizePhoneNumber(input.peer) : undefined;

    if (this.pool) {
      const values: unknown[] = [];
      const filters: string[] = ["authorized = true"];
      if (peerPhone) { values.push(peerPhone); filters.push(`peer_phone = $${values.length}`); }
      if (input.direction) { values.push(input.direction); filters.push(`direction = $${values.length}`); }
      if (input.pendingOnly) filters.push("direction = 'inbound' AND acknowledged_at IS NULL");
      values.push(limit);
      const result = await this.pool.query(
        `SELECT * FROM (
           SELECT * FROM whatsapp_nexo.output_conversation_messages
           WHERE ${filters.join(" AND ")}
           ORDER BY occurred_at DESC
           LIMIT $${values.length}
         ) recent ORDER BY occurred_at ASC`,
        values,
      );
      return result.rows.map(fromRow);
    }

    const acks = await this.localAcks();
    let messages = (await this.scanLocal()).map((message) => {
      const acknowledgedAt = acks.acknowledged[message.id];
      return acknowledgedAt ? { ...message, acknowledgedAt } : message;
    }).filter((message) => message.authorized);
    if (peerPhone) messages = messages.filter((message) => message.peerPhone === peerPhone);
    if (input.direction) messages = messages.filter((message) => message.direction === input.direction);
    if (input.pendingOnly) messages = messages.filter((message) => message.direction === "inbound" && !message.acknowledgedAt);
    messages.sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
    return messages.slice(0, limit).reverse();
  }

  async acknowledge(ids: string[]): Promise<number> {
    const clean = [...new Set(ids.map((id) => id.trim()).filter(Boolean))].slice(0, 500);
    if (!clean.length) return 0;
    const now = new Date().toISOString();
    if (this.pool) {
      const result = await this.pool.query(
        `UPDATE whatsapp_nexo.output_conversation_messages
         SET acknowledged_at = COALESCE(acknowledged_at, $2)
         WHERE id = ANY($1::uuid[]) AND direction='inbound' AND authorized=true`,
        [clean, now],
      );
      return result.rowCount ?? 0;
    }
    const existing = await this.localAcks();
    const known = new Set((await this.scanLocal()).filter((message) => message.direction === "inbound" && message.authorized).map((message) => message.id));
    let changed = 0;
    for (const id of clean) {
      if (!known.has(id) || existing.acknowledged[id]) continue;
      existing.acknowledged[id] = now;
      changed += 1;
    }
    if (changed) await atomicJson(this.ackPath, existing);
    return changed;
  }
}
