import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { OutputConversationStore } from "./output-conversation-store.js";
import type { OutputConversationMessage } from "./types.js";

test("stores, lists and acknowledges authorized output replies locally", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wa-nexo-output-conversation-"));
  try {
    const store = new OutputConversationStore(dir);
    await store.init();
    const inbound: OutputConversationMessage = {
      id: "acc:in-1:inbound",
      accountId: "acc",
      whatsappMessageId: "in-1",
      peerJid: "5493532555555@s.whatsapp.net",
      peerPhone: "5493532555555",
      direction: "inbound",
      text: "¿Cuál era el pendiente de Juan?",
      messageType: "conversation",
      senderName: "Diego",
      authorized: true,
      occurredAt: "2026-08-21T12:00:00.000Z",
    };
    const outbound: OutputConversationMessage = {
      id: "acc:out-1:outbound",
      accountId: "acc",
      whatsappMessageId: "out-1",
      peerJid: "5493532555555@s.whatsapp.net",
      peerPhone: "5493532555555",
      direction: "outbound",
      text: "Era confirmar la visita de mañana.",
      messageType: "conversation",
      authorized: true,
      occurredAt: "2026-08-21T12:00:10.000Z",
      replyToId: inbound.id,
    };

    assert.equal(await store.append(inbound), true);
    assert.equal(await store.append(inbound), false);
    assert.equal(await store.append(outbound), true);

    const pending = await store.list({ pendingOnly: true, direction: "inbound" });
    assert.deepEqual(pending.map((message) => message.id), [inbound.id]);

    const conversation = await store.list({ peer: "+54 9 3532 55-5555", limit: 20 });
    assert.deepEqual(conversation.map((message) => message.direction), ["inbound", "outbound"]);

    assert.equal(await store.acknowledge([inbound.id]), 1);
    assert.equal((await store.list({ pendingOnly: true })).length, 0);
    assert.ok((await store.get(inbound.id))?.acknowledgedAt);
  } finally {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
