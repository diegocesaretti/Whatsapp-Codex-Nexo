export type AccountRole = "input" | "output";

export interface AccountRecord {
  id: string;
  label: string;
  role: AccountRole;
  enabled: boolean;
  createdAt: string;
  linkedAt?: string;
  phoneJid?: string;
  displayName?: string;
  lastError?: string;
}

export type RuntimeState =
  | "idle"
  | "connecting"
  | "qr"
  | "open"
  | "reconnecting"
  | "error"
  | "logged_out";

export interface RuntimeStatus {
  accountId: string;
  state: RuntimeState;
  qrDataUrl?: string;
  phoneJid?: string;
  displayName?: string;
  reconnectAttempt: number;
  lastError?: string;
  updatedAt: string;
  receivedMessages: number;
  storedMessages: number;
  historyMessages: number;
  lastMessageAt?: string;
}

export interface StoredMessage {
  id: string;
  accountId: string;
  accountLabel: string;
  sourceMessageId: string;
  chatJid: string;
  chatAltJid?: string;
  chatName?: string;
  senderJid?: string;
  senderAltJid?: string;
  senderName?: string;
  addressingMode?: string;
  fromMe: boolean;
  text?: string;
  messageType?: string;
  occurredAt: string;
  origin: "history" | "realtime";
}

export interface WhatsappChatSummary {
  accountId: string;
  accountLabel: string;
  chatJid: string;
  chatAltJid?: string;
  chatName?: string;
  kind: "direct" | "group";
  sendTarget?: string;
  messageCount: number;
  lastMessageAt: string;
  lastText?: string;
  lastSenderName?: string;
}

export interface OutboundReplyContext {
  storedMessageId: string;
  sourceAccountId: string;
  sourceMessageId: string;
  chatJid: string;
  chatAltJid?: string;
  chatName?: string;
  senderName?: string;
  occurredAt: string;
}

export interface OutboundAudit {
  id: string;
  accountId: string;
  to: string;
  text: string;
  reason?: string;
  replyTo?: OutboundReplyContext;
  messageId?: string;
  sentAt: string;
}
