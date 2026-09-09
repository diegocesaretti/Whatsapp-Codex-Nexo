import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { resolveCodexCli } from "./codex-cli.js";

const execFileAsync = promisify(execFile);
export const SOL_NEXO_MCP_NAME = "sol-nexo-runtime";
const MCP_RUNTIME_STRATEGY = "direct-per-exec-v1";
const CATALOG_MARKER = ".codex-sol-tool-catalog.sha256";
const SESSION_FILE = "codex-worker-sessions.json";

export function codexSolMcpServerPath(): string {
  return fileURLToPath(new URL("./codex-sol-mcp.js", import.meta.url));
}

export function codexSolMcpAddArgs(proxyUrl: string, nodePath: string, serverPath: string): string[] {
  return [
    "mcp", "add", SOL_NEXO_MCP_NAME,
    "--env", `NEXO_SOL_TOOL_PROXY_URL=${proxyUrl}`,
    "--", nodePath, serverPath,
  ];
}

export function codexSolMcpExecConfigArgs(
  proxyUrl: string,
  nodePath = process.execPath,
  serverPath = codexSolMcpServerPath(),
): string[] {
  const root = `mcp_servers.${SOL_NEXO_MCP_NAME}`;
  return [
    "-c", `${root}.command=${JSON.stringify(nodePath)}`,
    "-c", `${root}.args=${JSON.stringify([serverPath])}`,
    "-c", `${root}.env=${JSON.stringify({ NEXO_SOL_TOOL_PROXY_URL: proxyUrl })}`,
    "-c", `${root}.enabled=true`,
    "-c", `${root}.required=true`,
    "-c", `${root}.startup_timeout_sec=15`,
  ];
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => [key, canonicalize(child)]),
  );
}

export function solToolCatalogSignature(tools: unknown[]): string {
  const normalized = tools
    .filter((tool): tool is Record<string, unknown> => Boolean(tool && typeof tool === "object" && !Array.isArray(tool)))
    .map((tool) => ({
      pluginId: tool.pluginId,
      name: tool.name,
      description: tool.description,
      requiredScope: tool.requiredScope,
      inputSchema: canonicalize(tool.inputSchema),
    }))
    .sort((a, b) => `${String(a.pluginId)}\0${String(a.name)}`.localeCompare(`${String(b.pluginId)}\0${String(b.name)}`));
  return createHash("sha256")
    .update(`${MCP_RUNTIME_STRATEGY}\n${JSON.stringify(normalized)}`)
    .digest("hex");
}

async function atomicWrite(path: string, content: string): Promise<void> {
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, content, "utf8");
  await rename(temp, path);
}

export async function refreshCodexSessionsForToolCatalog(dataDir: string, signature: string): Promise<boolean> {
  const root = resolve(dataDir);
  const markerPath = resolve(root, CATALOG_MARKER);
  const sessionPath = resolve(root, SESSION_FILE);
  const previous = await readFile(markerPath, "utf8").then((value) => value.trim()).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  if (previous === signature) return false;

  await mkdir(root, { recursive: true });
  // Only Codex thread ids are reset. WhatsApp sessions, Nexo conversation history,
  // identities, settings and plugin data remain untouched. The next turn receives
  // recent WhatsApp context again through buildCodexWhatsappPrompt().
  await atomicWrite(sessionPath, `${JSON.stringify({ version: 1, sessions: {} }, null, 2)}\n`);
  await atomicWrite(markerPath, `${signature}\n`);
  return true;
}

async function refreshSessionsFromProxy(proxyUrl: string): Promise<boolean> {
  const response = await fetch(`${proxyUrl.replace(/\/$/, "")}/tools`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`SOL tool catalog proxy returned HTTP ${response.status}`);
  const payload = await response.json() as { tools?: unknown[] };
  const tools = Array.isArray(payload.tools) ? payload.tools : [];
  const signature = solToolCatalogSignature(tools);
  const dataDir = resolve(process.env.SOL_PLUGIN_DATA_DIR?.trim() || process.env.NEXO_WHATSAPP_DATA_DIR?.trim() || ".data");
  return await refreshCodexSessionsForToolCatalog(dataDir, signature);
}

export async function configureCodexSolMcp(proxyUrl: string): Promise<{ configured: boolean; message: string }> {
  // The worker reads this on every turn and injects the MCP directly into `codex exec`.
  // Global registration remains only for diagnostics / interactive Codex compatibility.
  process.env.NEXO_SOL_TOOL_PROXY_URL = proxyUrl;

  const cli = await resolveCodexCli(true);
  if (!cli.available || !cli.path) {
    return { configured: false, message: cli.error || "Codex CLI unavailable" };
  }

  const serverPath = codexSolMcpServerPath();
  try {
    await access(serverPath);
  } catch {
    return { configured: false, message: `SOL MCP bridge is not built at ${serverPath}` };
  }

  const sessionsReset = await refreshSessionsFromProxy(proxyUrl).catch((error) => {
    console.warn(`[codex-mcp] Could not compare SOL tool catalog: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  });

  await execFileAsync(cli.path, ["mcp", "remove", SOL_NEXO_MCP_NAME], {
    windowsHide: true,
    timeout: 10_000,
    encoding: "utf8",
  }).catch(() => undefined);

  try {
    await execFileAsync(cli.path, codexSolMcpAddArgs(proxyUrl, process.execPath, serverPath), {
      windowsHide: true,
      timeout: 15_000,
      encoding: "utf8",
    });
    return {
      configured: true,
      message: sessionsReset
        ? `Registered ${SOL_NEXO_MCP_NAME}; direct per-exec MCP enabled; refreshed persisted Codex threads`
        : `Registered ${SOL_NEXO_MCP_NAME}; direct per-exec MCP enabled; SOL tool catalog unchanged`,
    };
  } catch (error) {
    // Per-exec injection is authoritative and does not depend on this global registration.
    return {
      configured: true,
      message: `Direct per-exec ${SOL_NEXO_MCP_NAME} enabled; global Codex MCP registration failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
