import assert from "node:assert/strict";
import test from "node:test";
import { openRouterAudioFormat, resolvedTranscriptionModel } from "./audio-transcriber.js";

test("upgrades the obsolete OpenRouter Voxtral alias without changing non-OpenRouter providers", () => {
  assert.equal(resolvedTranscriptionModel("voxtral-mini-latest", "https://openrouter.ai/api/v1"), "mistralai/voxtral-mini-transcribe");
  assert.equal(resolvedTranscriptionModel("voxtral-mini-latest", "https://api.other.test/v1"), "voxtral-mini-latest");
  assert.equal(resolvedTranscriptionModel("openai/whisper-1", "https://openrouter.ai/api/v1"), "openai/whisper-1");
});

test("transcription supports common WhatsApp Ogg Opus and other OpenRouter audio formats", () => {
  assert.equal(openRouterAudioFormat("audio/ogg; codecs=opus"), "ogg");
  assert.equal(openRouterAudioFormat("audio/wav"), "wav");
  assert.equal(openRouterAudioFormat("audio/mpeg"), "mp3");
  assert.equal(openRouterAudioFormat("audio/mp4"), "m4a");
  assert.throws(() => openRouterAudioFormat("application/octet-stream"), /Unsupported audio MIME/);
});
