import assert from "node:assert/strict";
import test from "node:test";
import {
  isAuthorizedPhone,
  normalizeAuthorizedNumbers,
  normalizePhoneNumber,
  phoneNumberFromJid,
  safePhoneJid,
} from "./output-conversation-auth.js";

test("normalizes configured phone numbers and removes duplicates", () => {
  assert.deepEqual(normalizeAuthorizedNumbers(["+54 9 3532 55-5555", "5493532555555", "bad"]), ["5493532555555"]);
});

test("only phone-number JIDs are accepted as safe conversation peers", () => {
  assert.equal(phoneNumberFromJid("5493532555555@s.whatsapp.net"), "5493532555555");
  assert.equal(phoneNumberFromJid("123456789012345@lid"), undefined);
  assert.equal(safePhoneJid("123456789012345@lid", "5493532555555@s.whatsapp.net"), "5493532555555@s.whatsapp.net");
  assert.equal(normalizePhoneNumber("+54 9 3532 55-5555"), "5493532555555");
  assert.equal(isAuthorizedPhone(["5493532555555"], "5493532555555"), true);
  assert.equal(isAuthorizedPhone(["5493532555555"], "5493511111111"), false);
});
