import { createServer, type Server } from "node:http";
import { SolPluginClient, type SolRuntimeTool } from "./sol-plugin-client.js";

async function readJson(request: import("node:http").IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > 128 * 1024) throw new Error("request_too_large");
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_json_object");
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

export interface SolToolProxy {
  server: Server;
  url: string;
  close(): Promise<void>;
}

export async function startSolToolProxy(sol: SolPluginClient, port: number): Promise<SolToolProxy> {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    try {
      if (request.method === "GET" && url.pathname === "/tools") {
        const tools = sol.enabled ? await sol.listAvailableTools() : [];
        json(response, 200, { tools });
        return;
      }
      if (request.method === "POST" && url.pathname === "/invoke") {
        const body = await readJson(request);
        const name = typeof body.name === "string" ? body.name : "";
        const scope = body.requiredScope === "actions" ? "actions" : "read";
        const args = body.arguments && typeof body.arguments === "object" && !Array.isArray(body.arguments)
          ? body.arguments as Record<string, unknown>
          : {};
        const tools = await sol.listAvailableTools();
        const tool = tools.find((item: SolRuntimeTool) => item.name === name && item.requiredScope === scope);
        if (!tool) {
          json(response, 404, { error: "sol_tool_not_available" });
          return;
        }
        json(response, 200, { result: await sol.invokeTool(tool, args) });
        return;
      }
      if (request.method === "GET" && url.pathname === "/health") {
        json(response, 200, { ok: true, solConnected: sol.enabled });
        return;
      }
      json(response, 404, { error: "not_found" });
    } catch (error) {
      json(response, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  return {
    server,
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
