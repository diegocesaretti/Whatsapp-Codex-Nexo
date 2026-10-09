import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { transcriptRecord } from "./input-audio-capture.js";
import { NexoBridgeStore } from "./nexo-store.js";
import { AttachmentInbox } from "./attachment-inbox.js";
import type { StoredMessage } from "./types.js";

test("INPUT voice transcripts are searchable, linked to original, and not duplicated on retry", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nexo-input-audio-"));
  const store = new NexoBridgeStore(dir);
  try {
    await store.init();
    const account = await store.createAccount("Luca", "input");
    const audio: StoredMessage = {
      id: `${account.id}:class@g.us:AABBCC`,
      accountId: account.id,
      accountLabel: account.label,
      sourceMessageId: "AABBCC",
      chatJid: "class@g.us",
      chatName: "Matemática",
      senderName: "Profe",
      fromMe: false,
      messageType: "audioMessage",
      occurredAt: "2026-10-09T10:00:00.000Z",
      origin: "realtime",
    };
    assert.equal(await store.appendMessage(audio), true);
    const projected = transcriptRecord(audio, "  El jueves tenemos prueba de fracciones. ");
    assert.equal(projected.id, audio.id + ":transcription");
    assert.equal(projected.sourceMessageId, audio.sourceMessageId + ":transcription");
    assert.equal(projected.messageType, "audioTranscription");
    assert.equal(projected.text, "El jueves tenemos prueba de fracciones.");
    assert.equal(await store.appendMessage(projected), true);
    assert.equal(await store.appendMessage(projected), false);
    const found = await store.searchMessages({ query: "prueba fracciones" });
    assert.equal(found.length, 1);
    assert.equal(found[0]?.id, projected.id);
    assert.equal((await store.getMessage(audio.id))?.messageType, "audioMessage");
  } finally {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("transcription failures schedule a retry and successful indexing is durable", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nexo-input-audio-retry-"));
  try {
    const inbox = new AttachmentInbox(dir);
    await inbox.init();
    const rec = await inbox.save({
      conversationMessageId: "account:class@g.us:ABC",
      peerPhone: "class@g.us",
      descriptor: { kind: "audio", mimeType: "audio/ogg; codecs=opus" },
      bytes: Buffer.from("sample"),
      maxBytes: 1024,
    });
    await inbox.setTranscriptionError(rec.id, "Temporary provider failure");
    const failed = (await inbox.listAll())[0]!;
    assert.equal(failed.transcriptionAttempts, 1);
    assert.ok(Date.parse(failed.transcriptionRetryAt!) > Date.now());
    await inbox.setTranscription(rec.id, "hola", "model");
    await inbox.setSolIndexed(rec.id);
    const recovered = (await inbox.listAll())[0]!;
    assert.equal(recovered.transcription, "hola");
    assert.equal(recovered.solIndexedAt !== undefined, true);
    assert.equal(recovered.transcriptionRetryAt, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
