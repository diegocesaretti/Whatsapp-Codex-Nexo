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

export class SolPluginClient {
  readonly enabled: boolean;
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly sourceAccounts = new Map<string, string>();

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.baseUrl = (env.SOL_PLUGIN_API_URL || env.SOL_CORE_URL || "").trim().replace(/\/$/, "");
    this.token = env.SOL_PLUGIN_TOKEN?.trim();
    this.enabled = Boolean(this.baseUrl && this.token);
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
    const cached = this.sourceAccounts.get(account.id);
    if (cached) return cached;
    const response = await this.request<SolInputRegistration>("/v1/plugin-api/inputs/register", {
      provider: "whatsapp",
      externalAccountId: account.phoneJid?.trim() || account.id,
      label: account.label,
    });
    this.sourceAccounts.set(account.id, response.input.id);
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
    const sourceAccountId = this.sourceAccounts.get(accountId);
    if (!sourceAccountId) return;
    await this.request(`/v1/plugin-api/inputs/${sourceAccountId}/status`, { status: "disconnected" });
  }

  async ingestWhatsappMessage(account: AccountRecord, message: StoredMessage): Promise<void> {
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
      throw new Error(`SOL Plugin API: ${reason}`);
    }
    return payload as T;
  }
}
