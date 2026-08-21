import { config } from "./config.js";
import { WhatsappSummarizer } from "./llm.js";
import { createBridgeServer } from "./server.js";
import { AppSettingsStore } from "./settings.js";
import { BridgeStore } from "./store.js";
import { WhatsappManager } from "./whatsapp-manager.js";

const settingsStore = new AppSettingsStore(config.dataDir);
const settings = await settingsStore.get();
const store = new BridgeStore(config.dataDir, config.databaseUrl);
await store.init();

const manager = new WhatsappManager(store);
if (settings.autoConnectLinkedAccounts) await manager.startLinkedAccounts();

const summarizer = new WhatsappSummarizer(store, settingsStore);
const server = createBridgeServer(store, manager, settingsStore, summarizer);
server.listen(config.port, config.host, () => {
  console.log(`WhatsApp Codex Nexo listening on http://${config.host}:${config.port}`);
  console.log(`Storage: ${store.storageMode}${store.storageMode === "neon" ? " (schema whatsapp_nexo)" : " (.data local)"}`);
  console.log(`LLM summarizer: ${settings.llm.enabled ? `${settings.llm.baseUrl} · ${settings.llm.model}` : "disabled"}`);
  console.log("Multiple INPUT accounts are read-only; exactly one OUTPUT account may send for Codex.");
});

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.log(`\n${signal}: stopping WhatsApp sessions...`);
  server.close();
  await manager.stopAll().catch((error) => console.error("Failed to stop WhatsApp sessions", error));
  await store.close().catch((error) => console.error("Failed to close storage", error));
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
