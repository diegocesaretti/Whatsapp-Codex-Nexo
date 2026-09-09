import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  codexSolMcpAddArgs,
  codexSolMcpExecConfigArgs,
  refreshCodexSessionsForToolCatalog,
  SOL_NEXO_MCP_NAME,
  solToolCatalogSignature,
} from "./codex-sol-mcp-setup.js";

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

test("every Codex exec can receive required SOL MCP overrides directly", () => {
  const args = codexSolMcpExecConfigArgs(
    "http://127.0.0.1:45678",
    "C:\\SOL\\node.exe",
    "C:\\SOL\\plugins\\nexo-whatsapp\\dist\\codex-sol-mcp.js",
  );
  assert.ok(args.includes(`mcp_servers.${SOL_NEXO_MCP_NAME}.required=true`));
  assert.ok(args.includes(`mcp_servers.${SOL_NEXO_MCP_NAME}.enabled=true`));
  assert.ok(args.some((value) => value.includes("NEXO_SOL_TOOL_PROXY_URL") && value.includes("45678")));
  assert.ok(args.some((value) => value.includes("codex-sol-mcp.js")));
  assert.equal(args.some((value) => /SOL_PLUGIN_TOKEN|Bearer/i.test(value)), false);
});

test("SOL tool catalog signature is stable across tool and schema key ordering", () => {
  const a = solToolCatalogSignature([
    {
      pluginId: "home-assistant",
      name: "home_assistant_get_state",
      description: "Get state",
      requiredScope: "read",
      inputSchema: { type: "object", properties: { entityId: { type: "string" } }, required: ["entityId"] },
    },
    { pluginId: "z", name: "z_tool", description: "z", requiredScope: "read", inputSchema: { type: "object" } },
  ]);
  const b = solToolCatalogSignature([
    { name: "z_tool", pluginId: "z", requiredScope: "read", description: "z", inputSchema: { type: "object" } },
    {
      requiredScope: "read",
      description: "Get state",
      name: "home_assistant_get_state",
      pluginId: "home-assistant",
      inputSchema: { required: ["entityId"], properties: { entityId: { type: "string" } }, type: "object" },
    },
  ]);
  assert.equal(a, b);
});

test("changed SOL tool catalog clears only persisted Codex thread ids and keeps marker", async () => {
  const root = await mkdtemp(join(tmpdir(), "nexo-catalog-"));
  const sessionsPath = join(root, "codex-worker-sessions.json");
  await writeFile(sessionsPath, JSON.stringify({
    version: 1,
    sessions: {
      "5493532000000": { threadId: "019f-existing-thread-000000", updatedAt: "2026-09-08T00:00:00.000Z" },
    },
  }), "utf8");

  assert.equal(await refreshCodexSessionsForToolCatalog(root, "catalog-a"), true);
  const cleared = JSON.parse(await readFile(sessionsPath, "utf8")) as { sessions: Record<string, unknown> };
  assert.deepEqual(cleared.sessions, {});
  assert.equal(await refreshCodexSessionsForToolCatalog(root, "catalog-a"), false);

  await writeFile(sessionsPath, JSON.stringify({
    version: 1,
    sessions: {
      "5493532000000": { threadId: "019f-new-thread-0000000000", updatedAt: "2026-09-08T00:01:00.000Z" },
    },
  }), "utf8");
  assert.equal(await refreshCodexSessionsForToolCatalog(root, "catalog-b"), true);
  const clearedAgain = JSON.parse(await readFile(sessionsPath, "utf8")) as { sessions: Record<string, unknown> };
  assert.deepEqual(clearedAgain.sessions, {});
});
