import { AttachmentInbox } from "./attachment-inbox.js";
import { CodexConversationWorker } from "./codex-conversation-worker.js";
import { configureCodexSolMcp } from "./codex-sol-mcp-setup.js";
import { config } from "./config.js";
import { WhatsappSummarizer } from "./llm.js";
import { installMultimodalCapture } from "./multimodal-capture.js";
import { NexoBridgeStore } from "./nexo-store.js";
import { OutputConversationStore } from "./output-conversation-store.js";
import { createBridgeServer } from "./server.js";
import { AppSettingsStore } from "./settings.js";
import { retryTransientStartup } from "./startup-retry.js";
import { SolPluginClient } from "./sol-plugin-client.js";
import { startSolToolProxy } from "./sol-tool-proxy.js";
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
const solToolProxy = await startSolToolProxy(solPlugin).catch((error) => {
  solPlugin.log("warn", `Could not start SOL tool proxy: ${error instanceof Error ? error.message : String(error)}`);
  return undefined;
});
let lastSolIdentitySignature = "";
async function syncNexoPeopleToSol(): Promise<void> {
  if (!solPlugin.enabled) return;
  const current = await settingsStore.get();
  const identities = current.outputConversation.identities;
  const signature = JSON.stringify(identities.map((identity) => ({
    id: identity.id,
    displayName: identity.displayName,
    nickname: identity.nickname,
    role: identity.role,
    phoneNumbers: identity.phoneNumbers,
    linkedInputAccountIds: identity.linkedInputAccountIds,
    codexConversationEnabled: identity.codexConversationEnabled,
    source: identity.source,
  })));
  if (signature === lastSolIdentitySignature) return;
  await solPlugin.syncNexoIdentities(identities);
  lastSolIdentitySignature = signature;
}
await syncNexoPeopleToSol().catch((error) => {
  solPlugin.log("warn", `Could not sync Nexo people to SOL at startup: ${error instanceof Error ? error.message : String(error)}`);
});
const identitySyncTimer = setInterval(() => {
  void syncNexoPeopleToSol().catch((error) => {
    solPlugin.log("warn", `Could not sync changed Nexo people to SOL: ${error instanceof Error ? error.message : String(error)}`);
  });
}, 15_000);
identitySyncTimer.unref?.();

const manager = new WhatsappManager(store, settingsStore, conversationStore, solPlugin);
installMultimodalCapture(manager, settingsStore, attachmentInbox);
if (settings.autoConnectLinkedAccounts) await manager.startLinkedAccounts();

const summarizer = new WhatsappSummarizer(store, settingsStore);
const codexWorker = new CodexConversationWorker(config.dataDir, settingsStore, conversationStore, manager, attachmentInbox);
const server = createBridgeServer(store, manager, settingsStore, summarizer, conversationStore, codexWorker);
server.listen(config.port, config.host, () => {
  console.log(`WhatsApp Codex Nexo listening on http://${config.host}:${config.port}`);
  console.log(`Storage: ${store.storageMode}${store.storageMode === "neon" ? ` (schema whatsapp_nexo · source ${config.databaseSource})` : " (.data local)"}`);
  console.log(`LLM summarizer: ${settings.llm.enabled ? `${settings.llm.baseUrl} · ${settings.llm.model} · ${settings.llm.defaultLookbackDays}d default window` : "disabled"}`);
  console.log(`OUTPUT conversation: ${settings.outputConversation.enabled ? `enabled for ${settings.outputConversation.authorizedNumbers.length} authorized number(s) across ${settings.outputConversation.identities.length} identity record(s)` : "disabled"}`);
  console.log(`Codex resident worker: ${settings.codexWorker.enabled ? "enabled" : "disabled"}`);
  console.log(`Multimodal inbox: ${settings.multimodal.enabled ? `enabled · max ${settings.multimodal.maxFileMb} MB · retention ${settings.multimodal.retentionDays}d` : "disabled"}`);
  console.log("Multiple INPUT accounts are read-only; OUTPUT conversation replies and media are isolated from the searchable INPUT archive.");
  solPlugin.reportReady({
    bridgeUrl: `http://${config.host}:${config.port}`,
    storage: store.storageMode,
    mode: "whatsapp",
    ...(solToolProxy ? { solToolProxy: solToolProxy.url } : {}),
  });
  void (async () => {
    if (solToolProxy && solPlugin.enabled) {
      const registration = await configureCodexSolMcp(solToolProxy.url);
      solPlugin.log(registration.configured ? "info" : "warn", registration.message);
    }
    await codexWorker.start();
  })().catch((error) => console.error("Failed to start Codex worker", error));
});

let stopping = false;
export async function shutdownNexo(signal: string, exitProcess = true): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.log(`\n${signal}: stopping Nexo...`);
  clearInterval(identitySyncTimer);
  server.close();
  await codexWorker.stop().catch((error) => console.error("Failed to stop Codex worker", error));
  await manager.stopAll().catch((error) => console.error("Failed to stop WhatsApp sessions", error));
  if (solToolProxy) await solToolProxy.close().catch((error) => console.error("Failed to stop SOL tool proxy", error));
  await Promise.all([
    store.close().catch((error) => console.error("Failed to close storage", error)),
    conversationStore.close().catch((error) => console.error("Failed to close output conversation storage", error)),
  ]);
  if (exitProcess) process.exit(0);
}

process.on("SIGINT", () => void shutdownNexo("SIGINT"));
process.on("SIGTERM", () => void shutdownNexo("SIGTERM"));
