import type { WAMessage } from "baileys";

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function unwrapWhatsappContent(content: unknown): Record<string, any> | undefined {
  if (!content || typeof content !== "object") return undefined;
  let current = content as Record<string, any>;
  for (let index = 0; index < 6; index += 1) {
    const nested =
      current.ephemeralMessage?.message ??
      current.viewOnceMessage?.message ??
      current.viewOnceMessageV2?.message ??
      current.viewOnceMessageV2Extension?.message ??
      current.documentWithCaptionMessage?.message;
    if (!nested || typeof nested !== "object") break;
    current = nested as Record<string, any>;
  }
  return current;
}

export function extractWhatsappText(content: unknown): string | undefined {
  const message = unwrapWhatsappContent(content);
  if (!message) return undefined;
  return (
    text(message.conversation) ??
    text(message.extendedTextMessage?.text) ??
    text(message.imageMessage?.caption) ??
    text(message.videoMessage?.caption) ??
    text(message.documentMessage?.caption) ??
    text(message.buttonsResponseMessage?.selectedDisplayText) ??
    text(message.listResponseMessage?.title) ??
    text(message.templateButtonReplyMessage?.selectedDisplayText) ??
    text(message.pollCreationMessage?.name) ??
    text(message.eventMessage?.name)
  );
}

export function detectWhatsappMessageType(content: unknown): string | undefined {
  const message = unwrapWhatsappContent(content);
  if (!message) return undefined;
  return Object.keys(message).find(
    (key) => (key === "conversation" || key.endsWith("Message")) && key !== "senderKeyDistributionMessage",
  );
}

export function whatsappTimestamp(value: WAMessage["messageTimestamp"]): Date {
  let seconds: number | undefined;
  if (typeof value === "number") seconds = value;
  else if (typeof value === "bigint") seconds = Number(value);
  else if (value && typeof value === "object") {
    const candidate = value as { toNumber?: () => number; low?: number };
    if (typeof candidate.toNumber === "function") seconds = candidate.toNumber();
    else if (typeof candidate.low === "number") seconds = candidate.low;
  }
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return new Date();
  return new Date(seconds * 1000);
}

export function shouldIgnoreJid(jid: string | null | undefined): boolean {
  if (!jid) return true;
  return jid === "status@broadcast" || jid.endsWith("@broadcast") || jid.endsWith("@newsletter");
}

export function normalizeSendTarget(value: string): string {
  const input = value.trim();
  if (!input) throw new Error("WhatsApp destination is required");
  if (input.includes("@")) return input;
  const digits = input.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 16) {
    throw new Error("Use a full phone number with country code, or an exact WhatsApp JID");
  }
  return `${digits}@s.whatsapp.net`;
}
