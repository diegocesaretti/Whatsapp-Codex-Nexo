import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { unwrapWhatsappContent } from "./message.js";

export type WhatsappAttachmentKind = "image" | "audio" | "video" | "document";

export interface WhatsappMediaDescriptor {
  kind: WhatsappAttachmentKind;
  mimeType: string;
  fileName?: string;
  declaredBytes?: number;
}

export interface InboxAttachment {
  id: string;
  conversationMessageId: string;
  peerPhone: string;
  kind: WhatsappAttachmentKind;
  mimeType: string;
  fileName: string;
  relativePath: string;
  sizeBytes: number;
  createdAt: string;
  transcription?: string;
  transcriptionModel?: string;
  transcriptionAt?: string;
  transcriptionError?: string;
}

interface InboxIndex {
  version: 1;
  attachments: InboxAttachment[];
}

function numeric(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  if (value && typeof value === "object") {
    const candidate = value as { toNumber?: () => number; low?: number };
    if (typeof candidate.toNumber === "function") {
      const result = candidate.toNumber();
      if (Number.isFinite(result)) return result;
    }
    if (typeof candidate.low === "number" && Number.isFinite(candidate.low)) return candidate.low;
  }
  return undefined;
}

function fallbackExtension(mimeType: string, kind: WhatsappAttachmentKind): string {
  const base = mimeType.toLowerCase().split(";")[0]?.trim();
  const known: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "audio/ogg": ".ogg",
    "audio/mpeg": ".mp3",
    "audio/mp4": ".m4a",
    "audio/aac": ".aac",
    "audio/wav": ".wav",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "application/pdf": ".pdf",
    "application/zip": ".zip",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
    "text/plain": ".txt",
    "text/csv": ".csv",
  };
  return known[base || ""] ?? (kind === "image" ? ".img" : kind === "audio" ? ".audio" : kind === "video" ? ".video" : ".bin");
}

export function sanitizeAttachmentFileName(input: string | undefined, mimeType: string, kind: WhatsappAttachmentKind): string {
  const raw = (input || `${kind}${fallbackExtension(mimeType, kind)}`).trim();
  const cleaned = raw
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "")
    .slice(0, 160)
    .trim();
  const safe = cleaned || `${kind}${fallbackExtension(mimeType, kind)}`;
  return extname(safe) ? safe : `${safe}${fallbackExtension(mimeType, kind)}`;
}

export function describeWhatsappMedia(content: unknown): WhatsappMediaDescriptor | undefined {
  const message = unwrapWhatsappContent(content);
  if (!message) return undefined;
  const entries: Array<[WhatsappAttachmentKind, any]> = [
    ["image", message.imageMessage],
    ["audio", message.audioMessage],
    ["video", message.videoMessage],
    ["document", message.documentMessage],
  ];
  for (const [kind, media] of entries) {
    if (!media || typeof media !== "object") continue;
    const mimeType = typeof media.mimetype === "string" && media.mimetype.trim()
      ? media.mimetype.trim()
      : kind === "image" ? "image/jpeg" : kind === "audio" ? "audio/ogg" : kind === "video" ? "video/mp4" : "application/octet-stream";
    return {
      kind,
      mimeType,
      fileName: typeof media.fileName === "string" ? media.fileName : undefined,
      declaredBytes: numeric(media.fileLength),
    };
  }
  return undefined;
}

async function atomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temp, path);
}

