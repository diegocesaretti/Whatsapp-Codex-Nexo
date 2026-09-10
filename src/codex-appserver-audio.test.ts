import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  accountIdFromAccessToken,
  authTokenFromStatus,
  codexSupportsLocalAudioPath,
  inferCodexTranscriptionMime,
  isCodexChatGptOAuthAccount,
} from "./codex-appserver-audio.js";

test("recognizes the audio containers accepted by Codex dictation", () => {
  for (const path of ["voice.ogg", "voice.OGA", "voice.MP3", "memo.wav", "memo.m4a", "memo.mp4", "memo.webm", "memo.flac"]) {
    assert.equal(codexSupportsLocalAudioPath(path), true, path);
  }
  assert.equal(codexSupportsLocalAudioPath("voice.aac"), false);
  assert.equal(codexSupportsLocalAudioPath("voice.opus"), false);
});

test("maps WhatsApp Ogg Opus and common containers to upload MIME types", () => {
  assert.equal(inferCodexTranscriptionMime("voice.ogg"), "audio/ogg");
  assert.equal(inferCodexTranscriptionMime("voice.webm"), "audio/webm");
  assert.equal(inferCodexTranscriptionMime("voice.mp3"), "audio/mpeg");
  assert.equal(inferCodexTranscriptionMime("voice.m4a"), "audio/mp4");
  assert.equal(inferCodexTranscriptionMime("voice.wav"), "audio/wav");
  assert.equal(inferCodexTranscriptionMime("voice.bin"), "application/octet-stream");
});

test("requires a ChatGPT account for the Codex OAuth path", () => {
  assert.equal(isCodexChatGptOAuthAccount({ account: { type: "chatgpt", email: "x@example.com" } }), true);
  assert.equal(isCodexChatGptOAuthAccount({ account: { type: "apiKey" } }), false);
  assert.equal(isCodexChatGptOAuthAccount({ account: null }), false);
});

test("accepts authToken only from ChatGPT getAuthStatus", () => {
  assert.equal(authTokenFromStatus({ authMethod: "chatgpt", authToken: "Bearer abc.def.sig" }), "abc.def.sig");
  assert.equal(authTokenFromStatus({ authMethod: "apikey", authToken: "secret" }), undefined);
  assert.equal(authTokenFromStatus({ authMethod: "chatgpt", authToken: null }), undefined);
});

test("derives ChatGPT account id from the in-memory access-token claims", () => {
  const payload = Buffer.from(JSON.stringify({
    "https://api.openai.com/auth": { chatgpt_account_id: "acct_test_123" },
  })).toString("base64url");
  const token = `header.${payload}.signature`;
  assert.equal(accountIdFromAccessToken(token), "acct_test_123");
  assert.equal(accountIdFromAccessToken("not-a-jwt"), undefined);
});

test("OAuth transcription uses Codex dictation backend instead of localAudio model input", () => {
  const source = readFileSync(fileURLToPath(new URL("./codex-appserver-audio.ts", import.meta.url)), "utf8");
  assert.match(source, /backend-api\/transcribe/);
  assert.match(source, /getAuthStatus/);
  assert.match(source, /includeToken:\s*true/);
  assert.doesNotMatch(source, /type:\s*["']localAudio["']/);
  assert.doesNotMatch(source, /thread\/start/);
  assert.doesNotMatch(source, /turn\/start/);
});
