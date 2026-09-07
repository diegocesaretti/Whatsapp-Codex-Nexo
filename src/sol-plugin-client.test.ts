import assert from "node:assert/strict";
import test from "node:test";
import { canonicalWhatsappAccountId } from "./sol-plugin-client.js";

test("canonicalizes device-qualified WhatsApp JIDs for SOL source identity", () => {
  assert.equal(
    canonicalWhatsappAccountId({ id: "local-account", phoneJid: "5493532999999:13@s.whatsapp.net" }),
    "5493532999999@s.whatsapp.net",
  );
});

test("keeps already canonical WhatsApp JIDs", () => {
  assert.equal(
    canonicalWhatsappAccountId({ id: "local-account", phoneJid: "5493532999999@s.whatsapp.net" }),
    "5493532999999@s.whatsapp.net",
  );
});

test("falls back to local account id before pairing", () => {
  assert.equal(canonicalWhatsappAccountId({ id: "local-account" }), "local-account");
});
