import assert from "node:assert/strict";
import test from "node:test";
import { detectWhatsappMessageType, extractWhatsappText, normalizeSendTarget, shouldIgnoreJid } from "./message.js";

test("extracts common WhatsApp text and nested ephemeral content", () => {
  assert.equal(extractWhatsappText({ conversation: "hola" }), "hola");
  assert.equal(
    extractWhatsappText({ ephemeralMessage: { message: { extendedTextMessage: { text: "mañana a las 16" } } } }),
    "mañana a las 16",
  );
});

test("detects normalized message type", () => {
  assert.equal(detectWhatsappMessageType({ imageMessage: { caption: "foto" } }), "imageMessage");
});

test("normalizes direct phone destinations and preserves explicit JIDs", () => {
  assert.equal(normalizeSendTarget("+54 9 351 555 1234"), "5493515551234@s.whatsapp.net");
  assert.equal(normalizeSendTarget("120363000000000000@g.us"), "120363000000000000@g.us");
  assert.throws(() => normalizeSendTarget("123"));
});

test("ignores status broadcast and newsletter feeds", () => {
  assert.equal(shouldIgnoreJid("status@broadcast"), true);
  assert.equal(shouldIgnoreJid("123@newsletter"), true);
  assert.equal(shouldIgnoreJid("5493515551234@s.whatsapp.net"), false);
});
