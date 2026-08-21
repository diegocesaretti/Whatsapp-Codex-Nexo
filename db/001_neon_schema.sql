CREATE SCHEMA IF NOT EXISTS whatsapp_nexo;

CREATE TABLE IF NOT EXISTS whatsapp_nexo.accounts (
  id uuid PRIMARY KEY,
  label text NOT NULL,
  role text NOT NULL CHECK (role IN ('input','output')),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL,
  linked_at timestamptz,
  phone_jid text,
  display_name text,
  last_error text
);

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_nexo_single_output_idx
  ON whatsapp_nexo.accounts ((role)) WHERE role = 'output';

CREATE TABLE IF NOT EXISTS whatsapp_nexo.chat_names (
  account_id uuid NOT NULL REFERENCES whatsapp_nexo.accounts(id) ON DELETE CASCADE,
  jid text NOT NULL,
  name text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, jid)
);

CREATE TABLE IF NOT EXISTS whatsapp_nexo.messages (
  id text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES whatsapp_nexo.accounts(id) ON DELETE CASCADE,
  account_label text NOT NULL,
  source_message_id text NOT NULL,
  chat_jid text NOT NULL,
  chat_alt_jid text,
  chat_name text,
  sender_jid text,
  sender_alt_jid text,
  sender_name text,
  addressing_mode text,
  from_me boolean NOT NULL,
  text_content text,
  message_type text,
  occurred_at timestamptz NOT NULL,
  origin text NOT NULL CHECK (origin IN ('history','realtime')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS whatsapp_nexo_messages_account_time_idx ON whatsapp_nexo.messages (account_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS whatsapp_nexo_messages_time_idx ON whatsapp_nexo.messages (occurred_at DESC);
CREATE INDEX IF NOT EXISTS whatsapp_nexo_messages_chat_idx ON whatsapp_nexo.messages (account_id, chat_jid, occurred_at DESC);

CREATE TABLE IF NOT EXISTS whatsapp_nexo.outbound_audit (
  id uuid PRIMARY KEY,
  account_id uuid REFERENCES whatsapp_nexo.accounts(id) ON DELETE SET NULL,
  to_jid text NOT NULL,
  text_content text NOT NULL,
  reason text,
  message_id text,
  reply_to jsonb,
  sent_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS whatsapp_nexo_outbound_sent_idx ON whatsapp_nexo.outbound_audit (sent_at DESC);
