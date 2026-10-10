import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeWhatsappContact, WhatsappContactsStore } from "./contacts.js";

test("normalizes phone and opaque LID contacts without converting groups into people", () => {
  assert.deepEqual(normalizeWhatsappContact({ id: "5493532111111@s.whatsapp.net", name: " Juan ", notify: "Juan P." }), {
    jid: "5493532111111@s.whatsapp.net",
    phone: "5493532111111",
    savedName: "Juan",
    pushName: "Juan P.",
  });
  assert.deepEqual(normalizeWhatsappContact({ id: "1234567890123@lid", name: "LID person" }), {
    jid: "1234567890123@lid",
    savedName: "LID person",
  });
  assert.equal(normalizeWhatsappContact({ id: "1203630@g.us", name: "Grupo" }), undefined);
  assert.equal(normalizeWhatsappContact({ id: "status@broadcast", name: "Status" }), undefined);
  assert.equal(normalizeWhatsappContact({ id: "xxx@s.whatsapp.net", name: "Not a number" }), undefined);
});

test("ingests history and live updates, preserving phonebook names and account boundaries", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nexo-contacts-"));
  const first = "11111111-1111-1111-1111-111111111111";
  const second = "22222222-2222-2222-2222-222222222222";
  try {
    const contacts = new WhatsappContactsStore(dir);
    const jid = "5493532111111@s.whatsapp.net";
    assert.deepEqual(await contacts.ingest(first, [
      { id: jid, name: "Juan guardado", notify: "Juan" },
      { id: jid, notify: "Juan nuevo" },
      { id: "120363000000000000@g.us", name: "Grupo familiar" },
    ], "history"), { observed: 1, added: 1, updated: 0 });
    await contacts.ingest(first, [{ id: jid, notify: "Nuevo apodo de WA" }], "realtime");
    await contacts.ingest(second, [{ id: jid, name: "Juan del segundo telefono" }], "realtime");
    const onlyFirst = await contacts.list({ accountIds: [first], query: "Juan", limit: 50 });
    assert.equal(onlyFirst.total, 1);
    assert.equal(onlyFirst.contacts[0]?.displayName, "Juan guardado");
    assert.equal(onlyFirst.contacts[0]?.pushName, "Nuevo apodo de WA");
    assert.equal((await contacts.list({ accountIds: [] })).total, 0);
    assert.equal((await contacts.list()).total, 2);
    assert.deepEqual(await contacts.stats([]), { total: 0, byAccount: {} });
    assert.equal((await contacts.stats([first])).total, 1);
    const restored = new WhatsappContactsStore(dir);
    assert.equal((await restored.list()).total, 2);
    await restored.deleteAccount(first);
    assert.equal((await restored.list()).total, 1);
    assert.equal((await restored.list({ accountIds: [first] })).total, 0);
    const raw = await readFile(join(dir, "contacts.json"), "utf8");
    assert.ok(!raw.includes("Juan guardado"), "unlinked account contacts must be erased");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("contact events coalesce safely under concurrent writes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nexo-contacts-concurrency-"));
  try {
    const contacts = new WhatsappContactsStore(dir);
    await Promise.all(Array.from({ length: 20 }, (_, n) => contacts.ingest("acct", [
      { id: `5493532000${String(n).padStart(4, "0")}@s.whatsapp.net`, name: `Contact ${n}` },
    ], "realtime")));
    assert.equal((await contacts.list({ accountIds: ["acct"] })).total, 20);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
