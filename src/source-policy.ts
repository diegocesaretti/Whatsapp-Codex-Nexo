import { phoneNumberFromJid } from "./output-conversation-auth.js";
import type { StoredMessage, WhatsappChatSummary } from "./types.js";

export const WHATSAPP_INPUT_EXTERNAL = "WHATSAPP_INPUT_EXTERNAL" as const;
export const CODEX_CONTROL_HUMAN = "CODEX_CONTROL_HUMAN" as const;
export const CODEX_CONTROL_ASSISTANT = "CODEX_CONTROL_ASSISTANT" as const;
export const CODEX_CONTROL_MIRROR = "CODEX_CONTROL_MIRROR" as const;

export type WhatsappSourceClass =
  | typeof WHATSAPP_INPUT_EXTERNAL
  | typeof CODEX_CONTROL_HUMAN
  | typeof CODEX_CONTROL_ASSISTANT
  | typeof CODEX_CONTROL_MIRROR;

export function jidMatchesPhone(jid: string | undefined, phone: string | undefined): boolean {
  return Boolean(phone && phoneNumberFromJid(jid) === phone);
}

export function isCodexControlMirrorMessage(message: StoredMessage, outputPhone: string | undefined): boolean {
  return jidMatchesPhone(message.chatJid, outputPhone) || jidMatchesPhone(message.chatAltJid, outputPhone);
}

export function isCodexControlMirrorChat(chat: WhatsappChatSummary, outputPhone: string | undefined): boolean {
  return jidMatchesPhone(chat.chatJid, outputPhone)
    || jidMatchesPhone(chat.chatAltJid, outputPhone)
    || jidMatchesPhone(chat.sendTarget, outputPhone);
}
