import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";
import { config } from "./config.js";
import { WhatsappSummarizer } from "./llm.js";
import { AppSettingsStore, getWindowsAutostart, setWindowsAutostart } from "./settings.js";
import { BridgeStore } from "./store.js";
import { WhatsappManager } from "./whatsapp-manager.js";
import { renderAdminPage } from "./ui.js";
import type { AccountRole } from "./types.js";

async function readJson<T>(request: IncomingMessage, maxBytes = 256_000): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw new Error("request_too_large");
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return (text ? JSON.parse(text) : {}) as T;
}

function json(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(payload), "cache-control": "no-store" });
  response.end(payload);
}

function html(response: ServerResponse, body: string): void {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  response.end(body);
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }

export function createBridgeServer(store: BridgeStore, manager: WhatsappManager, settingsStore: AppSettingsStore, summarizer: WhatsappSummarizer) {
  return createServer(async (request, response) => {
    const url = new URL(request.url || "/", `http://${request.headers.host || `${config.host}:${config.port}`}`);
    const path = url.pathname;
    try {
      if (request.method === "GET" && path === "/") { html(response, renderAdminPage()); return; }
      if (request.method === "GET" && path === "/health") {
        json(response, 200, { ok: true, product: "WhatsApp Codex Nexo", storage: store.storageMode, time: new Date().toISOString() }); return;
      }
      if (request.method === "GET" && path === "/api/settings") {
        const publicSettings = await settingsStore.publicState();
        json(response, 200, {
          ...publicSettings,
          windowsAutostart: await getWindowsAutostart(),
          platform: process.platform,
          storage: { mode: store.storageMode, databaseConfigured: Boolean(config.databaseUrl), schema: store.storageMode === "neon" ? "whatsapp_nexo" : undefined, dataDir: config.dataDir },
          server: { host: config.host, port: config.port },
        }); return;
      }
      if (request.method === "PUT" && path === "/api/settings") {
        const body = await readJson<any>(request);
        const current = await settingsStore.get();
        const settings = await settingsStore.update({
          autoConnectLinkedAccounts: body.autoConnectLinkedAccounts,
          openDashboardOnLaunch: body.openDashboardOnLaunch,
          uiRefreshMs: body.uiRefreshMs,
          maxSearchResults: body.maxSearchResults,
          llm: body.llm ? { ...current.llm, ...body.llm } : undefined,
        });
        if (typeof body.llmApiKey === "string") await settingsStore.setLlmApiKey(body.llmApiKey);
        const windowsAutostart = body.windowsAutostart === undefined ? await getWindowsAutostart() : await setWindowsAutostart(Boolean(body.windowsAutostart));
        json(response, 200, { settings, llmApiKeyConfigured: Boolean(await settingsStore.getLlmApiKey()), windowsAutostart, restartRecommended: true }); return;
      }
      if (request.method === "POST" && path === "/api/llm/summarize") {
        const body = await readJson<{ query?: string; accountIds?: string[]; after?: string; before?: string; limit?: number; focus?: string }>(request);
        json(response, 200, await summarizer.summarize(body)); return;
      }
      if (request.method === "GET" && path === "/api/state") {
        const [accounts, settings] = await Promise.all([store.listAccounts(), settingsStore.get()]);
        json(response, 200, {
          accounts: accounts.map((account) => ({ ...account, runtime: manager.getStatus(account.id) })), settings, storage: store.storageMode,
          policy: { multipleInputs: true, singleOutput: true, inputAccountsCanSend: false, outputAccountIsIndexed: false },
        }); return;
      }
      if (request.method === "POST" && path === "/api/accounts") {
        const body = await readJson<{ label?: string; role?: AccountRole }>(request);
        if (body.role !== "input" && body.role !== "output") { json(response, 400, { error: "role must be input or output" }); return; }
        json(response, 201, await store.createAccount(body.label || "", body.role)); return;
      }

      const accountAction = path.match(/^\/api\/accounts\/([0-9a-f-]+)\/(connect|restart|logout)$/i);
      if (request.method === "POST" && accountAction) {
        const accountId = accountAction[1]!; const action = accountAction[2]!;
        if (action === "logout") { await manager.logout(accountId); json(response, 200, { ok: true }); }
        else json(response, 200, action === "restart" ? await manager.restart(accountId) : await manager.start(accountId));
        return;
      }
      if (request.method === "GET" && path === "/api/chats") {
        const accountIds = url.searchParams.getAll("accountId"); const query = url.searchParams.get("q")?.trim() || undefined; const limit = Number(url.searchParams.get("limit") || 50);
        json(response, 200, { chats: await store.listChats({ query, accountIds, limit }) }); return;
      }
      if (request.method === "GET" && path === "/api/messages/recent") {
        const accountIds = url.searchParams.getAll("accountId"); const limit = Number(url.searchParams.get("limit") || 40);
        json(response, 200, { messages: await store.recentMessages({ accountIds, limit }) }); return;
      }
      if (request.method === "POST" && path === "/api/messages/search") {
        const body = await readJson<{ query?: string; accountIds?: string[]; after?: string; before?: string; limit?: number }>(request);
        const query = body.query?.trim() || "";
        if (query.length < 2) { json(response, 400, { error: "query must contain at least 2 characters" }); return; }
        const settings = await settingsStore.get();
        json(response, 200, { messages: await store.searchMessages({ query, accountIds: body.accountIds, after: body.after, before: body.before, limit: Math.min(settings.maxSearchResults, body.limit ?? 50) }) }); return;
      }
      if (request.method === "POST" && path === "/api/output/reply") {
        const body = await readJson<{ storedMessageId?: string; text?: string; reason?: string; confirmedByUser?: boolean }>(request);
        if (body.confirmedByUser !== true) { json(response, 403, { error: "confirmedByUser=true is required for outbound WhatsApp" }); return; }
        const storedMessageId = body.storedMessageId?.trim() || "";
        if (!storedMessageId) { json(response, 400, { error: "storedMessageId is required" }); return; }
        const audit = await manager.replyToArchivedMessage({ storedMessageId, text: body.text || "", reason: body.reason });
        json(response, 200, { sent: true, contextualReply: true, nativeQuote: false, audit }); return;
      }
      if (request.method === "POST" && path === "/api/output/send") {
        const body = await readJson<{ to?: string; text?: string; reason?: string; confirmedByUser?: boolean }>(request);
        if (body.confirmedByUser !== true) { json(response, 403, { error: "confirmedByUser=true is required for outbound WhatsApp" }); return; }
        const audit = await manager.sendText({ to: body.to || "", text: body.text || "", reason: body.reason });
        json(response, 200, { sent: true, audit }); return;
      }
      json(response, 404, { error: "not_found" });
    } catch (error) {
      console.error(`[http] ${request.method} ${path}`, error);
      json(response, 500, { error: errorMessage(error) });
    }
  });
}
