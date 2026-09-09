import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { config } from "./config.js";
import { prepareOutboundMedia } from "./outbound-media.js";

test("prepares an allowed image and infers MIME from extension", async () => {
  const root = await mkdtemp(join(tmpdir(), "nexo-outbound-media-"));
  try {
    const work = join(root, "work");
    await mkdir(work);
    await writeFile(join(work, "foto.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const media = await prepareOutboundMedia({
      kind: "image",
      filePath: "foto.jpg",
      fileName: 'foto:campo?.jpg',
      caption: "  Mirá esto  ",
    }, { allowedRoots: [work], baseDir: work, maxBytes: 1024 });
    assert.equal(media.mimeType, "image/jpeg");
    assert.equal(media.fileName, "foto_campo_.jpg");
    assert.equal(media.caption, "Mirá esto");
    assert.equal(media.sizeBytes, 4);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects files outside allowed roots", async () => {
  const root = await mkdtemp(join(tmpdir(), "nexo-outbound-media-"));
  try {
    const allowed = join(root, "allowed");
    const outside = join(root, "outside");
    await mkdir(allowed);
    await mkdir(outside);
    const file = join(outside, "secret.txt");
    await writeFile(file, "nope");
    await assert.rejects(
      prepareOutboundMedia({ kind: "document", filePath: file }, { allowedRoots: [allowed], maxBytes: 1024 }),
      /media_file_outside_allowed_roots/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects Nexo private data even when the data directory is inside an allowed root", async () => {
  const privateDir = join(config.dataDir, `outbound-private-test-${randomUUID()}`);
  const file = join(privateDir, "credential.txt");
  try {
    await mkdir(privateDir, { recursive: true });
    await writeFile(file, "must-not-leave-nexo");
    await assert.rejects(
      prepareOutboundMedia({ kind: "document", filePath: file }, { allowedRoots: [config.dataDir], maxBytes: 1024 }),
      /media_file_in_private_nexo_data/,
    );
  } finally {
    await rm(privateDir, { recursive: true, force: true });
  }
});

test("rejects files above the configured limit", async () => {
  const root = await mkdtemp(join(tmpdir(), "nexo-outbound-media-"));
  try {
    const file = join(root, "big.pdf");
    await writeFile(file, Buffer.alloc(32));
    await assert.rejects(
      prepareOutboundMedia({ kind: "document", filePath: file }, { allowedRoots: [root], maxBytes: 16 }),
      /media_file_too_large/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("voice note requires OGG/Opus while normal audio may use MP3", async () => {
  const root = await mkdtemp(join(tmpdir(), "nexo-outbound-media-"));
  try {
    const mp3 = join(root, "audio.mp3");
    const ogg = join(root, "audio.ogg");
    await writeFile(mp3, Buffer.from("mp3"));
    await writeFile(ogg, Buffer.from("ogg"));
    const normal = await prepareOutboundMedia({ kind: "audio", filePath: mp3 }, { allowedRoots: [root], maxBytes: 1024 });
    assert.equal(normal.mimeType, "audio/mpeg");
    assert.equal(normal.voiceNote, false);
    await assert.rejects(
      prepareOutboundMedia({ kind: "audio", filePath: mp3, voiceNote: true }, { allowedRoots: [root], maxBytes: 1024 }),
      /voice_note_requires_ogg_opus/,
    );
    const voice = await prepareOutboundMedia({ kind: "audio", filePath: ogg, voiceNote: true }, { allowedRoots: [root], maxBytes: 1024 });
    assert.equal(voice.voiceNote, true);
    assert.match(voice.mimeType, /^audio\/ogg/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
