import { readFile } from "node:fs/promises";
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

async function transcribeWithConfiguredApi(
  attachment: InboxAttachment,
  inbox: AttachmentInbox,
  settingsStore: AppSettingsStore,
): Promise<AudioTranscriptionResult> {
  const settings = await settingsStore.get();
  const apiKey = await settingsStore.getLlmApiKey();
  if (!apiKey) throw new Error("audio_api_fallback_not_configured");

  const bytes = await readFile(inbox.absolutePath(attachment));
  const form = new FormData();
  form.set("model", settings.multimodal.audioTranscriptionModel);
  if (settings.multimodal.audioLanguage) form.set("language", settings.multimodal.audioLanguage);
  form.set("file", new Blob([bytes], { type: attachment.mimeType }), attachment.fileName);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), settings.multimodal.audioTranscriptionTimeoutSeconds * 1000);
  timer.unref?.();
  try {
    const response = await fetch(transcriptionEndpoint(settings.llm.baseUrl), {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
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
      model: typeof body.model === "string" && body.model ? body.model : settings.multimodal.audioTranscriptionModel,
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
  let codexFailure: unknown;
  try {
    const cliPath = runtime.cliPath?.trim() || (await resolveCodexCli(false)).path;
    if (!cliPath) throw new Error("Codex CLI is unavailable");
    return await transcribeLocalAudioWithCodexOAuth({
      cliPath,
      audioPath,
      cwd: runtime.cwd,
      model: runtime.codexModel?.trim() || process.env.NEXO_CODEX_MODEL?.trim(),
      language: settings.multimodal.audioLanguage,
      timeoutMs: settings.multimodal.audioTranscriptionTimeoutSeconds * 1000,
    });
  } catch (error) {
    codexFailure = error;
    console.warn(`[audio-transcriber] Codex OAuth path unavailable; checking configured API fallback: ${errorText(error)}`);
  }

  if (await settingsStore.getLlmApiKey()) {
    try {
      return await transcribeWithConfiguredApi(attachment, inbox, settingsStore);
    } catch (fallbackError) {
      throw new Error(`Codex OAuth transcription failed (${errorText(codexFailure)}); API fallback also failed (${errorText(fallbackError)})`);
    }
  }

  throw new Error(`Codex OAuth transcription failed (${errorText(codexFailure)}). No API-key fallback is configured.`);
}
