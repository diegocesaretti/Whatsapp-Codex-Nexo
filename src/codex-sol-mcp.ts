import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";

interface RuntimeTool {
  pluginId: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  requiredScope: "read" | "actions";
}

const proxyUrl = (process.env.NEXO_SOL_TOOL_PROXY_URL || "http://127.0.0.1:3211").replace(/\/$/, "");

function zodValue(definition: unknown): any {
  const input = definition && typeof definition === "object" && !Array.isArray(definition)
    ? definition as Record<string, unknown>
    : {};
  let value: any;
  if (Object.prototype.hasOwnProperty.call(input, "const")) value = z.literal(input.const as any);
  else if (Array.isArray(input.enum) && input.enum.length > 0 && input.enum.every((item) => typeof item === "string")) value = z.enum(input.enum as [string, ...string[]]);
  else if (input.type === "string") value = z.string();
  else if (input.type === "integer") value = z.number().int();
  else if (input.type === "number") value = z.number();
  else if (input.type === "boolean") value = z.boolean();
  else if (input.type === "array") value = z.array(zodValue(input.items));
  else if (input.type === "object") value = z.record(z.string(), z.unknown());
  else value = z.unknown();
  if (typeof input.description === "string" && input.description.trim()) value = value.describe(input.description.trim());
  return value;
}

function zodInputSchema(schema: Record<string, unknown>): any {
  const properties = schema.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties)
    ? schema.properties as Record<string, unknown>
    : {};
  const required = new Set(Array.isArray(schema.required) ? schema.required.filter((item): item is string => typeof item === "string") : []);
  const shape: Record<string, any> = {};
  for (const [name, definition] of Object.entries(properties)) {
    const value = zodValue(definition);
    shape[name] = required.has(name) ? value : value.optional();
  }
  return schema.additionalProperties === false ? z.object(shape).strict() : z.object(shape).passthrough();
}

async function proxy<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${proxyUrl}${path}`, {
    ...options,
    headers: { ...(options.body ? { "content-type": "application/json" } : {}), ...(options.headers || {}) },
    signal: AbortSignal.timeout(12_000),
  });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : `HTTP ${response.status}`);
  return body as T;
}

function text(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

async function main(): Promise<void> {
  const listing = await proxy<{ tools?: RuntimeTool[] }>("/tools");
  const tools = Array.isArray(listing.tools) ? listing.tools : [];

  serveStdio(() => {
    const server = new McpServer({ name: "sol-nexo-runtime", version: "0.1.0" });
    for (const tool of tools) {
      server.registerTool(
        tool.name,
        {
          description: `${tool.description}\n\nProvided through SOL by plugin ${tool.pluginId}. Scope: ${tool.requiredScope}.`,
          inputSchema: zodInputSchema(tool.inputSchema),
        },
        async (args: Record<string, unknown>) => {
          const result = await proxy<{ result?: unknown }>("/invoke", {
            method: "POST",
            body: JSON.stringify({ name: tool.name, requiredScope: tool.requiredScope, arguments: args }),
          });
          return text(result.result);
        },
      );
    }
    return server;
  });
}

void main().catch((error) => {
  console.error(`SOL Nexo MCP failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
