import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AppSettingsStore } from "./settings.js";
import type { AccountRecord } from "./types.js";

function inputAccount(overrides: Partial<AccountRecord> = {}): AccountRecord {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    label: "WhatsApp Diego",
    role: "input",
    enabled: true,
    createdAt: new Date().toISOString(),
    linkedAt: new Date().toISOString(),
    phoneJid: "5493532555555:12@s.whatsapp.net",
    displayName: "Diego Cesaretti",
    ...overrides,
  };
}

test("legacy authorized numbers migrate to identity records without losing access", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wa-nexo-identities-"));
  try {
    const store = new AppSettingsStore(dir);
    await store.update({ outputConversation: { authorizedNumbers: ["+54 9 3532 55-5555"] } as never });
    const settings = await store.get();
    assert.deepEqual(settings.outputConversation.authorizedNumbers, ["5493532555555"]);
    assert.equal(settings.outputConversation.identities.length, 1);
    assert.equal(settings.outputConversation.identities[0]?.source, "legacy");
    assert.equal(settings.outputConversation.identities[0]?.codexConversationEnabled, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("linked INPUT creates an enabled identity by default without granting owner role", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wa-nexo-identities-"));
  try {
    const store = new AppSettingsStore(dir);
    const identity = await store.ensureInputIdentity(inputAccount());
    assert.ok(identity);
    assert.equal(identity.displayName, "Diego Cesaretti");
    assert.equal(identity.nickname, "Diego");
    assert.equal(identity.role, "member");
    assert.equal(identity.source, "input");
    assert.equal(identity.codexConversationEnabled, true);
    assert.deepEqual(identity.phoneNumbers, ["5493532555555"]);
    assert.deepEqual(identity.linkedInputAccountIds, ["11111111-1111-1111-1111-111111111111"]);
    assert.deepEqual((await store.get()).outputConversation.authorizedNumbers, ["5493532555555"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("editing identity metadata preserves INPUT association and controls derived allowlist", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wa-nexo-identities-"));
  try {
    const store = new AppSettingsStore(dir);
    const created = await store.ensureInputIdentity(inputAccount());
    assert.ok(created);
    const current = await store.get();
    const identities = current.outputConversation.identities.map((identity) => identity.id === created.id
      ? { ...identity, displayName: "Diego Martín Cesaretti", nickname: "Diego", role: "owner" as const, codexConversationEnabled: false }
      : identity);
    await store.update({ outputConversation: { identities } as never });
    const updated = await store.get();
    const identity = updated.outputConversation.identities.find((item) => item.id === created.id)!;
    assert.equal(identity.displayName, "Diego Martín Cesaretti");
    assert.equal(identity.role, "owner");
    assert.deepEqual(identity.linkedInputAccountIds, created.linkedInputAccountIds);
    assert.deepEqual(updated.outputConversation.authorizedNumbers, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("legacy allowlist updates are translated back into identity permissions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wa-nexo-identities-"));
  try {
    const store = new AppSettingsStore(dir);
    await store.syncInputIdentities([
      inputAccount(),
      inputAccount({
        id: "22222222-2222-2222-2222-222222222222",
        label: "WhatsApp Mariana",
        phoneJid: "5493516555555@s.whatsapp.net",
        displayName: "Mariana Núñez",
      }),
    ]);
    await store.update({ outputConversation: { authorizedNumbers: ["5493516555555"] } as never });
    const updated = await store.get();
    const diego = updated.outputConversation.identities.find((identity) => identity.phoneNumbers.includes("5493532555555"))!;
    const mariana = updated.outputConversation.identities.find((identity) => identity.phoneNumbers.includes("5493516555555"))!;
    assert.equal(diego.codexConversationEnabled, false);
    assert.equal(mariana.codexConversationEnabled, true);
    assert.deepEqual(updated.outputConversation.authorizedNumbers, ["5493516555555"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
