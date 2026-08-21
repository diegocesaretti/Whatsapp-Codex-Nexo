import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AppSettingsStore } from "./settings.js";

test("partial LLM updates preserve unrelated settings", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wa-nexo-settings-"));
  try {
    const store = new AppSettingsStore(dir);
    await store.update({ autoConnectLinkedAccounts: false, openDashboardOnLaunch: false });
    await store.update({ llm: { enabled: true, model: "local-model" } as never });
    const value = await store.get();
    assert.equal(value.autoConnectLinkedAccounts, false);
    assert.equal(value.openDashboardOnLaunch, false);
    assert.equal(value.llm.enabled, true);
    assert.equal(value.llm.model, "local-model");
    assert.equal(value.llm.baseUrl, "https://api.openai.com/v1");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("LLM API key is stored separately and only exposed as configured state", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wa-nexo-settings-"));
  try {
    const store = new AppSettingsStore(dir);
    await store.setLlmApiKey("secret-key");
    assert.equal(await store.getLlmApiKey(), "secret-key");
    const state = await store.publicState();
    assert.equal(state.llmApiKeyConfigured, true);
    assert.equal(JSON.stringify(state).includes("secret-key"), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
