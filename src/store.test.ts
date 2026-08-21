import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BridgeStore } from "./store.js";
import type { StoredMessage } from "./types.js";

test("allows multiple inputs but only one output", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wa-codex-nexo-"));
  try {
    const store = new BridgeStore(dir);
    await store.init();
    await store.createAccount("Diego", "input");
    await store.createAccount("Familia", "input");
    const output = await store.createAccount("Codex", "output");
    assert.equal((await store.listAccounts()).length, 3);
    assert.equal((await store.getOutputAccount())?.id, output.id);
    await assert.rejects(() => store.createAccount("Otro output", "output"), /Only one WhatsApp output/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("search spans message text, chat, sender and input account label", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wa-codex-nexo-"));
  try {
    const store = new BridgeStore(dir);
    await store.init();
    const input = await store.createAccount("WhatsApp Diego", "input");
    const message: StoredMessage = {
      id: `${input.id}:chat:1`,
      accountId: input.id,
      accountLabel: input.label,
      sourceMessageId: "1",
      chatJid: "5493511111111@s.whatsapp.net",
      chatName: "Juan Pérez",
      senderJid: "5493511111111@s.whatsapp.net",
      senderName: "Juan",
      fromMe: false,
      text: "Mañana llevo la bomba",
      messageType: "conversation",
      occurredAt: "2026-08-21T12:00:00.000Z",
      origin: "realtime",
    };
    assert.equal(await store.appendMessage(message), true);
    assert.equal(await store.appendMessage(message), false);
    const matches = await store.searchMessages({ query: "Juan bomba" });
    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.sourceMessageId, "1");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("chat discovery prefers PN identifiers over LID for safe send targets", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wa-codex-nexo-"));
  try {
    const store = new BridgeStore(dir);
    await store.init();
    const input = await store.createAccount("WhatsApp Diego", "input");
    const message: StoredMessage = {
      id: `${input.id}:chat:lid-1`,
      accountId: input.id,
      accountLabel: input.label,
      sourceMessageId: "lid-1",
      chatJid: "123456789012345@lid",
      chatAltJid: "5493532555555@s.whatsapp.net",
      chatName: "Mariana",
      senderJid: "123456789012345@lid",
      senderAltJid: "5493532555555@s.whatsapp.net",
      senderName: "Mariana",
      addressingMode: "lid",
      fromMe: false,
      text: "Comprá pan cuando vuelvas",
      messageType: "conversation",
      occurredAt: "2026-08-21T13:00:00.000Z",
      origin: "realtime",
    };
    await store.appendMessage(message);

    const chats = await store.listChats({ query: "Mariana" });
    assert.equal(chats.length, 1);
    assert.equal(chats[0]?.chatJid, "123456789012345@lid");
    assert.equal(chats[0]?.sendTarget, "5493532555555@s.whatsapp.net");
    assert.equal(chats[0]?.kind, "direct");
    assert.equal(chats[0]?.messageCount, 1);
    assert.equal(chats[0]?.lastText, "Comprá pan cuando vuelvas");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
