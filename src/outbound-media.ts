import { readFile, realpath, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, relative, resolve } from "node:path";
import { sanitizeAttachmentFileName, type WhatsappAttachmentKind } from "./attachment-inbox.js";

export type OutboundMediaKind = Extract<WhatsappAttachmentKind, "image" | "audio" | "document">;

export interface OutboundMediaInput {
  kind: OutboundMediaKind;
  filePath: string;
  caption?: string;
  fileName?: string;
  mimeType?: string;
  voiceNote?: boolean;
}

export interface PreparedOutboundMedia {
  kind: OutboundMediaKind;
  absolutePath: string;
  bytes: Buffer;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  caption?: string;
  voiceNote: boolean;
}

const MIME_BY_EXTENSION: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ogg": "audio/ogg; codecs=opus",
  ".opus": "audio/ogg; codecs=opus",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".wav": "audio/wav",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".zip": "application/zip",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

function normalizeMime(value: string | undefined, path: string, kind: OutboundMediaKind): string {
  const supplied = value?.trim().toLowerCase();
  if (supplied && /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+;-]+(?:\s*;\s*[a-z0-9=_.+-]+)*$/i.test(supplied)) return supplied;
  const inferred = MIME_BY_EXTENSION[extname(path).toLowerCase()];
  if (inferred) return inferred;
  if (kind === "image") return "image/jpeg";
  if (kind === "audio") return "audio/ogg; codecs=opus";
  return "application/octet-stream";
}

function isWithin(candidate: string, root: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

async function resolveAllowedPath(filePath: string, allowedRoots: string[], baseDir: string): Promise<string> {
  const requested = filePath.trim();
  if (!requested) throw new Error("media_file_path_required");
  const candidate = isAbsolute(requested) ? resolve(requested) : resolve(baseDir, requested);
  let actual: string;
  try {
    actual = await realpath(candidate);
  } catch {
    throw new Error("media_file_not_found");
  }
  const roots = await Promise.all(allowedRoots.map(async (root) => {
    try { return await realpath(resolve(root)); } catch { return resolve(root); }
  }));
  if (!roots.some((root) => isWithin(actual, root))) throw new Error("media_file_outside_allowed_roots");
  return actual;
}

export async function prepareOutboundMedia(input: OutboundMediaInput, options: {
  allowedRoots: string[];
  maxBytes: number;
  baseDir?: string;
}): Promise<PreparedOutboundMedia> {
  const baseDir = options.baseDir?.trim() || process.cwd();
  const absolutePath = await resolveAllowedPath(input.filePath, options.allowedRoots, baseDir);
  const info = await stat(absolutePath);
  if (!info.isFile()) throw new Error("media_source_must_be_file");
  if (info.size <= 0) throw new Error("media_file_empty");
  if (info.size > options.maxBytes) throw new Error(`media_file_too_large:${Math.round(options.maxBytes / 1024 / 1024)}MB`);

  const mimeType = normalizeMime(input.mimeType, absolutePath, input.kind);
  if (input.kind === "image" && !mimeType.startsWith("image/")) throw new Error("media_mime_kind_mismatch");
  if (input.kind === "audio" && !mimeType.startsWith("audio/")) throw new Error("media_mime_kind_mismatch");
  const voiceNote = input.kind === "audio" && input.voiceNote === true;
  if (voiceNote && !/^audio\/(ogg|opus)(?:;|$)/i.test(mimeType)) throw new Error("voice_note_requires_ogg_opus");

  const bytes = await readFile(absolutePath);
  if (bytes.length > options.maxBytes) throw new Error(`media_file_too_large:${Math.round(options.maxBytes / 1024 / 1024)}MB`);
  const fileName = sanitizeAttachmentFileName(input.fileName || basename(absolutePath), mimeType, input.kind);
  const caption = input.caption?.trim().slice(0, 4096) || undefined;

  return {
    kind: input.kind,
    absolutePath,
    bytes,
    fileName,
    mimeType,
    sizeBytes: bytes.length,
    caption,
    voiceNote,
  };
}
