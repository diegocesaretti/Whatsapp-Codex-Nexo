import { execFile } from "node:child_process";
import { access, readdir, stat } from "node:fs/promises";
import { constants as fsConstants, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const CACHE_MS = 60_000;
const NEGATIVE_CACHE_MS = 5_000;
const APPX_QUERY_TIMEOUT_MS = 10_000;

export const REQUIRED_CODEX_WINDOWS_BUNDLE_FILES = [
  "codex.exe",
  "codex-code-mode-host.exe",
  "codex-command-runner.exe",
  "codex-windows-sandbox-setup.exe",
] as const;

export type CodexCliSource = "env" | "path" | "desktop-app" | "npm-global" | "winget" | "scoop" | "local-bin" | "msix-appx" | "unavailable";

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
  sandboxSetupPath?: string;
  sandboxSetupAvailable?: boolean;
  commandRunnerPath?: string;
  commandRunnerAvailable?: boolean;
  missingBundleFiles?: string[];
  installLocation?: string;
  packageVersion?: string;
  packageFullName?: string;
}

export interface CodexDesktopBundle {
  directory: string;
  cliPath: string;
  codeModeHostPath?: string;
  sandboxSetupPath?: string;
  commandRunnerPath?: string;
  complete: boolean;
  missingFiles: string[];
  modifiedAtMs: number;
}

export interface CodexAppxPackage {
  version: string;
  packageFullName: string;
  installLocation: string;
  cliPath?: string;
  codeModeHostPath?: string;
  sandboxSetupPath?: string;
  commandRunnerPath?: string;
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

function samePath(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right) return false;
  const a = resolve(left);
  const b = resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
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
  if (appData) {
    candidates.push({ path: join(appData, "npm", "codex.exe"), source: "npm-global" });
    candidates.push({ path: join(appData, "npm", "codex.cmd"), source: "npm-global" });
  }
  if (localAppData) candidates.push({ path: join(localAppData, "Microsoft", "WinGet", "Links", "codex.exe"), source: "winget" });
  if (userProfile) {
    candidates.push({ path: join(userProfile, "scoop", "shims", "codex.exe"), source: "scoop" });
    candidates.push({ path: join(userProfile, "scoop", "shims", "codex.cmd"), source: "scoop" });
    candidates.push({ path: join(userProfile, ".local", "bin", "codex.exe"), source: "local-bin" });
    candidates.push({ path: join(userProfile, ".local", "bin", "codex.cmd"), source: "local-bin" });
  }

  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const normalized = resolve(candidate.path);
    const key = normalized.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
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

export function codexAppxResourceCandidates(installLocation: string): {
  resourcesDir: string;
  cliPath: string;
  codeModeHostPath: string;
  sandboxSetupPath: string;
  commandRunnerPath: string;
} {
  const resourcesDir = resolve(installLocation, "app", "resources");
  return {
    resourcesDir,
    cliPath: join(resourcesDir, "codex.exe"),
    codeModeHostPath: join(resourcesDir, "codex-code-mode-host.exe"),
    sandboxSetupPath: join(resourcesDir, "codex-windows-sandbox-setup.exe"),
    commandRunnerPath: join(resourcesDir, "codex-command-runner.exe"),
  };
}

export function parseCodexAppxPackageLines(stdout: string): CodexAppxPackage[] {
  const packages: CodexAppxPackage[] = [];
  for (const rawLine of stdout.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line.trim()) continue;
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    const [version = "", packageFullName = "", installLocation = "", cliPath = "", codeModeHostPath = "", sandboxSetupPath = "", commandRunnerPath = ""] = parts;
    if (!installLocation.trim()) continue;
    packages.push({
      version: version.trim(),
      packageFullName: packageFullName.trim(),
      installLocation: installLocation.trim(),
      ...(cliPath.trim() ? { cliPath: cliPath.trim() } : {}),
      ...(codeModeHostPath.trim() ? { codeModeHostPath: codeModeHostPath.trim() } : {}),
      ...(sandboxSetupPath.trim() ? { sandboxSetupPath: sandboxSetupPath.trim() } : {}),
      ...(commandRunnerPath.trim() ? { commandRunnerPath: commandRunnerPath.trim() } : {}),
    });
  }
  return packages;
}

