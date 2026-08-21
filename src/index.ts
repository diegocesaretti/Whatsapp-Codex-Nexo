import { config } from "./config.js";
import { createBridgeServer } from "./server.js";
import { BridgeStore } from "./store.js";
import { WhatsappManager } from "./whatsapp-manager.js";

const store = new BridgeStore(config.dataDir);
await store.init();

const manager = new WhatsappManager(store);
await manager.startLinkedAccounts();

const server = createBridgeServer(store, manager);
server.listen(config.port, config.host, () => {
  console.log(`WhatsApp Codex Nexo listening on http://${config.host}:${config.port}`);
  console.log("Multiple INPUT accounts are read-only; exactly one OUTPUT account may send for Codex.");
});

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.log(`\n${signal}: stopping WhatsApp sessions...`);
  server.close();
  await manager.stopAll().catch((error) => console.error("Failed to stop WhatsApp sessions", error));
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
