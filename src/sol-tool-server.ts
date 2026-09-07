import { createServer, type Server } from "node:http";
import { executeNexoSolTool } from "./sol-tools.js";

async function readJson(request: import("node:http").IncomingMessage, maxBytes = 256_000): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw new Error("request_too_large");
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  const value = text ? JSON.parse(text) : {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("tool_input_must_be_object");
  return value as Record<string, unknown>;
}

function json(response: import("node:http").ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  response.end(payload);
}

export async function startSolToolCallbackServer(): Promise<{ server: Server; baseUrl: string }> {
  const expectedToken = process.env.SOL_PLUGIN_TOKEN?.trim();
  if (!expectedToken) throw new Error("SOL_PLUGIN_TOKEN is required for the SOL tool callback server");

  const server = createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    const match = url.pathname.match(/^\/api\/sol-tools\/([^/]+)$/);
    if (!match) {
      json(response, 404, { error: "not_found" });
      return;
    }
    const supplied = request.headers.authorization?.replace(/^Bearer\s+/i, "").trim();
    if (!supplied || supplied !== expectedToken) {
      json(response, 401, { error: "invalid_sol_plugin_token" });
      return;
    }
    if (request.method !== "POST") {
      json(response, 405, { error: "method_not_allowed" });
      return;
    }
    try {
      const toolName = decodeURIComponent(match[1]!);
      const input = await readJson(request);
      json(response, 200, await executeNexoSolTool(toolName, input));
    } catch (error) {
      json(response, 400, { error: error instanceof Error ? error.message : String(error) });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Could not resolve SOL tool callback address");
  }
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}
