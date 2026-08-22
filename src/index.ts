import { CodexConversationWorker } from "./codex-conversation-worker.js";
import { config } from "./config.js";
import { WhatsappSummarizer } from "./llm.js";
import { NexoBridgeStore } from "./nexo-store.js";
import { OutputConversationStore } from "./output-conversation-store.js";
import { createBridgeServer } from "./server.js";
import { AppSettingsStore } from "./settings.js";
import { WhatsappManager } from "./whatsapp-manager.js";

const settingsStore = new AppSettingsStore(config.dataDir);
const settings = await settingsStore.get();
const store = new NexoBridgeStore(config.dataDir, config.databaseUrl);
const conversationStore = new OutputConversationStore(config.dataDir, config.databaseUrl);
await store.init();
await conversationStore.init();

const manager = new WhatsappManager(store, settingsStore, conversationStore);
if (settings.autoConnectLinkedAccounts) await manager.startLinkedAccounts();

const summarizer = new WhatsappSummarizer(store, settingsStore);
const codexWorker = new CodexConversationWorker(config.dataDir, settingsStore, conversationStore, manager);
const server = createBridgeServer(store, manager, settingsStore, summarizer, conversationStore, codexWorker);
server.listen(config.port, config.host, () => {
  console.log(`WhatsApp Codex Nexo listening on http://${config.host}:${config.port}`);
  console.log(`Storage: ${store.storageMode}${store.storageMode === "neon" ? ` (schema whatsapp_nexo · source ${config.databaseSource})` : " (.data local)"}`);
  console.log(`LLM summarizer: ${settings.llm.enabled ? `${settings.llm.baseUrl} · ${settings.llm.model} · ${settings.llm.defaultLookbackDays}d default window` : "disabled"}`);
  console.log(`OUTPUT conversation: ${settings.outputConversation.enabled ? `enabled for ${settings.outputConversation.authorizedNumbers.length} authorized number(s)` : "disabled"}`);
  console.log(`Codex resident worker: ${settings.codexWorker.enabled ? "enabled" : "disabled"}`);
  console.log("Multiple INPUT accounts are read-only; OUTPUT conversation replies are isolated from the searchable INPUT archive.");
  void codexWorker.start().catch((error) => console.error("Failed to start Codex worker", error));
});

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.log(`\n${signal}: stopping Nexo...`);
  server.close();
  await codexWorker.stop().catch((error) => console.error("Failed to stop Codex worker", error));
  await manager.stopAll().catch((error) => console.error("Failed to stop WhatsApp sessions", error));
  await Promise.all([
    store.close().catch((error) => console.error("Failed to close storage", error)),
    conversationStore.close().catch((error) => console.error("Failed to close output conversation storage", error)),
  ]);
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
