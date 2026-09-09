import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import {
  buildCodexAudioTurnInput,
  codexSupportsLocalAudioPath,
  extractCodexAgentText,
  isCodexChatGptOAuthAccount,
} from "./codex-appserver-audio.js";

test("recognizes the local audio formats supported by Codex app-server", () => {
  for (const path of ["voice.ogg", "voice.MP3", "memo.wav", "memo.m4a", "memo.webm"]) {
    assert.equal(codexSupportsLocalAudioPath(path), true, path);
  }
  assert.equal(codexSupportsLocalAudioPath("voice.aac"), false);
  assert.equal(codexSupportsLocalAudioPath("voice.opus"), false);
});

test("requires a ChatGPT account for the Codex OAuth path", () => {
  assert.equal(isCodexChatGptOAuthAccount({ account: { type: "chatgpt", email: "x@example.com" } }), true);
  assert.equal(isCodexChatGptOAuthAccount({ account: { type: "apiKey" } }), false);
  assert.equal(isCodexChatGptOAuthAccount({ account: null }), false);
});

test("builds a transcription-only turn with localAudio", () => {
  const input = buildCodexAudioTurnInput("./voice.ogg", "es");
  assert.equal(input.length, 2);
  assert.equal(input[0]?.type, "text");
  assert.match(String(input[0]?.text), /do not answer/i);
  assert.match(String(input[0]?.text), /expected language is es/i);
  assert.deepEqual(input[0]?.text_elements, []);
  assert.deepEqual(input[1], { type: "localAudio", path: resolve("./voice.ogg") });
});

test("prefers completed agent text and can fall back to streamed deltas", () => {
  assert.equal(extractCodexAgentText({
    items: [
      { type: "reasoning", text: "ignore" },
      { type: "agentMessage", text: "  Hola, esto es una prueba.  " },
    ],
  }, "partial"), "Hola, esto es una prueba.");
  assert.equal(extractCodexAgentText({ items: [] }, "  fallback transcript  "), "fallback transcript");
});
