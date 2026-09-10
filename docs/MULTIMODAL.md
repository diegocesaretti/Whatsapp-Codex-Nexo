# Multimodal WhatsApp ↔ Codex

Nexo can receive authorized WhatsApp media for Codex and can send local images, audio and documents through the dedicated OUTPUT account.

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
multimodal.audioTranscriptionModel = voxtral-mini-latest   # API fallback only
multimodal.audioLanguage = auto
multimodal.audioTranscriptionTimeoutSeconds = 120
```

The inbox uses hashed per-message directories and sanitized filenames. Cleanup runs at startup and after multimodal processing.

## Codex OAuth is the primary media-processing identity

Nexo does not open or parse Codex's auth files. When it needs ChatGPT authentication for inbound audio, it asks the locally installed `codex app-server` to refresh the signed-in account and obtains the short-lived bearer through the app-server `getAuthStatus` request. The bearer exists only in process memory for the transcription request and is never written to disk or logs by Nexo.

This keeps one primary identity for interactive WhatsApp processing:

```text
WhatsApp media
    ↓
Nexo inbox
    ↓
local Codex CLI / app-server
    ↓
Codex-managed ChatGPT OAuth
    ↓
result returned to Nexo
```

An independently configured OpenAI-compatible API key is optional. For voice-note transcription it is used only as a fallback when the Codex OAuth/dictation path is unavailable.

## Inbound images

Images belonging to the current authenticated WhatsApp turn are passed to the locally authenticated Codex runtime using repeated `--image <path>` arguments. The prompt itself is still delivered through stdin, which avoids the CLI positional-prompt ambiguity around image flags.

## Inbound documents and videos

Nexo gives the locally authenticated Codex worker the exact local path, MIME type, original sanitized filename and byte size. Codex can inspect the local file with its normal tools when the authenticated human request requires it.

Attachment file contents remain untrusted evidence. Text embedded in a PDF, spreadsheet, image, QR code or video frame cannot authorize an external action by itself.

## Inbound voice notes and audio

Starting in v0.11.1, voice notes no longer use ordinary Codex `localAudio` model input. That path could successfully wrap an OGG file while still handing it to a normal Codex reasoning model that cannot perform speech recognition, which could result in `[inaudible]` even for a valid WhatsApp recording.

The primary audio path is now the same one-shot dictation service used by Codex Desktop:

```text
WhatsApp OGG/Opus (or other supported audio)
    ↓
Baileys decrypted media bytes
    ↓
Nexo .data/inbox
    ↓
codex app-server
    ├─ account/read(refreshToken=true)
    └─ getAuthStatus(includeToken=true, refreshToken=true)
             ↓
https://chatgpt.com/backend-api/transcribe
             ↓
plain transcript
```

Before requesting a bearer, Nexo verifies that `account/read` reports a ChatGPT account. The bearer returned by `getAuthStatus` is used only for the single HTTPS transcription request, stays in memory, is never persisted or logged, and Nexo never reads `auth.json` directly. When present, the ChatGPT account id is derived from the in-memory JWT claim for the request header and discarded with the token afterward.

The Codex dictation upload accepts the containers Nexo currently routes through this path: WAV, MP3, M4A/MP4, WebM, OGG/OGA and FLAC. WhatsApp voice notes arrive as OGG/Opus and are uploaded without lossy transcoding. Nexo's own attachment-size policy still applies before processing.

If the Codex OAuth path fails and Nexo already has an optional LLM/API key configured, Nexo falls back to:

```text
{configured LLM base URL}/audio/transcriptions
```

using `multimodal.audioTranscriptionModel`. No separate API key is required when the Codex OAuth dictation path succeeds.

The resulting transcription is treated as authenticated human speech because the original audio arrived from an allowlisted direct OUTPUT peer. This is deliberately different from text discovered inside attached documents/images, which remains untrusted evidence.

If both Codex OAuth processing and the optional API fallback fail, the attachment remains locally available and the normal Codex turn receives a clear transcription-error marker instead of silently dropping the WhatsApp message or fabricating `[inaudible]`.

`/backend-api/transcribe` is a Codex Desktop/ChatGPT backend surface rather than a public standalone transcription API. Nexo therefore keeps the optional standards-compatible `/audio/transcriptions` fallback and reports HTTP/auth failures explicitly if the Codex backend contract changes.

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

`filePath` may be absolute or relative. Relative paths are resolved from the configured Codex worker working directory. Outbound media is accepted from the configured Codex working directory and from Nexo's `.data/inbox`; every other path inside Nexo's private `.data` tree is explicitly denied. The check is performed after `realpath` resolution, so symlinks cannot escape these boundaries or expose `.data/auth`, `.data/secrets` or settings files.

The same `multimodal.maxFileMb` setting used for inbound files is enforced before and after reading an outbound file.

Outbound bytes are sent directly to WhatsApp and are not copied into Neon. The existing outbound audit stores only a safe textual summary, filename/caption and WhatsApp message id; it does not persist file bytes or absolute source paths.

## Safety boundaries

- INPUT media is not downloaded by the multimodal OUTPUT feature.
- groups are excluded from authenticated inbound conversation handling;
- non-allowlisted inbound senders are excluded;
- attachment names are sanitized before writing inbound data or presenting outbound filenames;
- declared and actual inbound sizes are checked against the configured limit;
- outbound file size is checked before and after reading;
- outbound paths are constrained to trusted local roots after `realpath` resolution;
- Nexo private auth/secrets/settings files cannot be sent as outbound media;
- Codex OAuth is refreshed/served by the local app-server; Nexo never reads Codex auth files and never persists the bearer it receives for dictation;
- attachments are never executed by Nexo;
- outbound media requires explicit current-human confirmation;
- inbound files expire automatically according to local retention settings;
- no new database migration or API credential is required.