function codexAppxPowerShellScript(): string {
  return [
    "$ErrorActionPreference='SilentlyContinue'",
    "$packages=@(Get-AppxPackage -Name 'OpenAI.Codex' | Sort-Object Version -Descending)",
    "foreach($pkg in $packages){",
    "$root=[string]$pkg.InstallLocation",
    "if([string]::IsNullOrWhiteSpace($root)){continue}",
    "$resources=Join-Path $root 'app\\resources'",
    "$cliCandidate=Join-Path $resources 'codex.exe'",
    "$hostCandidate=Join-Path $resources 'codex-code-mode-host.exe'",
    "$sandboxCandidate=Join-Path $resources 'codex-windows-sandbox-setup.exe'",
    "$runnerCandidate=Join-Path $resources 'codex-command-runner.exe'",
    "$cli=if(Test-Path -LiteralPath $cliCandidate){$cliCandidate}else{''}",
    "$host=if(Test-Path -LiteralPath $hostCandidate){$hostCandidate}else{''}",
    "$sandbox=if(Test-Path -LiteralPath $sandboxCandidate){$sandboxCandidate}else{''}",
    "$runner=if(Test-Path -LiteralPath $runnerCandidate){$runnerCandidate}else{''}",
    "$values=@([string]$pkg.Version,[string]$pkg.PackageFullName,$root,[string]$cli,[string]$host,[string]$sandbox,[string]$runner)",
    "Write-Output ($values -join \"`t\")",
    "}",
  ].join("; ");
}

export async function queryCodexAppxPackages(): Promise<CodexAppxPackage[]> {
  if (process.platform !== "win32") return [];
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", codexAppxPowerShellScript()],
      { windowsHide: true, timeout: APPX_QUERY_TIMEOUT_MS, encoding: "utf8", maxBuffer: 1024 * 1024 },
    );
    return parseCodexAppxPackageLines(stdout);
  } catch {
    return [];
  }
}

async function inspectBundleDirectory(directory: string): Promise<CodexDesktopBundle | undefined> {
  const dir = resolve(directory);
  const cliPath = await existingFile(join(dir, "codex.exe"));
  if (!cliPath) return undefined;

  const codeModeHostPath = await existingFile(join(dir, "codex-code-mode-host.exe"));
  const commandRunnerPath = await existingFile(join(dir, "codex-command-runner.exe"));
  const sandboxSetupPath = await existingFile(join(dir, "codex-windows-sandbox-setup.exe"));
  const missingFiles = [
    !codeModeHostPath ? "codex-code-mode-host.exe" : undefined,
    !commandRunnerPath ? "codex-command-runner.exe" : undefined,
    !sandboxSetupPath ? "codex-windows-sandbox-setup.exe" : undefined,
  ].filter((value): value is string => Boolean(value));
  const modifiedAtMs = await stat(cliPath).then((info) => info.mtimeMs).catch(() => 0);

  return {
    directory: dir,
    cliPath,
    codeModeHostPath,
    commandRunnerPath,
    sandboxSetupPath,
    complete: missingFiles.length === 0,
    missingFiles,
    modifiedAtMs,
  };
}

async function discoverLocalVersionBundles(env: NodeJS.ProcessEnv = process.env): Promise<CodexDesktopBundle[]> {
  const root = codexDesktopBinRoot(env);
  if (!root) return [];
  const bundles: CodexDesktopBundle[] = [];
  try {
    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const bundle = await inspectBundleDirectory(resolve(root, entry.name));
      if (bundle) bundles.push(bundle);
    }
  } catch {}
  return bundles.sort((left, right) => {
    if (left.complete !== right.complete) return left.complete ? -1 : 1;
    return right.modifiedAtMs - left.modifiedAtMs;
  });
}

