import assert from "node:assert/strict";
import test from "node:test";
import { codexSolMcpAddArgs, SOL_NEXO_MCP_NAME } from "./codex-sol-mcp-setup.js";

test("Codex SOL MCP registration contains no SOL runtime secret", () => {
  const args = codexSolMcpAddArgs(
    "http://127.0.0.1:45678",
    "C:\\SOL\\node.exe",
    "C:\\SOL\\plugins\\nexo-whatsapp\\dist\\codex-sol-mcp.js",
  );
  assert.deepEqual(args.slice(0, 4), ["mcp", "add", SOL_NEXO_MCP_NAME, "--env"]);
  assert.ok(args.includes("NEXO_SOL_TOOL_PROXY_URL=http://127.0.0.1:45678"));
  assert.equal(args.some((value) => /SOL_PLUGIN_TOKEN|Bearer/i.test(value)), false);
  assert.ok(args.includes("C:\\SOL\\node.exe"));
  assert.ok(args.includes("C:\\SOL\\plugins\\nexo-whatsapp\\dist\\codex-sol-mcp.js"));
});
