import type { AccountRecord } from "./types.js";
import type { WhatsappContactsStore } from "./contacts.js";

/** Core MCP tools must carry the plugin ID prefix, unlike Nexo's standalone
 * stdio MCP server. These tools are private and read-only by design. */
export const NEXO_CONTACT_MCP_TOOLS = [
  {
    name: "nexo_whatsapp_list_contacts",
    description: "Search the WhatsApp contacts ingested by Nexo on linked INPUT accounts, by name or phone. Supports optional accountId, query, offset, and limit. Private read-only; contacts are not authorization to send WhatsApp messages.",
    requiredScope: "read",
    visibility: "private",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", maxLength: 200, description: "Optional name, alias or phone search" },
        accountId: { type: "string", maxLength: 100, description: "Optional INPUT account ID" },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 30 },
        offset: { type: "integer", minimum: 0, maximum: 1000000, default: 0 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "nexo_whatsapp_contacts_status",
    description: "Count WhatsApp contacts ingested by Nexo for linked INPUT accounts, with per-account totals. This is not a count of the entire phone address book. Private read-only.",
    requiredScope: "read",
    visibility: "private",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
] as const;

type CallbackResponse = { status: number; payload: unknown };
const PLUGIN_ID = "nexo-whatsapp";

function record(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}
function invalid(): CallbackResponse {
  return { status: 400, payload: { error: "invalid_nexo_mcp_request" } };
}

export async function handleNexoContactsMcp(
  value: unknown,
  accounts: AccountRecord[],
  contacts?: WhatsappContactsStore,
): Promise<CallbackResponse> {
  const body = record(value);
  if (!body || body.pluginId !== PLUGIN_ID) return invalid();
  if (body.type === "sol.plugin.mcp.probe") {
    return { status: 200, payload: { ok: true, pluginId: PLUGIN_ID } };
  }
  if (body.type !== "sol.plugin.mcp.invoke" || !contacts) {
    return { status: contacts ? 400 : 503, payload: { error: contacts ? "invalid_nexo_mcp_request" : "contacts_unavailable" } };
  }

  const inputs = accounts.filter(account => account.role === "input");
  const inputIds = new Set(inputs.map(account => account.id));
  const args = record(body.arguments) ?? {};
  const tool = body.tool;
  if (tool === "nexo_whatsapp_contacts_status") {
    if (Object.keys(args).length) return invalid();
    const stats = await contacts.stats([...inputIds]);
    return {
      status: 200,
      payload: { ...stats, accounts: inputs.map(a => ({ id: a.id, label: a.label })) },
    };
  }
  if (tool !== "nexo_whatsapp_list_contacts") return { status: 404, payload: { error: "nexo_mcp_tool_unknown" } };

  if (Object.keys(args).some(k => !["query", "accountId", "limit", "offset"].includes(k))) return invalid();
  const id = args.accountId;
  if (id !== undefined && (typeof id !== "string" || !inputIds.has(id))) {
    return { status: 403, payload: { error: "contacts_input_account_required" } };
  }
  if (args.query !== undefined && (typeof args.query !== "string" || args.query.length > 200)) return invalid();
  if (args.limit !== undefined && (!Number.isInteger(args.limit) || (args.limit as number) < 1 || (args.limit as number) > 100)) return invalid();
  if (args.offset !== undefined && (!Number.isInteger(args.offset) || (args.offset as number) < 0 || (args.offset as number) > 1_000_000)) return invalid();

  const accountIds = typeof id === "string" ? [id] : [...inputIds];
  const query = typeof args.query === "string" ? args.query.trim() : undefined;
  const limit = typeof args.limit === "number" ? args.limit : 30;
  const offset = typeof args.offset === "number" ? args.offset : 0;
  const result = await contacts.list({ accountIds, query, limit, offset });
  return {
    status: 200,
    payload: { ...result, accounts: inputs.map(a => ({ id: a.id, label: a.label })) },
  };
}
