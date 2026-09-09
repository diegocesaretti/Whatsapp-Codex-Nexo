import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { resolveCodexCli } from "./codex-cli.js";

const execFileAsync = promisify(execFile);
export const SOL_NEXO_MCP_NAME = "sol-nexo-runtime";

export function codexSolMcpAddArgs(proxyUrl: string, nodePath: string, serverPath: string): string[] {
  return [
    "mcp", "add", SOL_NEXO_MCP_NAME,
    "--env", `NEXO_SOL_TOOL_PROXY_URL=${proxyUrl}`,
    "--", nodePath, serverPath,
  ];
}

export async function configureCodexSolMcp(proxyUrl: string): Promise<{ configured: boolean; message: string }> {
  const cli = await resolveCodexCli(true);
  if (!cli.available || !cli.path) {
    return { configured: false, message: cli.error || "Codex CLI unavailable" };
  }

  const serverPath = fileURLToPath(new URL("./codex-sol-mcp.js", import.meta.url));
  try {
    await access(serverPath);
  } catch {
    return { configured: false, message: `SOL MCP bridge is not built at ${serverPath}` };
  }

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
    return { configured: true, message: `Registered ${SOL_NEXO_MCP_NAME} for Codex` };
  } catch (error) {
    return { configured: false, message: `Could not register SOL MCP in Codex: ${error instanceof Error ? error.message : String(error)}` };
  }
}
