import type { NexoIdentity } from "./settings.js";
import type { AccountRecord, StoredMessage } from "./types.js";

interface SolInputRegistration {
  input: {
    id: string;
    provider: string;
    externalAccountId: string;
    label: string;
    status: string;
  };
}

export interface SolRuntimeTool {
  pluginId: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  requiredScope: "read" | "actions";
  visibility: "private" | "family";
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

  async registerMcpTools(
    callbackUrl: string,
    tools: ReadonlyArray<{
      name: string;
      description: string;
      requiredScope: "read";
      visibility: "private";
      inputSchema: Record<string, unknown>;
    }>,
  ): Promise<void> {
    if (!this.enabled) return;
    await this.request("/v1/plugin-api/mcp/tools/register", {
      callbackUrl,
      tools: [...tools],
    });
  }

  async listAvailableTools(): Promise<SolRuntimeTool[]> {
    if (!this.enabled) return [];
    const response = await this.request<{ tools?: SolRuntimeTool[] }>("/v1/plugin-api/mcp/tools/available", undefined, "GET");
    return Array.isArray(response.tools) ? response.tools : [];
  }

  async invokeTool(tool: SolRuntimeTool, args: Record<string, unknown>): Promise<unknown> {
    if (!this.enabled) throw new Error("SOL plugin bridge is unavailable");
    const route = tool.requiredScope === "actions"
      ? "/v1/plugin-api/mcp/tools/invoke-action"
      : "/v1/plugin-api/mcp/tools/invoke-read";
    return await this.request(route, { name: tool.name, arguments: args });
  }

  // Deliberately NOT exposed to the Codex MCP tool catalog. Only deterministic
  // /agente commands from an explicitly verified human may call these methods.
  async invokeSolAgentCommand(
    name: string, args: Record<string, unknown>,
  ): Promise<unknown> {
    const readOnly = new Set(["sol_agent_missions", "sol_agent_proposals"]);
    const submit = new Set(["sol_agent_goal_create", "sol_agent_goal_pause", "sol_agent_goal_wake", "sol_agent_feedback"]);
    if (readOnly.has(name)) {
      return this.request("/v1/plugin-api/mcp/tools/invoke-read", { name, arguments: args });
    }
    if (submit.has(name)) {
      return this.request("/v1/plugin-api/mcp/tools/invoke-submit", { name, arguments: args });
    }
    throw new Error("sol_agent_command_not_allowlisted");
  }

  async searchWhatsappHistory(query: string, limit?: number): Promise<Array<Record<string, unknown>>> {
    if (!this.enabled) throw new Error("SOL plugin bridge is unavailable");
    const response = await this.request<{ results?: Array<Record<string, unknown>> }>(
      "/v1/plugin-api/mcp/core/search-whatsapp",
      { query, ...(limit !== undefined ? { limit } : {}) },
    );
    return Array.isArray(response.results) ? response.results : [];
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

  async unregisterInput(account: AccountRecord): Promise<void> {
    if (!this.enabled || account.role !== "input") return;
    const sourceAccountId = this.sourceAccounts.get(account.id) ?? await this.ensureInput(account);
    if (!sourceAccountId) return;
    await this.request(`/v1/plugin-api/inputs/${sourceAccountId}`, undefined, "DELETE");
    this.sourceAccounts.delete(account.id);
  }

  async setStatus(account: AccountRecord, status: "connected" | "disconnected" | "error", lastSyncAt?: string): Promise<void> {
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

  async syncNexoIdentities(identities: NexoIdentity[]): Promise<void> {
    if (!this.enabled) return;
    for (const identity of identities) {
      await this.request("/v1/plugin-api/identities/person", {
        externalId: identity.id,
        label: identity.displayName || identity.nickname || identity.id,
        autoLinkMember: false,
        metadata: {
          identityType: "nexo_whatsapp_person",
          nickname: identity.nickname,
          phoneNumbers: identity.phoneNumbers,
          linkedInputAccountIds: identity.linkedInputAccountIds,
          nexoRole: identity.role,
          codexConversationEnabled: identity.codexConversationEnabled,
          source: identity.source,
        },
      });
    }
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
        ...(message.messageType === "audioTranscription" ? {
          transcriptOf: `${message.chatJid}:${message.sourceMessageId.replace(/:transcription$/, "")}`,
          derivedFromAudio: true,
        } : {}),
      },
    });
  }

  private async request<T = Record<string, unknown>>(
    path: string,
    body?: Record<string, unknown>,
    method: "GET" | "POST" | "DELETE" = "POST",
  ): Promise<T> {
    if (!this.token) throw new Error("SOL plugin token is unavailable");
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
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
