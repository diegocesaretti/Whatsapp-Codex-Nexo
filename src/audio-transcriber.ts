import { readFile } from "node:fs/promises";
import type { InboxAttachment } from "./attachment-inbox.js";
import { AttachmentInbox } from "./attachment-inbox.js";
import { AppSettingsStore } from "./settings.js";

export interface AudioTranscriptionResult {
  text: string;
  model: string;
  provider: string;
}

function transcriptionEndpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, "")}/audio/transcriptions`;
}

export async function transcribeInboxAudio(
  attachment: InboxAttachment,
  inbox: AttachmentInbox,
  settingsStore: AppSettingsStore,
): Promise<AudioTranscriptionResult> {
  if (attachment.kind !== "audio") throw new Error("Attachment is not audio");
  const settings = await settingsStore.get();
  if (!settings.multimodal.audioTranscriptionEnabled) throw new Error("Audio transcription is disabled");
  const apiKey = await settingsStore.getLlmApiKey();
  if (!apiKey) throw new Error("Audio transcription requires the configured LLM/API key");

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
