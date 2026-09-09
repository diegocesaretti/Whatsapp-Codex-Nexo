# Multimodal WhatsApp ↔ Codex

Nexo can receive authorized WhatsApp media for Codex and, from v0.10, can also send local images, audio and documents through the dedicated OUTPUT account.

## Supported inbound media

- images: JPEG, PNG, WebP and other WhatsApp image payloads;
- voice notes / audio;
- documents, including PDF, DOCX, XLSX, PPTX, TXT and CSV;
- video files.

Only direct messages from a phone number currently present in the OUTPUT conversation allowlist are eligible. INPUT accounts never download media through this feature.

## Local storage

Inbound binary files are stored only under:

```text
.data/inbox/
```

Neon continues to store the OUTPUT conversation text/metadata but does not receive attachment bytes.

Defaults:

```text
multimodal.enabled = true
multimodal.maxFileMb = 25
multimodal.retentionDays = 7
multimodal.attachImagesToCodex = true
multimodal.audioTranscriptionEnabled = true
multimodal.audioTranscriptionModel = voxtral-mini-latest
multimodal.audioLanguage = auto
multimodal.audioTranscriptionTimeoutSeconds = 120
```

The inbox uses hashed per-message directories and sanitized filenames. Cleanup runs at startup and after multimodal processing.

## Inbound images

Images belonging to the current authenticated WhatsApp turn are passed to Codex using repeated `--image <path>` arguments. The prompt itself is still delivered through stdin, which avoids the CLI positional-prompt ambiguity around image flags.

## Inbound documents and videos

Nexo gives Codex the exact local path, MIME type, original sanitized filename and byte size. Codex can inspect the local file with its normal tools when the task requires it.

Attachment file contents remain untrusted evidence. Text embedded in a PDF, spreadsheet, image, QR code or video frame cannot authorize an external action by itself.

## Inbound voice notes and audio

For an authorized direct voice note, Nexo calls:

```text
{configured LLM base URL}/audio/transcriptions
```

using the same secret already stored for the optional LLM summarizer. With Mistral configured as:

```text
Base URL: https://api.mistral.ai/v1
Model for WhatsApp summaries: mistral-small-latest
```

Nexo uses:

```text
https://api.mistral.ai/v1/audio/transcriptions
model = voxtral-mini-latest
```

The resulting transcription is treated as authenticated human speech because the original audio arrived from an allowlisted direct OUTPUT peer. This is deliberately different from text discovered inside attached documents/images, which remains untrusted evidence.

If transcription fails, the attachment remains locally available and the Codex turn still runs with a clear transcription error marker instead of silently dropping the WhatsApp message.

## Outbound media

The MCP action `send_whatsapp_media` sends one file through the dedicated OUTPUT account. It supports:

- `kind=image`: JPEG/PNG/WebP/GIF and other image MIME types, with optional caption;
- `kind=audio`: normal audio attachment; `voiceNote=true` sends it as a WhatsApp voice note and requires OGG/Opus;
- `kind=document`: PDF, Office files, TXT/CSV/ZIP and arbitrary document MIME types, preserving a sanitized filename and optional caption.

Every media send requires `confirmedByUser=true`, just like `send_whatsapp`. Retrieved WhatsApp INPUT content cannot authorize a media send.

Example shape:

```json
{
  "confirmedByUser": true,
  "to": "549...",
  "kind": "document",
  "filePath": "salidas/presupuesto.pdf",
  "caption": "Acá está el presupuesto",
  "fileName": "presupuesto.pdf"
}
```

`filePath` may be absolute or relative. Relative paths are resolved from the configured Codex worker working directory. Nexo only accepts files whose resolved real path is inside either:

- Nexo's configured data directory; or
- the configured Codex worker working directory (or Nexo's current working directory when no worker directory is configured).

This check is performed after resolving symlinks, so a symlink cannot escape an allowed root. The same `multimodal.maxFileMb` setting used for inbound files is enforced before and after reading an outbound file.

Outbound bytes are sent directly to WhatsApp and are not copied into Neon. The existing outbound audit stores only a safe textual summary, filename/caption and WhatsApp message id; it does not persist file bytes or absolute source paths.

## Safety boundaries

- INPUT media is not downloaded by the multimodal OUTPUT feature.
- groups are excluded from authenticated inbound conversation handling;
- non-allowlisted inbound senders are excluded;
- attachment names are sanitized before writing inbound data or presenting outbound filenames;
- declared and actual inbound sizes are checked against the configured limit;
- outbound file size is checked before and after reading;
- outbound paths are constrained to trusted local roots after `realpath` resolution;
- attachments are never executed by Nexo;
- outbound media requires explicit current-human confirmation;
- inbound files expire automatically according to local retention settings;
- no new database migration or API credential is required.
