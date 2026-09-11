import assert from "node:assert/strict";
import test from "node:test";
import { SolPluginClient } from "./sol-plugin-client.js";
import type { NexoIdentity } from "./settings.js";

test("syncNexoIdentities publishes identity assertions without SOL access grants", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return {
      ok: true,
      status: 200,
      json: async () => ({ person: { identityId: "identity-1", entityId: "person-1" } }),
    } as Response;
  }) as typeof fetch;

  try {
    const client = new SolPluginClient({
      SOL_PLUGIN_API_URL: "http://127.0.0.1:9999",
      SOL_PLUGIN_TOKEN: "runtime-token",
    });
    const identity: NexoIdentity = {
      id: "diego-main",
      displayName: "Diego",
      nickname: "Diego",
      role: "owner",
      phoneNumbers: ["5493532000000"],
      linkedInputAccountIds: ["account-1"],
      codexConversationEnabled: true,
      source: "manual",
    };

    await client.syncNexoIdentities([identity]);

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, "http://127.0.0.1:9999/v1/plugin-api/identities/person");
    assert.equal(calls[0]?.init?.method, "POST");
    const body = JSON.parse(String(calls[0]?.init?.body));
    assert.equal(body.externalId, "diego-main");
    assert.equal(body.label, "Diego");
    assert.equal(body.autoLinkMember, false);
    assert.deepEqual(body.metadata.phoneNumbers, ["5493532000000"]);
    assert.equal(body.metadata.codexConversationEnabled, true);
    assert.equal(body.metadata.nexoRole, "owner");
    assert.equal("memberId" in body, false);
    assert.equal("solRole" in body.metadata, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("searchWhatsappHistory uses the SOL plugin member-scoped runtime endpoint", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        results: [{ sourceItemId: "item-1", sender: "Luca", text: "Hola" }],
      }),
    } as Response;
  }) as typeof fetch;

  try {
    const client = new SolPluginClient({
      SOL_PLUGIN_API_URL: "http://127.0.0.1:9999",
      SOL_PLUGIN_TOKEN: "runtime-token",
    });
    const results = await client.searchWhatsappHistory("Luca", 25);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, "http://127.0.0.1:9999/v1/plugin-api/mcp/core/search-whatsapp");
    assert.equal(calls[0]?.init?.method, "POST");
    assert.equal((calls[0]?.init?.headers as Record<string, string>)?.authorization, "Bearer runtime-token");
    assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), { query: "Luca", limit: 25 });
    assert.equal(results[0]?.sender, "Luca");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
