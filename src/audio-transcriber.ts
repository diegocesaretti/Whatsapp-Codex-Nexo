import { readFile } from "node:fs/promises";
import { transcribeWithLocalWhisper } from "./local-whisper.js";
import type { InboxAttachment } from "./attachment-inbox.js";
import { AttachmentInbox } from "./attachment-inbox.js";
import { transcribeLocalAudioWithCodexOAuth } from "./codex-appserver-audio.js";
import { resolveCodexCli } from "./codex-cli.js";
import { AppSettingsStore } from "./settings.js";

export interface AudioTranscriptionResult {
  text: string;
  model: string;
  provider: string;
}

export interface AudioTranscriptionRuntime {
  cliPath?: string;
  cwd?: string;
  codexModel?: string;
}

function transcriptionEndpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, "")}/audio/transcriptions`;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Existing Nexo installs used a historical Mistral alias that OpenRouter
// does not recognize. Normalize it at request time without rewriting settings.
export function resolvedTranscriptionModel(model: string, baseUrl: string): string {
  const clean = model.trim();
  if (/openrouter\.ai/i.test(baseUrl) && clean === "voxtral-mini-latest") {
    return "mistralai/voxtral-mini-transcribe";
  }
  return clean;
}

export function openRouterAudioFormat(mimeType: string): string {
  const type = mimeType.toLowerCase().split(";")[0]?.trim() || "";
  const formats: Record<string, string> = {
    "audio/ogg": "ogg", "audio/opus": "ogg", "audio/wav": "wav",
    "audio/x-wav": "wav", "audio/mpeg": "mp3", "audio/mp3": "mp3",
    "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/aac": "aac",
    "audio/flac": "flac", "audio/webm": "webm",
  };
  const format = formats[type];
  if (!format) throw new Error(`Unsupported audio MIME for OpenRouter: ${mimeType}`);
  return format;
}

async function transcribeWithConfiguredApi(
  attachment: InboxAttachment,
  inbox: AttachmentInbox,
  settingsStore: AppSettingsStore,
): Promise<AudioTranscriptionResult> {
  const settings = await settingsStore.get();
  const apiKey = await settingsStore.getLlmApiKey();
  if (!apiKey) throw new Error("audio_api_fallback_not_configured");

  const bytes = await readFile(inbox.absolutePath(attachment));
  const model = resolvedTranscriptionModel(settings.multimodal.audioTranscriptionModel, settings.llm.baseUrl);
  const isOpenRouter = /openrouter\.ai/i.test(settings.llm.baseUrl);
  const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}` };
  let requestBody: BodyInit;
  if (isOpenRouter) {
    headers["Content-Type"] = "application/json";
    requestBody = JSON.stringify({
      model,
      input_audio: {
        data: bytes.toString("base64"),
        format: openRouterAudioFormat(attachment.mimeType),
      },
      ...(settings.multimodal.audioLanguage ? { language: settings.multimodal.audioLanguage } : {}),
    });
  } else {
    const form = new FormData();
    form.set("model", model);
    if (settings.multimodal.audioLanguage) form.set("language", settings.multimodal.audioLanguage);
    form.set("file", new Blob([bytes], { type: attachment.mimeType }), attachment.fileName);
    requestBody = form;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), settings.multimodal.audioTranscriptionTimeoutSeconds * 1000);
  timer.unref?.();
  try {
    const response = await fetch(transcriptionEndpoint(settings.llm.baseUrl), {
      method: "POST",
      headers,
      body: requestBody,
      signal: controller.signal,
    });
    const raw = await response.text();
    if (!response.ok) throw new Error(`Transcription HTTP ${response.status}: ${raw.slice(0, 1200)}`);
    let body: { text?: unknown; model?: unknown };
    try { body = JSON.parse(raw) as { text?: unknown; model?: unknown }; }
    catch { throw new Error("Transcription provider returned invalid JSON"); }
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) throw new Error("Transcription provider returned empty text");
    return {
      text,
      model: typeof body.model === "string" && body.model ? body.model : model,
      provider: settings.llm.baseUrl,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function transcribeInboxAudio(
  attachment: InboxAttachment,
  inbox: AttachmentInbox,
  settingsStore: AppSettingsStore,
  runtime: AudioTranscriptionRuntime = {},
): Promise<AudioTranscriptionResult> {
  if (attachment.kind !== "audio") throw new Error("Attachment is not audio");
  const settings = await settingsStore.get();
  if (!settings.multimodal.audioTranscriptionEnabled) throw new Error("Audio transcription is disabled");

  const audioPath = inbox.absolutePath(attachment);
  // Prefer the on-device engine to avoid API credits and keep observed messages private.
  try {
    return await transcribeWithLocalWhisper(audioPath, settings.multimodal.audioTranscriptionTimeoutSeconds * 1000);
  } catch (localError) {
    console.warn(`[audio-transcriber] Local transcription unavailable; checking fallback: ${errorText(localError)}`);
  }
  let codexFailure: unknown;
  try {
    const cliPath = runtime.cliPath?.trim() || (await resolveCodexCli(false)).path;
    if (!cliPath) throw new Error("Codex CLI is unavailable");

    // The OAuth path intentionally does not use runtime.codexModel: ordinary Codex
    // reasoning models are not the speech recognizer. The local app-server refreshes
    // ChatGPT auth and Nexo performs the same one-shot dictation request used by Codex.
    return await transcribeLocalAudioWithCodexOAuth({
      cliPath,
      audioPath,
      cwd: runtime.cwd,
      language: settings.multimodal.audioLanguage,
      timeoutMs: settings.multimodal.audioTranscriptionTimeoutSeconds * 1000,
    });
  } catch (error) {
    codexFailure = error;
    console.warn(`[audio-transcriber] Codex OAuth dictation unavailable; checking configured API fallback: ${errorText(error)}`);
  }

  if (await settingsStore.getLlmApiKey()) {
    try {
      return await transcribeWithConfiguredApi(attachment, inbox, settingsStore);
    } catch (fallbackError) {
      throw new Error(`Codex OAuth dictation failed (${errorText(codexFailure)}); API fallback also failed (${errorText(fallbackError)})`);
    }
  }

  throw new Error(`Codex OAuth dictation failed (${errorText(codexFailure)}). No API-key fallback is configured.`);
}
