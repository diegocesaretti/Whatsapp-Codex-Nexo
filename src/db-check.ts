import { config } from "./config.js";
import { BridgeStore } from "./store.js";

if (!config.databaseUrl) {
  console.error("Neon is not configured. Set NEXO_DATABASE_URL/DATABASE_URL, SOL_ROOT/NEXO_SOL_ENV_PATH, or keep SOL as a sibling repo with its .env file.");
  process.exit(2);
}

const store = new BridgeStore(config.dataDir, config.databaseUrl);
try {
  await store.init();
  console.log("Neon connection OK");
  console.log("Schema: whatsapp_nexo");
  console.log(`Source: ${config.databaseSource}${config.databaseSource === "sol-env" ? " (SOL .env)" : ""}`);
} finally {
  await store.close();
}
