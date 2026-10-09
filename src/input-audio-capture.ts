import { downloadMediaMessage, type WAMessage } from "baileys";
import pino from "pino";
import { AttachmentInbox, describeWhatsappMedia, type InboxAttachment } from "./attachment-inbox.js";
import { transcribeInboxAudio } from "./audio-transcriber.js";
import { AppSettingsStore } from "./settings.js";
import { SolPluginClient } from "./sol-plugin-client.js";
import { BridgeStore } from "./store.js";
import type { AccountRecord, StoredMessage } from "./types.js";
import { WhatsappManager } from "./whatsapp-manager.js";

const logger = pino({ level: "silent" });
type InputOrigin = "history" | "realtime";
type InputRuntime = {
  socket?: { updateMediaMessage: (message: WAMessage) => Promise<WAMessage> };
  phoneJid?: string;
  lastError?: string;
  updatedAt: Date;
};
type ManagerInternals = {
  ingestMessage: (account: AccountRecord, runtime: InputRuntime, message: WAMessage, origin: InputOrigin, ownJid?: string) => Promise<void>;
};

export function transcriptRecord(original: StoredMessage, text: string): StoredMessage {
  return {
    ...original,
    id: `${original.id}:transcription`,
    sourceMessageId: `${original.sourceMessageId}:transcription`,
    messageType: "audioTranscription",
    text: text.trim(),
  };
}

/**
 * INPUT archives are read-only observations, not authenticated commands.
 * The independent queue is intentionally not part of WhatsApp's ordered ingest queue:
 * expensive downloads/dictation must never block incoming texts.
 */
export function installInputAudioTranscription(
  manager: WhatsappManager,
  settingsStore: AppSettingsStore,
  inbox: AttachmentInbox,
  store: BridgeStore,
  solPlugin: SolPluginClient,
): { recover: () => Promise<void>; stop: () => void } {
  const internal = manager as unknown as ManagerInternals;
  const originalIngest = internal.ingestMessage.bind(manager);
  const pending = new Set<string>();
  const jobs: Array<{ id: string; run: () => Promise<void> }> = [];
  let active = 0;
  let stopped = false;
  let recovering = false;

  const pump = (): void => {
    while (!stopped && active < 2 && jobs.length) {
      const job = jobs.shift()!;
      active++;
      void job.run().catch((error: unknown) => {
        console.error(`[input-audio] ${job.id}: ${error instanceof Error ? error.message : String(error)}`);
      }).finally(() => {
        pending.delete(job.id);
        active--;
        pump();
      });
    }
  };

  const enqueue = (id: string, run: () => Promise<void>): void => {
    if (stopped || pending.has(id)) return;
    pending.add(id);
    jobs.push({ id, run });
    pump();
  };

  const publish = async (attachment: InboxAttachment): Promise<void> => {
    const source = await store.getMessage(attachment.conversationMessageId);
    if (!source || source.messageType !== "audioMessage") return;
    let transcript = attachment.transcription?.trim();
    if (!transcript) {
      const config = await settingsStore.get();
      if (!config.multimodal.audioTranscriptionEnabled) return;
      if (attachment.transcriptionRetryAt && Date.parse(attachment.transcriptionRetryAt) > Date.now()) return;
      try {
        const result = await transcribeInboxAudio(attachment, inbox, settingsStore);
        transcript = result.text.trim();
        await inbox.setTranscription(attachment.id, transcript, result.model);
        attachment.transcription = transcript;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        await inbox.setTranscriptionError(attachment.id, detail);
        console.error(`[input-audio] Transcription failed for ${source.id}: ${detail}`);
        return;
      }
    }
    // A transcript is a distinct, deterministic observation linked to its original
    // audio by the :transcription suffix. No database migration or archive rewrites.
    const projected = transcriptRecord(source, transcript);
    await store.appendMessage(projected);
    if (!solPlugin.enabled || attachment.solIndexedAt) return;
    try {
      const account = await store.getAccount(source.accountId);
      if (!account || account.role !== "input") return;
      await solPlugin.ingestWhatsappMessage(account, projected);
      await inbox.setSolIndexed(attachment.id);
    } catch (error) {
      console.warn(`[input-audio] SOL sync pending for ${projected.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const capture = async (account: AccountRecord, runtime: InputRuntime, message: WAMessage, messageId: string): Promise<void> => {
    let attachment = (await inbox.listForMessages([messageId])).find((entry) => entry.kind === "audio");
    if (!attachment) {
      const settings = await settingsStore.get();
      if (!settings.multimodal.enabled || !settings.multimodal.audioTranscriptionEnabled) return;
      const descriptor = describeWhatsappMedia(message.message);
      if (descriptor?.kind !== "audio" || !runtime.socket) return;
      const maxBytes = settings.multimodal.maxFileMb * 1024 * 1024;
      if (descriptor.declaredBytes && descriptor.declaredBytes > maxBytes) {
        console.warn(`[input-audio] Oversized audio skipped: ${messageId}`);
        return;
      }
      const downloaded = await downloadMediaMessage(message, "buffer", {}, {
        logger,
        reuploadRequest: runtime.socket.updateMediaMessage.bind(runtime.socket),
      });
      if (!Buffer.isBuffer(downloaded)) throw new Error("Unexpected WhatsApp audio data");
      attachment = await inbox.save({
        conversationMessageId: messageId,
        peerPhone: message.key.remoteJid || account.id,
        descriptor,
        bytes: downloaded,
        maxBytes,
      });
      await inbox.cleanup(settings.multimodal.retentionDays).catch(() => undefined);
    }
    await publish(attachment);
  };

  internal.ingestMessage = async (account, runtime, message, origin, ownJid) => {
    await originalIngest(account, runtime, message, origin, ownJid);
    if (account.role !== "input" || origin !== "realtime") return;
    if (describeWhatsappMedia(message.message)?.kind !== "audio") return;
    const chatJid = message.key.remoteJid;
    const sourceId = message.key.id;
    if (!chatJid || !sourceId) return;
    const messageId = `${account.id}:${chatJid}:${sourceId}`;
    enqueue(messageId, () => capture(account, runtime, message, messageId));
  };

  const recover = async (): Promise<void> => {
    if (recovering || stopped) return;
    recovering = true;
    try {
      const settings = await settingsStore.get();
      if (!settings.multimodal.enabled || !settings.multimodal.audioTranscriptionEnabled) return;
      const accounts = new Set((await store.listAccounts()).filter((a) => a.role === "input").map((a) => a.id));
      const attachments = await inbox.listAll();
      for (const item of attachments) {
        if (item.kind !== "audio" || !accounts.has(item.conversationMessageId.split(":")[0]!)) continue;
        if (item.transcription && (!solPlugin.enabled || item.solIndexedAt)) continue;
        if (item.transcriptionRetryAt && Date.parse(item.transcriptionRetryAt) > Date.now()) continue;
        enqueue(item.conversationMessageId, () => publish(item));
      }
    } catch (error) {
      console.warn(`[input-audio] Recovery failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      recovering = false;
    }
  };

  const recoveryTimer = setInterval(() => { void recover(); }, 120_000);
  recoveryTimer.unref?.();
  return {
    recover,
    stop: () => {
      stopped = true;
      clearInterval(recoveryTimer);
      jobs.length = 0;
    },
  };
}
