import "dotenv/config";
import { resolve } from "node:path";

function integerEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

export const config = {
  host: process.env.NEXO_WHATSAPP_HOST?.trim() || "127.0.0.1",
  port: integerEnv("NEXO_WHATSAPP_PORT", 3210),
  dataDir: resolve(process.env.NEXO_WHATSAPP_DATA_DIR?.trim() || ".data"),
  databaseUrl: process.env.NEXO_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim() || undefined,
  maxSearchResults: Math.max(10, Math.min(200, integerEnv("NEXO_WHATSAPP_MAX_SEARCH_RESULTS", 80))),
};

export function bridgeBaseUrl(): string {
  return process.env.NEXO_WHATSAPP_BRIDGE_URL?.trim() || `http://${config.host}:${config.port}`;
}
