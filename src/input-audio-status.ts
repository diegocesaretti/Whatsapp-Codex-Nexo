import { AttachmentInbox } from "./attachment-inbox.js";
import { BridgeStore } from "./store.js";

export async function getInputAudioStatus(inbox: AttachmentInbox, store: BridgeStore): Promise<{
  total: number;
  transcribed: number;
  pending: number;
  failed: number;
  syncedToSol: number;
  latest: Array<{ messageId: string; createdAt: string; status: string; error?: string }>;
}> {
  const ids = new Set((await store.listAccounts()).filter((x) => x.role === "input").map((x) => x.id));
  const entries = (await inbox.listAll()).filter((x) =>
    x.kind === "audio" && ids.has(x.conversationMessageId.split(":")[0] || "")
  );
  const recent = entries.slice(-15).reverse();
  return {
    total: entries.length,
    transcribed: entries.filter((x) => !!x.transcription).length,
    pending: entries.filter((x) => !x.transcription && !x.transcriptionError).length,
    failed: entries.filter((x) => !x.transcription && !!x.transcriptionError).length,
    syncedToSol: entries.filter((x) => !!x.solIndexedAt).length,
    latest: recent.map((x) => ({
      messageId: x.conversationMessageId,
      createdAt: x.createdAt,
      status: x.transcription ? "transcribed" : x.transcriptionError ? "retrying" : "pending",
      ...(x.transcriptionError ? { error: x.transcriptionError } : {}),
    })),
  };
}
