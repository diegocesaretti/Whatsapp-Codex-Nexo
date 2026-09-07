import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { safePhoneJid } from "./output-conversation-auth.js";
import type { AccountRecord, StoredMessage } from "./types.js";
import type { SolToolDefinition } from "./sol-tools.js";

interface SolInputRegistration {
  input: {
    id: string;
    provider: string;
    externalAccountId: string;
    label: string;
    status: string;
  };
}

interface CachedSourceAccount {
  sourceAccountId: string;
  externalAccountId: string;
}

interface SolOutboxItem {
  id: string;
  account: Pick<AccountRecord, "id" | "label" | "role" | "enabled" | "createdAt" | "phoneJid" | "displayName">;
  message: StoredMessage;
  attempts: number;
  createdAt: string;
  lastAttemptAt?: string;
  lastError?: string;
}

interface SolOutboxFile {
  version: 1;
  items: SolOutboxItem[];
  deadLetters?: SolOutboxItem[];
}

class SolPluginApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "SolPluginApiError";
  }
}

export function isRetryableSolHttpStatus(status: number): boolean {
  if (status >= 500) return true;
  return status === 401 || status === 403 || status === 404 || status === 405 || status === 408 || status === 425 || status === 429;
}

export function canonicalWhatsappAccountId(account: Pick<AccountRecord, "id" | "phoneJid">): string {
  return safePhoneJid(account.phoneJid) || account.id;
}

