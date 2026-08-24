import { execFile } from "node:child_process";
import { access, stat } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const CACHE_MS = 60_000;
const NEGATIVE_CACHE_MS = 5_000;

export type CodexCliSource = "env" | "path" | "npm-global" | "winget" | "scoop" | "local-bin" | "unavailable";

export interface CodexCliStatus {
  available: boolean;
  path?: string;
  source: CodexCliSource;
  checkedAt: string;
  error?: string;
}

let cache: { expiresAt: number; value: CodexCliStatus } | undefined;

function unique(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!value) continue;
    const normalized = resolve(value);
    const key = process.platform === "win32" ? normalized.toLowerCase() : normalized;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

export function windowsCodexCandidates(env: NodeJS.ProcessEnv = process.env): Array<{ path: string; source: CodexCliSource }> {
  const appData = env.APPDATA?.trim();
  const localAppData = env.LOCALAPPDATA?.trim();
  const userProfile = env.USERPROFILE?.trim();
  const explicit = env.NEXO_CODEX_PATH?.trim();
  const candidates: Array<{ path: string; source: CodexCliSource }> = [];
  if (explicit) candidates.push({ path: explicit, source: "env" });
  if (appData) candidates.push({ path: join(appData, "npm", "codex.cmd"), source: "npm-global" });
  if (localAppData) candidates.push({ path: join(localAppData, "Microsoft", "WinGet", "Links", "codex.exe"), source: "winget" });
  if (userProfile) {
    candidates.push({ path: join(userProfile, "scoop", "shims", "codex.exe"), source: "scoop" });
    candidates.push({ path: join(userProfile, "scoop", "shims", "codex.cmd"), source: "scoop" });
    candidates.push({ path: join(userProfile, ".local", "bin", "codex.exe"), source: "local-bin" });
  }
  const paths = new Set<string>();
  return candidates.filter((candidate) => {
    const normalized = resolve(candidate.path);
    const key = normalized.toLowerCase();
    if (paths.has(key)) return false;
    paths.add(key);
    candidate.path = normalized;
    return true;
  });
}

async function existingExecutable(candidate: string): Promise<string | undefined> {
  try {
    const info = await stat(candidate);
    if (info.isDirectory()) {
      const names = process.platform === "win32" ? ["codex.exe", "codex.cmd", "codex.bat"] : ["codex"];
      for (const name of names) {
        const nested = join(candidate, name);
        try {
          await access(nested, fsConstants.F_OK);
          if ((await stat(nested)).isFile()) return nested;
        } catch {}
      }
      return undefined;
    }
    if (!info.isFile()) return undefined;
    await access(candidate, fsConstants.F_OK);
    return candidate;
  } catch {
    return undefined;
  }
}

async function resolveFromPath(): Promise<string | undefined> {
  const command = process.platform === "win32" ? "where.exe" : "which";
  try {
    const { stdout } = await execFileAsync(command, ["codex"], { windowsHide: true, timeout: 4000 });
    for (const candidate of unique(stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))) {
      const found = await existingExecutable(candidate);
      if (found) return found;
    }
  } catch {}
  return undefined;
}

export async function resolveCodexCli(force = false): Promise<CodexCliStatus> {
  const now = Date.now();
  if (!force && cache && cache.expiresAt > now) return cache.value;

  const checkedAt = new Date().toISOString();
  const explicit = process.env.NEXO_CODEX_PATH?.trim();
  if (explicit) {
    const found = await existingExecutable(explicit);
    if (found) {
      const value: CodexCliStatus = { available: true, path: found, source: "env", checkedAt };
      cache = { expiresAt: now + CACHE_MS, value };
      return value;
    }
  }

  const fromPath = await resolveFromPath();
  if (fromPath) {
    const value: CodexCliStatus = { available: true, path: fromPath, source: "path", checkedAt };
    cache = { expiresAt: now + CACHE_MS, value };
    return value;
  }

  if (process.platform === "win32") {
    for (const candidate of windowsCodexCandidates(process.env).filter((item) => item.source !== "env")) {
      const found = await existingExecutable(candidate.path);
      if (!found) continue;
      const value: CodexCliStatus = { available: true, path: found, source: candidate.source, checkedAt };
      cache = { expiresAt: now + CACHE_MS, value };
      return value;
    }
  }

  const error = explicit
    ? `NEXO_CODEX_PATH no existe o no apunta a Codex: ${explicit}`
    : process.platform === "win32"
      ? "Codex CLI no fue encontrado en PATH, %APPDATA%\\npm, WinGet, Scoop ni ~/.local/bin"
      : "Codex CLI no fue encontrado en PATH";
  const value: CodexCliStatus = { available: false, source: "unavailable", checkedAt, error };
  cache = { expiresAt: now + NEGATIVE_CACHE_MS, value };
  return value;
}

export function environmentWithCodexPath(cliPath: string | undefined, env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  if (!cliPath) return { ...env };
  const result: NodeJS.ProcessEnv = { ...env };
  const pathKey = Object.keys(result).find((key) => key.toLowerCase() === "path") ?? (process.platform === "win32" ? "Path" : "PATH");
  const separator = process.platform === "win32" ? ";" : ":";
  const directory = dirname(cliPath);
  const current = result[pathKey] ?? "";
  const entries = current.split(separator).filter(Boolean);
  const exists = entries.some((entry) => {
    const left = resolve(entry);
    const right = resolve(directory);
    return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
  });
  result[pathKey] = exists ? current : `${directory}${current ? `${separator}${current}` : ""}`;
  return result;
}

export function resetCodexCliCacheForTests(): void {
  cache = undefined;
}
