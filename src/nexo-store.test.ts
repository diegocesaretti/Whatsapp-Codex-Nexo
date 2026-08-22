import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dedupeChatNameEntries, NexoBridgeStore } from "./nexo-store.js";
import type { StoredMessage } from "./types.js";

test("deduplicates chat/contact metadata by JID before PostgreSQL upsert", () => {
  const result = dedupeChatNameEntries([
    { jid: "5493532555555@s.whatsapp.net", name: "Nombre chat" },
    { jid: "120363000000000000@g.us", name: "Grupo" },
    { jid: "5493532555555@s.whatsapp.net", name: "Nombre contacto" },
    { jid: "", name: "inválido" },
    { jid: "111@s.whatsapp.net", name: "   " },
  ]);

  assert.deepEqual(result, [
    { jid: "5493532555555@s.whatsapp.net", name: "Nombre contacto" },
    { jid: "120363000000000000@g.us", name: "Grupo" },
  ]);
});

function stored(accountId: string, id: string, chatJid: string, text: string): StoredMessage {
  return {
    id: `${accountId}:${chatJid}:${id}`,
    accountId,
    accountLabel: "WhatsApp Diego",
    sourceMessageId: id,
    chatJid,
    senderJid: chatJid,
    fromMe: false,
    text,
    messageType: "conversation",
    occurredAt: new Date(`2026-08-22T11:0${id}:00.000Z`).toISOString(),
    origin: "realtime",
  };
}

test("Codex OUTPUT mirror is never exposed as external INPUT evidence", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wa-nexo-control-"));
  const store = new NexoBridgeStore(dir);
  try {
    await store.init();
    const input = await store.createAccount("WhatsApp Diego", "input");
    const output = await store.createAccount("Codex", "output");
    await store.updateAccount(output.id, { phoneJid: "5493532999999:13@s.whatsapp.net", linkedAt: new Date().toISOString() });

    assert.equal(await store.appendMessage(stored(input.id, "1", "5493532999999@s.whatsapp.net", "esto es el chat con Codex")), false);
    assert.equal(await store.appendMessage(stored(input.id, "2", "5493532111111@s.whatsapp.net", "mensaje de Juan")), true);

    const recent = await store.recentMessages({ limit: 20 });
    assert.deepEqual(recent.map((message) => message.text), ["mensaje de Juan"]);

    const chats = await store.listChats({ limit: 20 });
    assert.equal(chats.some((chat) => chat.chatJid.includes("5493532999999")), false);

    const search = await store.searchMessages({ query: "Codex", limit: 20 });
    assert.equal(search.length, 0);
  } finally {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("searchable archive rejects direct writes for OUTPUT accounts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wa-nexo-output-"));
  const store = new NexoBridgeStore(dir);
  try {
    await store.init();
    const output = await store.createAccount("Codex", "output");
    await assert.rejects(
      () => store.appendMessage(stored(output.id, "1", "5493532111111@s.whatsapp.net", "no debe archivarse")),
      /Only INPUT accounts/,
    );
  } finally {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