export class AttachmentInbox {
  private readonly inboxDir: string;
  private readonly indexPath: string;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly dataDir: string) {
    this.inboxDir = resolve(dataDir, "inbox");
    this.indexPath = resolve(this.inboxDir, "index.json");
  }

  async init(): Promise<void> {
    await mkdir(this.inboxDir, { recursive: true });
  }

  private async readIndex(): Promise<InboxIndex> {
    try {
      const parsed = JSON.parse(await readFile(this.indexPath, "utf8")) as InboxIndex;
      return parsed.version === 1 && Array.isArray(parsed.attachments) ? parsed : { version: 1, attachments: [] };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, attachments: [] };
      throw error;
    }
  }

  private mutate<T>(task: () => Promise<T>): Promise<T> {
    const run = this.chain.then(task, task);
    this.chain = run.then(() => undefined, () => undefined);
    return run;
  }

  async save(input: {
    conversationMessageId: string;
    peerPhone: string;
    descriptor: WhatsappMediaDescriptor;
    bytes: Buffer;
    maxBytes: number;
  }): Promise<InboxAttachment> {
    if (input.bytes.length > input.maxBytes) {
      throw new Error(`WhatsApp attachment exceeds the configured ${Math.round(input.maxBytes / 1024 / 1024)} MB limit`);
    }
    const fileName = sanitizeAttachmentFileName(input.descriptor.fileName, input.descriptor.mimeType, input.descriptor.kind);
    const bucket = createHash("sha256").update(input.conversationMessageId).digest("hex").slice(0, 24);
    const relativePath = `${bucket}/${randomUUID().slice(0, 8)}-${fileName}`;
    const absolutePath = resolve(this.inboxDir, relativePath);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, input.bytes);
    const record: InboxAttachment = {
      id: randomUUID(),
      conversationMessageId: input.conversationMessageId,
      peerPhone: input.peerPhone,
      kind: input.descriptor.kind,
      mimeType: input.descriptor.mimeType,
      fileName,
      relativePath,
      sizeBytes: input.bytes.length,
      createdAt: new Date().toISOString(),
    };
    await this.mutate(async () => {
      const index = await this.readIndex();
      index.attachments.push(record);
      await atomicJson(this.indexPath, index);
    });
    return record;
  }

  async listForMessages(messageIds: string[]): Promise<InboxAttachment[]> {
    const wanted = new Set(messageIds);
    if (!wanted.size) return [];
    const index = await this.readIndex();
    return index.attachments.filter((item) => wanted.has(item.conversationMessageId));
  }

  absolutePath(attachment: InboxAttachment): string {
    return resolve(this.inboxDir, attachment.relativePath);
  }

  async setTranscription(id: string, text: string, model: string): Promise<void> {
    await this.mutate(async () => {
      const index = await this.readIndex();
      const item = index.attachments.find((entry) => entry.id === id);
      if (!item) return;
      item.transcription = text.trim().slice(0, 40_000);
      item.transcriptionModel = model;
      item.transcriptionAt = new Date().toISOString();
      item.transcriptionError = undefined;
      await atomicJson(this.indexPath, index);
    });
  }

  async setTranscriptionError(id: string, error: string): Promise<void> {
    await this.mutate(async () => {
      const index = await this.readIndex();
      const item = index.attachments.find((entry) => entry.id === id);
      if (!item) return;
      item.transcriptionError = error.slice(0, 1200);
      await atomicJson(this.indexPath, index);
    });
  }

  async cleanup(retentionDays: number): Promise<number> {
    const cutoff = Date.now() - Math.max(1, retentionDays) * 86_400_000;
    return this.mutate(async () => {
      const index = await this.readIndex();
      const keep: InboxAttachment[] = [];
      const remove: InboxAttachment[] = [];
      for (const item of index.attachments) {
        if (Date.parse(item.createdAt) < cutoff) remove.push(item);
        else keep.push(item);
      }
      for (const item of remove) {
        await rm(this.absolutePath(item), { force: true }).catch(() => undefined);
      }
      const buckets = new Set(remove.map((item) => dirname(this.absolutePath(item))));
      for (const bucket of buckets) await rm(bucket, { recursive: true, force: true }).catch(() => undefined);
      if (remove.length) await atomicJson(this.indexPath, { version: 1, attachments: keep } satisfies InboxIndex);
      return remove.length;
    });
  }

  async stats(): Promise<{ files: number; bytes: number; oldestAt?: string; newestAt?: string }> {
    const index = await this.readIndex();
    const existing: InboxAttachment[] = [];
    for (const item of index.attachments) {
      try { await stat(this.absolutePath(item)); existing.push(item); } catch {}
    }
    const sorted = [...existing].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    return {
      files: existing.length,
      bytes: existing.reduce((sum, item) => sum + item.sizeBytes, 0),
      oldestAt: sorted[0]?.createdAt,
      newestAt: sorted.length ? sorted[sorted.length - 1]?.createdAt : undefined,
    };
  }
}