export class SolPluginClient {
  readonly enabled: boolean;
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly dataDir: string;
  private readonly outboxPath: string;
  private readonly sourceAccounts = new Map<string, CachedSourceAccount>();
  private outboxLock: Promise<void> = Promise.resolve();
  private retryTimer?: NodeJS.Timeout;
  private stopping = false;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.baseUrl = (env.SOL_PLUGIN_API_URL || env.SOL_CORE_URL || "").trim().replace(/\/$/, "");
    this.token = env.SOL_PLUGIN_TOKEN?.trim();
    this.enabled = Boolean(this.baseUrl && this.token);
    this.dataDir = resolve(env.SOL_PLUGIN_DATA_DIR?.trim() || env.NEXO_WHATSAPP_DATA_DIR?.trim() || ".data");
    this.outboxPath = join(this.dataDir, "sol-ingestion-outbox.json");
  }

  async start(): Promise<void> {
    if (!this.enabled || this.retryTimer) return;
    this.stopping = false;
    await mkdir(this.dataDir, { recursive: true });
    this.retryTimer = setInterval(() => {
      void this.flushOutbox().catch((error) => {
        this.log("warn", `SOL ingestion retry loop failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    }, 15_000);
    this.retryTimer.unref?.();
    void this.flushOutbox().catch((error) => {
      this.log("warn", `Initial SOL ingestion backlog drain failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.retryTimer) clearInterval(this.retryTimer);
    this.retryTimer = undefined;
    if (this.enabled) await this.flushOutbox().catch(() => undefined);
  }

  reportReady(details: Record<string, unknown> = {}): void {
    if (!this.enabled) return;
    console.log(JSON.stringify({ type: "sol.plugin.ready", health: "healthy", details }));
  }

  reportHealth(status: "healthy" | "degraded" | "unhealthy", details: Record<string, unknown> = {}): void {
    if (!this.enabled) return;
    console.log(JSON.stringify({ type: "sol.plugin.health", status, details }));
  }

  log(level: "debug" | "info" | "warn" | "error", message: string): void {
    if (!this.enabled) return;
    console.log(JSON.stringify({ type: "sol.plugin.log", level, message }));
  }

  async registerTools(baseUrl: string, tools: SolToolDefinition[]): Promise<void> {
    if (!this.enabled) return;
    await this.request("/v1/plugin-api/tools/register", {
      transport: "http",
      baseUrl,
      tools,
    });
    this.log("info", `Registered ${tools.length} WhatsApp tool(s) in SOL MCP`);
  }

  async ensureInput(account: AccountRecord): Promise<string | undefined> {
    if (!this.enabled || account.role !== "input") return undefined;
    const externalAccountId = canonicalWhatsappAccountId(account);
    const cached = this.sourceAccounts.get(account.id);
    if (cached?.externalAccountId === externalAccountId) return cached.sourceAccountId;
    const response = await this.request<SolInputRegistration>("/v1/plugin-api/inputs/register", {
      provider: "whatsapp",
      externalAccountId,
      label: account.label,
    });
    this.sourceAccounts.set(account.id, {
      sourceAccountId: response.input.id,
      externalAccountId,
    });
    return response.input.id;
  }

  async setStatus(
    account: AccountRecord,
    status: "connected" | "disconnected" | "error",
    lastSyncAt?: string,
  ): Promise<void> {
    if (!this.sourceAccounts.has(account.id) && !account.phoneJid?.trim() && status !== "connected") return;
    const sourceAccountId = await this.ensureInput(account);
    if (!sourceAccountId) return;
    await this.request(`/v1/plugin-api/inputs/${sourceAccountId}/status`, {
      status,
      ...(lastSyncAt ? { lastSyncAt } : {}),
    });
  }

  async setDisconnectedByAccountId(accountId: string): Promise<void> {
    if (!this.enabled) return;
    const cached = this.sourceAccounts.get(accountId);
    if (!cached) return;
    await this.request(`/v1/plugin-api/inputs/${cached.sourceAccountId}/status`, { status: "disconnected" });
  }

  async ingestWhatsappMessage(account: AccountRecord, message: StoredMessage): Promise<void> {
    if (!this.enabled || account.role !== "input") return;
    const item: SolOutboxItem = {
      id: `${account.id}:${message.chatJid}:${message.sourceMessageId}`,
      account: {
        id: account.id,
        label: account.label,
        role: account.role,
        enabled: account.enabled,
        createdAt: account.createdAt,
        phoneJid: account.phoneJid,
        displayName: account.displayName,
      },
      message,
      attempts: 0,
      createdAt: new Date().toISOString(),
    };

    await this.withOutboxLock(async () => {
      const outbox = await this.readOutbox();
      if (!outbox.items.some((existing) => existing.id === item.id)) {
        outbox.items.push(item);
        await this.writeOutbox(outbox);
      }
    });
    void this.flushOutbox().catch((error) => {
      this.log("warn", `SOL ingestion delivery attempt failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  async flushOutbox(): Promise<void> {
    if (!this.enabled) return;
    await this.withOutboxLock(async () => {
      const outbox = await this.readOutbox();
      if (!outbox.items.length) return;

      let changed = false;
      while (outbox.items.length) {
        const item = outbox.items[0]!;
        try {
          await this.deliverWhatsappMessage(item.account as AccountRecord, item.message);
          outbox.items.shift();
          changed = true;
        } catch (error) {
          item.attempts += 1;
          item.lastAttemptAt = new Date().toISOString();
          item.lastError = error instanceof Error ? error.message : String(error);
          changed = true;

          const permanentHttpFailure = error instanceof SolPluginApiError && !isRetryableSolHttpStatus(error.status);
          if (permanentHttpFailure) {
            outbox.items.shift();
            const deadLetters = outbox.deadLetters ?? (outbox.deadLetters = []);
            deadLetters.push(item);
            if (deadLetters.length > 500) deadLetters.splice(0, deadLetters.length - 500);
            this.reportHealth("degraded", {
              reason: "sol_ingestion_dead_letter",
              status: error.status,
              pendingItems: outbox.items.length,
              deadLetters: deadLetters.length,
            });
            this.log("error", `SOL ingestion moved permanent failure to dead letter: ${item.lastError}`);
            continue;
          }

          this.reportHealth("degraded", {
            reason: "sol_ingestion_pending",
            pendingItems: outbox.items.length,
            attempts: item.attempts,
          });
          this.log("warn", `SOL ingestion queued for retry: ${item.lastError}`);
          break;
        }
      }

      if (changed) await this.writeOutbox(outbox);
      if (!outbox.items.length && !this.stopping) {
        const deadLetters = outbox.deadLetters?.length ?? 0;
        this.reportHealth(deadLetters ? "degraded" : "healthy", {
          ingestionOutbox: 0,
          ...(deadLetters ? { deadLetters } : {}),
        });
      }
    });
  }

  private async deliverWhatsappMessage(account: AccountRecord, message: StoredMessage): Promise<void> {
    const sourceAccountId = await this.ensureInput(account);
    if (!sourceAccountId) return;
    await this.request(`/v1/plugin-api/inputs/${sourceAccountId}/items`, {
      externalId: `${message.chatJid}:${message.sourceMessageId}`,
      kind: "message",
      occurredAt: message.occurredAt,
      observedAt: new Date().toISOString(),
      title: message.chatName || message.senderName || account.label,
      text: message.text,
      origin: message.origin,
      metadata: {
        accountLabel: account.label,
        sourceMessageId: message.sourceMessageId,
        chatJid: message.chatJid,
        chatAltJid: message.chatAltJid,
        chatName: message.chatName,
        senderJid: message.senderJid,
        senderAltJid: message.senderAltJid,
        senderName: message.senderName,
        addressingMode: message.addressingMode,
        fromMe: message.fromMe,
        messageType: message.messageType,
      },
    });
  }

  private async readOutbox(): Promise<SolOutboxFile> {
    try {
      const parsed = JSON.parse(await readFile(this.outboxPath, "utf8")) as Partial<SolOutboxFile>;
      return {
        version: 1,
        items: Array.isArray(parsed.items) ? parsed.items as SolOutboxItem[] : [],
        deadLetters: Array.isArray(parsed.deadLetters) ? parsed.deadLetters as SolOutboxItem[] : [],
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        this.log("warn", `Could not read SOL ingestion outbox: ${error instanceof Error ? error.message : String(error)}`);
      }
      return { version: 1, items: [], deadLetters: [] };
    }
  }

  private async writeOutbox(outbox: SolOutboxFile): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    const temporary = `${this.outboxPath}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(outbox, null, 2) + "\n", "utf8");
    await rename(temporary, this.outboxPath);
  }

  private async withOutboxLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.outboxLock;
    let release!: () => void;
    this.outboxLock = new Promise<void>((resolveLock) => { release = resolveLock; });
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private async request<T = Record<string, unknown>>(path: string, body: Record<string, unknown>): Promise<T> {
    if (!this.token) throw new Error("SOL plugin token is unavailable");
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      const reason = typeof payload.error === "string" ? payload.error : `HTTP ${response.status}`;
      throw new SolPluginApiError(`SOL Plugin API: ${reason}`, response.status);
    }
    return payload as T;
  }
}