export async function discoverDesktopCodexBundles(env: NodeJS.ProcessEnv = process.env): Promise<CodexDesktopBundle[]> {
  const bundles = await discoverLocalVersionBundles(env);
  const pluginRoot = codexPluginAppserverRoot(env);
  if (pluginRoot) {
    const pluginBundle = await inspectBundleDirectory(pluginRoot);
    if (pluginBundle) bundles.push(pluginBundle);
  }
  const seen = new Set<string>();
  return bundles.filter((bundle) => {
    const key = bundle.directory.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((left, right) => {
    if (left.complete !== right.complete) return left.complete ? -1 : 1;
    return right.modifiedAtMs - left.modifiedAtMs;
  });
}

function statusFromBundle(bundle: CodexDesktopBundle, source: CodexCliSource, checkedAt: string): CodexCliStatus {
  const codeModeHostAvailable = Boolean(bundle.codeModeHostPath);
  const commandRunnerAvailable = Boolean(bundle.commandRunnerPath);
  const sandboxSetupAvailable = Boolean(bundle.sandboxSetupPath);
  const toolsAvailable = bundle.complete;
  return {
    available: toolsAvailable,
    path: bundle.cliPath,
    source,
    checkedAt,
    bundleDir: bundle.directory,
    codeModeHostPath: bundle.codeModeHostPath,
    codeModeHostAvailable,
    commandRunnerPath: bundle.commandRunnerPath,
    commandRunnerAvailable,
    sandboxSetupPath: bundle.sandboxSetupPath,
    sandboxSetupAvailable,
    toolsAvailable,
    missingBundleFiles: [...bundle.missingFiles],
    ...(!bundle.complete
      ? { error: `Bundle de Codex incompleto en ${bundle.directory}. Faltan: ${bundle.missingFiles.join(", ")}. Nexo continuará buscando otra instalación.` }
      : {}),
  };
}

async function inspectCandidate(candidate: string, source: CodexCliSource, checkedAt: string): Promise<CodexCliStatus | undefined> {
  const absolute = resolve(candidate);
  let directory: string;
  try {
    const info = await stat(absolute);
    directory = info.isDirectory() ? absolute : dirname(absolute);
  } catch {
    return undefined;
  }

  const bundle = await inspectBundleDirectory(directory);
  if (bundle) return statusFromBundle(bundle, source, checkedAt);

  return {
    available: false,
    path: absolute,
    source,
    checkedAt,
    bundleDir: directory,
    codeModeHostAvailable: false,
    commandRunnerAvailable: false,
    sandboxSetupAvailable: false,
    toolsAvailable: false,
    missingBundleFiles: [...REQUIRED_CODEX_WINDOWS_BUNDLE_FILES],
    error: `Se encontró un candidato de Codex en ${absolute}, pero no hay un bundle completo en ${directory}. Nexo continuará buscando otra instalación.`,
  };
}

async function resolveFromPathCandidates(): Promise<string[]> {
  const command = process.platform === "win32" ? "where.exe" : "which";
  try {
    const { stdout } = await execFileAsync(command, ["codex"], { windowsHide: true, timeout: 4000, encoding: "utf8" });
    return unique(stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
  } catch {
    return [];
  }
}

function appxStatus(pkg: CodexAppxPackage, checkedAt: string): CodexCliStatus {
  const cliPath = pkg.cliPath ? resolve(pkg.cliPath) : undefined;
  const codeModeHostPath = pkg.codeModeHostPath ? resolve(pkg.codeModeHostPath) : undefined;
  const commandRunnerPath = pkg.commandRunnerPath ? resolve(pkg.commandRunnerPath) : undefined;
  const sandboxSetupPath = pkg.sandboxSetupPath ? resolve(pkg.sandboxSetupPath) : undefined;
  const directories = [cliPath, codeModeHostPath, commandRunnerPath, sandboxSetupPath].filter((value): value is string => Boolean(value)).map(dirname);
  const sameDirectory = directories.length === 4 && directories.every((directory) => samePath(directory, directories[0]));
  const missingBundleFiles = [
    !cliPath ? "codex.exe" : undefined,
    !codeModeHostPath ? "codex-code-mode-host.exe" : undefined,
    !commandRunnerPath ? "codex-command-runner.exe" : undefined,
    !sandboxSetupPath ? "codex-windows-sandbox-setup.exe" : undefined,
  ].filter((value): value is string => Boolean(value));
  if (!sameDirectory && missingBundleFiles.length === 0) missingBundleFiles.push("bundle helpers in the same directory");
  const toolsAvailable = missingBundleFiles.length === 0 && sameDirectory;
  return {
    available: toolsAvailable,
    path: cliPath,
    source: "msix-appx",
    checkedAt,
    installLocation: resolve(pkg.installLocation),
    packageVersion: pkg.version,
    packageFullName: pkg.packageFullName,
    bundleDir: cliPath ? dirname(cliPath) : resolve(pkg.installLocation),
    codeModeHostPath,
    codeModeHostAvailable: Boolean(codeModeHostPath),
    commandRunnerPath,
    commandRunnerAvailable: Boolean(commandRunnerPath),
    sandboxSetupPath,
    sandboxSetupAvailable: Boolean(sandboxSetupPath),
    toolsAvailable,
    missingBundleFiles,
    ...(!toolsAvailable
      ? { error: `Paquete Microsoft Store/AppX de Codex incompleto para Nexo. Faltan o no comparten directorio: ${missingBundleFiles.join(", ")}.` }
      : {}),
  };
}

function cacheValue(value: CodexCliStatus, now: number): CodexCliStatus {
  cache = { expiresAt: now + (value.toolsAvailable ? CACHE_MS : NEGATIVE_CACHE_MS), value };
  return value;
}

export async function resolveCodexCli(force = false): Promise<CodexCliStatus> {
  const now = Date.now();
  if (!force && cache && cache.expiresAt > now) return cache.value;
  const checkedAt = new Date().toISOString();

  if (process.platform !== "win32") {
    const explicit = process.env.NEXO_CODEX_PATH?.trim();
    if (explicit) {
      const found = await existingFile(explicit);
      if (found) return cacheValue({ available: true, path: found, source: "env", checkedAt, toolsAvailable: true }, now);
    }
    const candidates = await resolveFromPathCandidates();
    if (candidates[0]) return cacheValue({ available: true, path: candidates[0], source: "path", checkedAt, toolsAvailable: true }, now);
    return cacheValue({ available: false, source: "unavailable", checkedAt, error: "Codex CLI no fue encontrado en PATH", toolsAvailable: false }, now);
  }

  let incomplete: CodexCliStatus | undefined;

  // 1. Explicit override.
  const explicit = process.env.NEXO_CODEX_PATH?.trim();
  if (explicit) {
    const status = await inspectCandidate(explicit, "env", checkedAt);
    if (status?.toolsAvailable) return cacheValue(status, now);
    incomplete ??= status;
  }

  // 2. Current PATH. Check every result, not just the first shim.
  for (const candidate of await resolveFromPathCandidates()) {
    const status = await inspectCandidate(candidate, "path", checkedAt);
    if (status?.toolsAvailable) return cacheValue(status, now);
    incomplete ??= status;
  }

  // 3. Official per-user Codex bundle cache: %LOCALAPPDATA%\OpenAI\Codex\bin\<version>.
  for (const bundle of await discoverLocalVersionBundles(process.env)) {
    const status = statusFromBundle(bundle, "desktop-app", checkedAt);
    if (status.toolsAvailable) return cacheValue(status, now);
    incomplete ??= status;
  }

  // 4-7. npm, WinGet, Scoop and ~/.local/bin, in that order.
  for (const candidate of windowsCodexCandidates(process.env).filter((item) => item.source !== "env")) {
    const status = await inspectCandidate(candidate.path, candidate.source, checkedAt);
    if (status?.toolsAvailable) return cacheValue(status, now);
    incomplete ??= status;
  }

  // Compatibility fallback for Microsoft Store/AppX installations.
  for (const pkg of await queryCodexAppxPackages()) {
    const status = appxStatus(pkg, checkedAt);
    if (status.toolsAvailable) return cacheValue(status, now);
    incomplete ??= status;
  }

  if (incomplete) return cacheValue(incomplete, now);

  return cacheValue({
    available: false,
    source: "unavailable",
    checkedAt,
    codeModeHostAvailable: false,
    commandRunnerAvailable: false,
    sandboxSetupAvailable: false,
    toolsAvailable: false,
    missingBundleFiles: [...REQUIRED_CODEX_WINDOWS_BUNDLE_FILES],
    error: "No se encontró un bundle completo de Codex en NEXO_CODEX_PATH, PATH, %LOCALAPPDATA%\\OpenAI\\Codex\\bin, %APPDATA%\\npm, WinGet, Scoop, ~/.local/bin ni Microsoft Store/AppX.",
  }, now);
}

function prependPath(directory: string, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = { ...env };
  const pathKey = Object.keys(result).find((key) => key.toLowerCase() === "path") ?? (process.platform === "win32" ? "Path" : "PATH");
  const separator = process.platform === "win32" ? ";" : ":";
  const current = result[pathKey] ?? "";
  const entries = current.split(separator).filter(Boolean);
  const exists = entries.some((entry) => samePath(entry, directory));
  result[pathKey] = exists ? current : `${directory}${current ? `${separator}${current}` : ""}`;
  return result;
}

export function environmentForCodex(cli: CodexCliStatus, env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  if (!cli.path) return { ...env };
  const directory = cli.bundleDir || dirname(cli.path);
  const result = prependPath(directory, env);
  if (process.platform !== "win32" || /\.exe$/i.test(cli.path)) result.CODEX_CLI_PATH = cli.path;
  if (cli.codeModeHostPath) result.CODEX_CODE_MODE_HOST_PATH = cli.codeModeHostPath;
  return result;
}

export function environmentWithCodexPath(cliPath: string | undefined, env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  if (!cliPath) return { ...env };
  const cached = cache?.value;
  if (cached?.path && samePath(cached.path, cliPath)) return environmentForCodex(cached, env);

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
