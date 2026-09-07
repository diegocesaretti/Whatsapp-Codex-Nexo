import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalWhatsappAccountId,
  isRecoverableSolFailureMessage,
  isRetryableSolHttpStatus,
} from "./sol-plugin-client.js";

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

test("treats temporary SOL HTTP statuses as retryable", () => {
  for (const status of [401, 403, 404, 405, 408, 425, 429, 500, 503]) {
    assert.equal(isRetryableSolHttpStatus(status), true, String(status));
  }
  for (const status of [400, 409, 422]) {
    assert.equal(isRetryableSolHttpStatus(status), false, String(status));
  }
});

test("recognizes compatibility failures that should be recovered after an upgrade", () => {
  for (const message of [
    "SOL Plugin API: input_account_owned_by_other_runtime",
    "SOL Plugin API: plugin_input_not_found",
    "SOL Plugin API: plugin_input_temporarily_unavailable",
    "SOL Plugin API: deadlock detected",
    "serialization failure",
  ]) {
    assert.equal(isRecoverableSolFailureMessage(message), true, message);
  }
  assert.equal(isRecoverableSolFailureMessage("SOL Plugin API: kind_invalid"), false);
});
