import { downloadMediaMessage, type WAMessage } from "baileys";
import pino from "pino";
import { AttachmentInbox, describeWhatsappMedia } from "./attachment-inbox.js";
import { isAuthorizedPhone, phoneNumberFromJid, safePhoneJid } from "./output-conversation-auth.js";
import { AppSettingsStore } from "./settings.js";
import type { AccountRecord } from "./types.js";
import { WhatsappManager } from "./whatsapp-manager.js";

const logger = pino({ level: "silent" });

type ExtendedMessageKey = WAMessage["key"] & { remoteJidAlt?: string | null };
type RuntimeLike = {
  socket?: { updateMediaMessage: (message: WAMessage) => Promise<WAMessage> };
  lastError?: string;
  updatedAt: Date;
};

type ManagerInternals = {
  ingestOutputConversationMessage: (account: AccountRecord, runtime: RuntimeLike, message: WAMessage) => Promise<void>;
};

export function installMultimodalCapture(
  manager: WhatsappManager,
  settingsStore: AppSettingsStore,
  inbox: AttachmentInbox,
): void {
  const internal = manager as unknown as ManagerInternals;
  const original = internal.ingestOutputConversationMessage.bind(manager);

  internal.ingestOutputConversationMessage = async (account, runtime, message) => {
    try {
      const settings = await settingsStore.get();
      if (settings.multimodal.enabled && settings.outputConversation.enabled) {
        const key = message.key as ExtendedMessageKey;
        const remoteJid = key.remoteJid;
        const sourceMessageId = key.id;
        const remoteAltJid = key.remoteJidAlt ?? undefined;
        const peerJid = safePhoneJid(remoteJid ?? undefined, remoteAltJid);
        const peerPhone = phoneNumberFromJid(peerJid);
        const descriptor = describeWhatsappMedia(message.message);
        const direct = Boolean(remoteJid && !remoteJid.endsWith("@g.us"));
        const authorized = Boolean(peerPhone && isAuthorizedPhone(settings.outputConversation.authorizedNumbers, peerPhone));

        if (!key.fromMe && sourceMessageId && direct && authorized && descriptor && runtime.socket) {
          const conversationMessageId = `${account.id}:${sourceMessageId}:inbound`;
          const existing = await inbox.listForMessages([conversationMessageId]);
          if (!existing.length) {
            const maxBytes = settings.multimodal.maxFileMb * 1024 * 1024;
            if (descriptor.declaredBytes && descriptor.declaredBytes > maxBytes) {
              throw new Error(`Attachment ${descriptor.fileName || descriptor.kind} is ${Math.ceil(descriptor.declaredBytes / 1024 / 1024)} MB; limit is ${settings.multimodal.maxFileMb} MB`);
            }
            const buffer = await downloadMediaMessage(
              message,
              "buffer",
              {},
              {
                logger,
                reuploadRequest: runtime.socket.updateMediaMessage.bind(runtime.socket),
              },
            );
            if (!Buffer.isBuffer(buffer)) throw new Error("Baileys returned an unexpected media payload");
            await inbox.save({
              conversationMessageId,
              peerPhone: peerPhone!,
              descriptor,
              bytes: buffer,
              maxBytes,
            });
            await inbox.cleanup(settings.multimodal.retentionDays).catch(() => undefined);
          }
        }
      }
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      runtime.lastError = `Multimodal capture: ${messageText}`;
      runtime.updatedAt = new Date();
      console.error(`[multimodal:${account.id}] capture failed`, error);
    }
    await original(account, runtime, message);
  };
}
