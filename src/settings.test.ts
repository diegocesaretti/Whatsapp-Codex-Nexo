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
    assert.equal(value.llm.defaultLookbackDays, 3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("LLM summary lookback is configurable and clamped", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wa-nexo-settings-"));
  try {
    const store = new AppSettingsStore(dir);
    await store.update({ llm: { defaultLookbackDays: 14 } as never });
    assert.equal((await store.get()).llm.defaultLookbackDays, 14);
    await store.update({ llm: { defaultLookbackDays: 999 } as never });
    assert.equal((await store.get()).llm.defaultLookbackDays, 90);
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

test("output conversation allowlist is normalized and partial updates preserve it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wa-nexo-settings-"));
  try {
    const store = new AppSettingsStore(dir);
    await store.update({
      outputConversation: {
        enabled: true,
        authorizedNumbers: ["+54 9 3532 55-5555", "5493532555555"],
        maxContextMessages: 120,
      } as never,
    });
    await store.update({ outputConversation: { maxContextMessages: 60 } as never });
    const value = await store.get();
    assert.equal(value.outputConversation.enabled, true);
    assert.deepEqual(value.outputConversation.authorizedNumbers, ["5493532555555"]);
    assert.equal(value.outputConversation.maxContextMessages, 60);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Codex worker is enabled by default and partial updates preserve its other controls", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wa-nexo-settings-"));
  try {
    const store = new AppSettingsStore(dir);
    const initial = await store.get();
    assert.equal(initial.codexWorker.enabled, true);
    assert.equal(initial.codexWorker.debounceMs, 1800);
    await store.update({ codexWorker: { timeoutSeconds: 420 } as never });
    const value = await store.get();
    assert.equal(value.codexWorker.enabled, true);
    assert.equal(value.codexWorker.timeoutSeconds, 420);
    assert.equal(value.codexWorker.debounceMs, 1800);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("multimodal inbox is enabled by default with bounded local retention", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wa-nexo-settings-"));
  try {
    const store = new AppSettingsStore(dir);
    const initial = await store.get();
    assert.equal(initial.multimodal.enabled, true);
    assert.equal(initial.multimodal.maxFileMb, 25);
    assert.equal(initial.multimodal.retentionDays, 7);
    assert.equal(initial.multimodal.audioTranscriptionEnabled, true);
    assert.equal(initial.multimodal.audioTranscriptionModel, "voxtral-mini-latest");
    await store.update({ multimodal: { maxFileMb: 999, retentionDays: 0 } as never });
    const value = await store.get();
    assert.equal(value.multimodal.maxFileMb, 100);
    assert.equal(value.multimodal.retentionDays, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
