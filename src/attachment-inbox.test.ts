import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AttachmentInbox, describeWhatsappMedia, sanitizeAttachmentFileName } from "./attachment-inbox.js";

test("describes common WhatsApp media messages", () => {
  assert.deepEqual(describeWhatsappMedia({ imageMessage: { mimetype: "image/jpeg", fileLength: 123 } }), {
    kind: "image",
    mimeType: "image/jpeg",
    fileName: undefined,
    declaredBytes: 123,
  });
  assert.deepEqual(describeWhatsappMedia({ documentMessage: { mimetype: "application/pdf", fileName: "factura.pdf", fileLength: 456 } }), {
    kind: "document",
    mimeType: "application/pdf",
    fileName: "factura.pdf",
    declaredBytes: 456,
  });
  assert.equal(describeWhatsappMedia({ conversation: "hola" }), undefined);
});

test("sanitizes Windows-hostile attachment names", () => {
  assert.equal(sanitizeAttachmentFileName('presu:puesto?.pdf', "application/pdf", "document"), "presu_puesto_.pdf");
  assert.equal(sanitizeAttachmentFileName(undefined, "audio/ogg; codecs=opus", "audio"), "audio.ogg");
});

test("stores attachment bytes locally and indexes by conversation message", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wa-nexo-inbox-"));
  try {
    const inbox = new AttachmentInbox(dir);
    await inbox.init();
    const record = await inbox.save({
      conversationMessageId: "account:message:inbound",
      peerPhone: "5493532000000",
      descriptor: { kind: "document", mimeType: "text/plain", fileName: "nota.txt" },
      bytes: Buffer.from("contenido"),
      maxBytes: 1024,
    });
    assert.equal((await inbox.listForMessages(["account:message:inbound"]))[0]?.id, record.id);
    assert.equal(await readFile(inbox.absolutePath(record), "utf8"), "contenido");
    const stats = await inbox.stats();
    assert.equal(stats.files, 1);
    assert.equal(stats.bytes, Buffer.byteLength("contenido"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
