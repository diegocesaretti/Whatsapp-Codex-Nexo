import assert from "node:assert/strict";
import test from "node:test";
import { SolPluginClient } from "./sol-plugin-client.js";
import { SOL_CORE_WHATSAPP_HISTORY_TOOL, startSolToolProxy } from "./sol-tool-proxy.js";

test("SOL tool proxy exposes and invokes member-scoped WhatsApp history", async () => {
  const client = new SolPluginClient({
    SOL_PLUGIN_API_URL: "http://127.0.0.1:9999",
    SOL_PLUGIN_TOKEN: "runtime-token",
  });
  let searchArgs: { query: string; limit?: number } | undefined;
  client.listAvailableTools = async () => [{
    pluginId: "home-assistant",
    name: "home_assistant_get_state",
    description: "Get HA state",
    inputSchema: { type: "object" },
    requiredScope: "read",
    visibility: "private",
  }];
  client.searchWhatsappHistory = async (query: string, limit?: number) => {
    searchArgs = { query, limit };
    return [{ sourceItemId: "item-1", sender: "Luca", text: "mensaje de prueba" }];
  };

  const proxy = await startSolToolProxy(client);
  try {
    const toolsResponse = await fetch(`${proxy.url}/tools`);
    assert.equal(toolsResponse.status, 200);
    const toolsBody = await toolsResponse.json() as { tools: Array<{ name: string; pluginId: string }> };
    assert.ok(toolsBody.tools.some((tool) => tool.name === "home_assistant_get_state"));
    const history = toolsBody.tools.find((tool) => tool.name === "search_whatsapp");
    assert.equal(history?.pluginId, "sol-core");

    const invokeResponse = await fetch(`${proxy.url}/invoke`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: SOL_CORE_WHATSAPP_HISTORY_TOOL.name,
        requiredScope: "read",
        arguments: { query: "Luca", limit: 12 },
      }),
    });
    assert.equal(invokeResponse.status, 200);
    assert.deepEqual(searchArgs, { query: "Luca", limit: 12 });
    const invokeBody = await invokeResponse.json() as { result: Array<{ sender?: string }> };
    assert.equal(invokeBody.result[0]?.sender, "Luca");
  } finally {
    await proxy.close();
  }
});

test("SOL tool proxy rejects invalid WhatsApp history arguments before calling SOL", async () => {
  const client = new SolPluginClient({
    SOL_PLUGIN_API_URL: "http://127.0.0.1:9999",
    SOL_PLUGIN_TOKEN: "runtime-token",
  });
  client.listAvailableTools = async () => [];
  let called = false;
  client.searchWhatsappHistory = async () => {
    called = true;
    return [];
  };

  const proxy = await startSolToolProxy(client);
  try {
    const response = await fetch(`${proxy.url}/invoke`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "search_whatsapp", requiredScope: "read", arguments: { query: "x" } }),
    });
    assert.equal(response.status, 500);
    assert.equal(called, false);
  } finally {
    await proxy.close();
  }
});
