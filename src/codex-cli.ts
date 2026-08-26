import { execFile } from "node:child_process";
import { access, readdir, stat } from "node:fs/promises";
import { constants as fsConstants, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const CACHE_MS = 60_000;
const NEGATIVE_CACHE_MS = 5_000;

export type CodexCliSource = "env" | "desktop-app" | "path" | "npm-global" | "winget" | "scoop" | "local-bin" | "unavailable";

export interface CodexCliStatus {
  available: boolean;
  path?: string;
  source: CodexCliSource;
  checkedAt: string;
  error?: string;
  bundleDir?: string;
  codeModeHostPath?: string;
  codeModeHostAvailable?: boolean;
  toolsAvailable?: boolean;
}

export interface CodexDesktopBundle {
  directory: string;
  cliPath: string;
  codeModeHostPath?: string;
  sandboxSetupPath?: string;
  commandRunnerPath?: string;
  complete: boolean;
  modifiedAtMs: number;
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

async function existingFile(candidate: string): Promise<string | undefined> {
  try {
    const info = await stat(candidate);
    if (!info.isFile()) return undefined;
    await access(candidate, fsConstants.F_OK);
    return resolve(candidate);
  } catch {
    return undefined;
  }
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

export function codexDesktopBinRoot(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const localAppData = env.LOCALAPPDATA?.trim();
  return localAppData ? resolve(localAppData, "OpenAI", "Codex", "bin") : undefined;
}

export function codexPluginAppserverRoot(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const userProfile = env.USERPROFILE?.trim();
  return userProfile ? resolve(userProfile, ".codex", "plugins", ".plugin-appserver") : undefined;
}

async function inspectBundleDirectory(directory: string): Promise<CodexDesktopBundle | undefined> {
  const cliPath = await existingFile(join(directory, "codex.exe"));
  if (!cliPath) return undefined;
  const codeModeHostPath = await existingFile(join(directory, "codex-code-mode-host.exe"));
  const sandboxSetupPath = await existingFile(join(directory, "codex-windows-sandbox-setup.exe"));
  const commandRunnerPath = await existingFile(join(directory, "codex-command-runner.exe"));
  const modifiedAtMs = await stat(cliPath).then((info) => info.mtimeMs).catch(() => 0);
  return {
    directory: resolve(directory),
    cliPath,
    codeModeHostPath,
    sandboxSetupPath,
    commandRunnerPath,
    complete: Boolean(codeModeHostPath),
    modifiedAtMs,
  };
}

export async function discoverDesktopCodexBundles(env: NodeJS.ProcessEnv = process.env): Promise<CodexDesktopBundle[]> {
  const bundles: CodexDesktopBundle[] = [];
  const root = codexDesktopBinRoot(env);
  if (root) {
    try {
      const entries = await readdir(root, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const bundle = await inspectBundleDirectory(resolve(root, entry.name));
        if (bundle) bundles.push(bundle);
      }
    } catch {}
  }

  const pluginRoot = codexPluginAppserverRoot(env);
  if (pluginRoot) {
    const pluginBundle = await inspectBundleDirectory(pluginRoot);
    if (pluginBundle) bundles.push(pluginBundle);
  }

  const seen = new Set<string>();
  return bundles
    .filter((bundle) => {
      const key = bundle.directory.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => {
      if (left.complete !== right.complete) return left.complete ? -1 : 1;
      return right.modifiedAtMs - left.modifiedAtMs;
    });
}

function isDesktopCachedCli(cliPath: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const normalizedPath = resolve(cliPath).toLowerCase();
  for (const root of [codexDesktopBinRoot(env), codexPluginAppserverRoot(env)]) {
    if (!root) continue;
    const normalizedRoot = resolve(root).toLowerCase();
    if (normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}\\`) || normalizedPath.startsWith(`${normalizedRoot}/`)) return true;
  }
  return false;
}

async function existingExecutable(candidate: string): Promise<string | undefined> {
  try {
    const info = await stat(candidate);
    if (info.isDirectory()) {
      const names = process.platform === "win32" ? ["codex.exe", "codex.cmd", "codex.bat"] : ["codex"];
      for (const name of names) {
        const nested = await existingFile(join(candidate, name));
        if (nested) return nested;
      }
      return undefined;
    }
    return existingFile(candidate);
  } catch {
    return undefined;
  }
}

async function inspectCli(cliPath: string, source: CodexCliSource, checkedAt: string, env: NodeJS.ProcessEnv = process.env): Promise<CodexCliStatus> {
  const path = resolve(cliPath);
  const bundleDir = dirname(path);
  const codeModeHostPath = process.platform === "win32" || /codex\.exe$/i.test(path)
    ? await existingFile(join(bundleDir, "codex-code-mode-host.exe"))
    : undefined;
  const desktopCached = isDesktopCachedCli(path, env) || source === "desktop-app";
  const codeModeHostAvailable = Boolean(codeModeHostPath);
  const toolsAvailable = desktopCached ? codeModeHostAvailable : true;
  return {
    available: desktopCached ? codeModeHostAvailable : true,
    path,
    source,
    checkedAt,
    bundleDir,
    codeModeHostPath,
    codeModeHostAvailable,
    toolsAvailable,
    ...(desktopCached && !codeModeHostAvailable
      ? { error: `Codex Desktop fue encontrado, pero el bundle está incompleto: falta codex-code-mode-host.exe junto a ${path}` }
      : {}),
  };
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

async function bestDesktopBundle(env: NodeJS.ProcessEnv = process.env): Promise<CodexDesktopBundle | undefined> {
  const bundles = await discoverDesktopCodexBundles(env);
  return bundles.find((bundle) => bundle.complete) ?? bundles[0];
}

export async function resolveCodexCli(force = false): Promise<CodexCliStatus> {
  const now = Date.now();
  if (!force && cache && cache.expiresAt > now) return cache.value;

  const checkedAt = new Date().toISOString();
  const explicit = process.env.NEXO_CODEX_PATH?.trim();
  if (explicit) {
    const found = await existingExecutable(explicit);
    if (found) {
      const inspected = await inspectCli(found, "env", checkedAt);
      if (!isDesktopCachedCli(found) || inspected.toolsAvailable) {
        cache = { expiresAt: now + CACHE_MS, value: inspected };
        return inspected;
      }
      const desktop = await bestDesktopBundle();
      if (desktop?.complete) {
        const value = await inspectCli(desktop.cliPath, "desktop-app", checkedAt);
        cache = { expiresAt: now + CACHE_MS, value };
        return value;
      }
      cache = { expiresAt: now + NEGATIVE_CACHE_MS, value: inspected };
      return inspected;
    }
  }

  if (process.platform === "win32") {
    const desktop = await bestDesktopBundle();
    if (desktop) {
      const value = await inspectCli(desktop.cliPath, "desktop-app", checkedAt);
      cache = { expiresAt: now + (value.toolsAvailable ? CACHE_MS : NEGATIVE_CACHE_MS), value };
      return value;
    }
  }

  const fromPath = await resolveFromPath();
  if (fromPath) {
    const value = await inspectCli(fromPath, "path", checkedAt);
    cache = { expiresAt: now + CACHE_MS, value };
    return value;
  }

  if (process.platform === "win32") {
    for (const candidate of windowsCodexCandidates(process.env).filter((item) => item.source !== "env")) {
      const found = await existingExecutable(candidate.path);
      if (!found) continue;
      const value = await inspectCli(found, candidate.source, checkedAt);
      cache = { expiresAt: now + CACHE_MS, value };
      return value;
    }
  }

  const error = explicit
    ? `NEXO_CODEX_PATH no existe o no apunta a Codex: ${explicit}`
    : process.platform === "win32"
      ? "Codex CLI no fue encontrado en los bundles de la app de Codex, PATH, %APPDATA%\\npm, WinGet, Scoop ni ~/.local/bin"
      : "Codex CLI no fue encontrado en PATH";
  const value: CodexCliStatus = {
    available: false,
    source: "unavailable",
    checkedAt,
    error,
    codeModeHostAvailable: false,
    toolsAvailable: false,
  };
  cache = { expiresAt: now + NEGATIVE_CACHE_MS, value };
  return value;
}

function prependPath(directory: string, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = { ...env };
  const pathKey = Object.keys(result).find((key) => key.toLowerCase() === "path") ?? (process.platform === "win32" ? "Path" : "PATH");
  const separator = process.platform === "win32" ? ";" : ":";
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

export function environmentForCodex(cli: CodexCliStatus, env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  if (!cli.path) return { ...env };
  const result = prependPath(dirname(cli.path), env);
  if (process.platform !== "win32" || /\.exe$/i.test(cli.path)) result.CODEX_CLI_PATH = cli.path;
  if (cli.codeModeHostPath) result.CODEX_CODE_MODE_HOST_PATH = cli.codeModeHostPath;
  return result;
}

export function environmentWithCodexPath(cliPath: string | undefined, env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  if (!cliPath) return { ...env };
  const directory = dirname(cliPath);
  const result = prependPath(directory, env);
  if (process.platform !== "win32" || /\.exe$/i.test(cliPath)) result.CODEX_CLI_PATH = cliPath;
  const siblingHost = join(directory, "codex-code-mode-host.exe");
  if (existsSync(siblingHost)) result.CODEX_CODE_MODE_HOST_PATH = siblingHost;
  return result;
}

export function resetCodexCliCacheForTests(): void {
  cache = undefined;
}
