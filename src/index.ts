import { AttachmentInbox } from "./attachment-inbox.js";
import { CodexConversationWorker } from "./codex-conversation-worker.js";
import { config } from "./config.js";
import { WhatsappSummarizer } from "./llm.js";
import { installMultimodalCapture } from "./multimodal-capture.js";
import { NexoBridgeStore } from "./nexo-store.js";
import { OutputConversationStore } from "./output-conversation-store.js";
import { createBridgeServer } from "./server.js";
import { AppSettingsStore } from "./settings.js";
import { retryTransientStartup } from "./startup-retry.js";
import { SolPluginClient } from "./sol-plugin-client.js";
import { startSolToolCallbackServer } from "./sol-tool-server.js";
import { nexoSolTools } from "./sol-tools.js";
import { WhatsappManager } from "./whatsapp-manager.js";

const settingsStore = new AppSettingsStore(config.dataDir);
let settings = await settingsStore.get();
const store = new NexoBridgeStore(config.dataDir, config.databaseUrl, settingsStore);
const conversationStore = new OutputConversationStore(config.dataDir, config.databaseUrl);
const attachmentInbox = new AttachmentInbox(config.dataDir);
await retryTransientStartup("primary storage", () => store.init());
await retryTransientStartup("OUTPUT conversation storage", () => conversationStore.init());
await settingsStore.syncInputIdentities(await store.listAccounts());
settings = await settingsStore.get();
await attachmentInbox.init();
await attachmentInbox.cleanup(settings.multimodal.retentionDays).catch(() => undefined);

const solPlugin = new SolPluginClient();
await solPlugin.start();
const manager = new WhatsappManager(store, settingsStore, conversationStore, solPlugin);
installMultimodalCapture(manager, settingsStore, attachmentInbox);
if (settings.autoConnectLinkedAccounts) await manager.startLinkedAccounts();

const summarizer = new WhatsappSummarizer(store, settingsStore);
const codexWorker = new CodexConversationWorker(config.dataDir, settingsStore, conversationStore, manager, attachmentInbox);
const server = createBridgeServer(store, manager, settingsStore, summarizer, conversationStore, codexWorker);
let solToolServer: Awaited<ReturnType<typeof startSolToolCallbackServer>>["server"] | undefined;

server.listen(config.port, config.host, () => {
  console.log(`WhatsApp Codex Nexo listening on http://${config.host}:${config.port}`);
  console.log(`Storage: ${store.storageMode}${store.storageMode === "neon" ? ` (schema whatsapp_nexo · source ${config.databaseSource})` : " (.data local)"}`);
  console.log(`LLM summarizer: ${settings.llm.enabled ? `${settings.llm.baseUrl} · ${settings.llm.model} · ${settings.llm.defaultLookbackDays}d default window` : "disabled"}`);
  console.log(`OUTPUT conversation: ${settings.outputConversation.enabled ? `enabled for ${settings.outputConversation.authorizedNumbers.length} authorized number(s) across ${settings.outputConversation.identities.length} identity record(s)` : "disabled"}`);
  console.log(`Codex resident worker: ${settings.codexWorker.enabled ? "enabled" : "disabled"}`);
  console.log(`Multimodal inbox: ${settings.multimodal.enabled ? `enabled · max ${settings.multimodal.maxFileMb} MB · retention ${settings.multimodal.retentionDays}d` : "disabled"}`);
  console.log("Multiple INPUT accounts are read-only; OUTPUT conversation replies and media are isolated from the searchable INPUT archive.");

  void (async () => {
    let toolBaseUrl: string | undefined;
    if (solPlugin.enabled) {
      const runtime = await startSolToolCallbackServer();
      solToolServer = runtime.server;
      toolBaseUrl = runtime.baseUrl;
      await solPlugin.registerTools(runtime.baseUrl, nexoSolTools);
    }
    solPlugin.reportReady({
      bridgeUrl: `http://${config.host}:${config.port}`,
      toolBaseUrl,
      registeredTools: solPlugin.enabled ? nexoSolTools.length : 0,
      storage: store.storageMode,
      mode: "whatsapp",
      mcp: solPlugin.enabled ? "delegated-to-sol" : "standalone-available",
    });
  })().catch((error) => {
    solPlugin.reportHealth("degraded", { toolRegistrationError: error instanceof Error ? error.message : String(error) });
    console.error("Failed to register Nexo tools in SOL", error);
  });

  void codexWorker.start().catch((error) => console.error("Failed to start Codex worker", error));
});

let stopping = false;
export async function shutdownNexo(signal: string, exitProcess = true): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.log(`\n${signal}: stopping Nexo...`);
  server.close();
  solToolServer?.close();
  await codexWorker.stop().catch((error) => console.error("Failed to stop Codex worker", error));
  await manager.stopAll().catch((error) => console.error("Failed to stop WhatsApp sessions", error));
  await solPlugin.stop().catch((error) => console.error("Failed to stop SOL plugin client", error));
  await Promise.all([
    store.close().catch((error) => console.error("Failed to close storage", error)),
    conversationStore.close().catch((error) => console.error("Failed to close output conversation storage", error)),
  ]);
  if (exitProcess) process.exit(0);
}

process.on("SIGINT", () => void shutdownNexo("SIGINT"));
process.on("SIGTERM", () => void shutdownNexo("SIGTERM"));
