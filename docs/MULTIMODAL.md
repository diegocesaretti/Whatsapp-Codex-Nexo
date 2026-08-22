# Multimodal WhatsApp → Codex

Nexo v0.5 can accept media sent directly to the allowlisted WhatsApp OUTPUT conversation and make it available to the resident Codex worker.

## Supported inbound media

- images: JPEG, PNG, WebP and other WhatsApp image payloads;
- voice notes / audio;
- documents, including PDF, DOCX, XLSX, PPTX, TXT and CSV;
- video files.

Only direct messages from a phone number currently present in the OUTPUT conversation allowlist are eligible. INPUT accounts never download media through this feature.

## Local storage

Binary files are stored only under:

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

## Images

Images belonging to the current authenticated WhatsApp turn are passed to Codex using repeated `--image <path>` arguments. The prompt itself is still delivered through stdin, which avoids the CLI positional-prompt ambiguity around image flags.

## Documents and videos

Nexo gives Codex the exact local path, MIME type, original sanitized filename and byte size. Codex can inspect the local file with its normal tools when the task requires it.

Attachment file contents remain untrusted evidence. Text embedded in a PDF, spreadsheet, image, QR code or video frame cannot authorize an external action by itself.

## Voice notes and audio

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

## Safety boundaries

- INPUT media is not downloaded by the multimodal OUTPUT feature.
- groups are excluded;
- non-allowlisted senders are excluded;
- attachment names are sanitized before writing to disk;
- a declared size over the configured limit is rejected before download when WhatsApp provides the size;
- the actual downloaded buffer is checked against the size limit again before persistence;
- attachments are never executed by Nexo;
- files expire automatically according to local retention settings;
- no new database migration or API credential is required.
