import { config as loadDotenv, parse as parseDotenv } from "dotenv";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

loadDotenv();

function integerEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

export type DatabaseUrlSource = "nexo-env" | "database-env" | "sol-env" | "none";

interface DatabaseDiscovery {
  url?: string;
  source: DatabaseUrlSource;
  sourcePath?: string;
}

export function normalizeDatabaseSslMode(value: string | undefined): string | undefined {
  if (!value) return value;
  return value.replace(/([?&]sslmode=)(prefer|require|verify-ca)(?=(&|$))/gi, "$1verify-full");
}

function envFileCandidate(path: string): string {
  try {
    if (existsSync(path) && statSync(path).isDirectory()) return join(path, ".env");
  } catch {}
  return path;
}

export function discoverDatabaseUrl(cwd = process.cwd(), env: NodeJS.ProcessEnv = process.env): DatabaseDiscovery {
  const nexo = env.NEXO_DATABASE_URL?.trim();
  if (nexo) return { url: normalizeDatabaseSslMode(nexo), source: "nexo-env" };

  const generic = env.DATABASE_URL?.trim();
  if (generic) return { url: normalizeDatabaseSslMode(generic), source: "database-env" };

  const candidates: string[] = [];
  if (env.NEXO_SOL_ENV_PATH?.trim()) candidates.push(envFileCandidate(resolve(env.NEXO_SOL_ENV_PATH.trim())));
  if (env.SOL_ROOT?.trim()) candidates.push(resolve(env.SOL_ROOT.trim(), ".env"));
  candidates.push(resolve(cwd, "..", "SOL", ".env"));
  candidates.push(resolve(cwd, "..", "sol", ".env"));

  const seen = new Set<string>();
  for (const path of candidates) {
    if (seen.has(path)) continue;
    seen.add(path);
    try {
      if (!existsSync(path)) continue;
      const values = parseDotenv(readFileSync(path));
      const url = values.NEXO_DATABASE_URL?.trim() || values.DATABASE_URL?.trim();
      if (url) return { url: normalizeDatabaseSslMode(url), source: "sol-env", sourcePath: path };
    } catch (error) {
      console.warn(`[config] Could not inspect SOL environment at ${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { source: "none" };
}

const database = discoverDatabaseUrl();

export const config = {
  host: process.env.NEXO_WHATSAPP_HOST?.trim() || "127.0.0.1",
  port: integerEnv("NEXO_WHATSAPP_PORT", 3210),
  dataDir: resolve(process.env.NEXO_WHATSAPP_DATA_DIR?.trim() || ".data"),
  databaseUrl: database.url,
  databaseSource: database.source,
  databaseSourcePath: database.sourcePath,
  maxSearchResults: Math.max(10, Math.min(200, integerEnv("NEXO_WHATSAPP_MAX_SEARCH_RESULTS", 80))),
};

export function bridgeBaseUrl(): string {
  return process.env.NEXO_WHATSAPP_BRIDGE_URL?.trim() || `http://${config.host}:${config.port}`;
}
