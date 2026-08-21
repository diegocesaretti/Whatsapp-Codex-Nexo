CREATE TABLE IF NOT EXISTS whatsapp_nexo.output_conversation_messages (
  id text PRIMARY KEY,
  account_id uuid REFERENCES whatsapp_nexo.accounts(id) ON DELETE SET NULL,
  whatsapp_message_id text NOT NULL,
  peer_jid text NOT NULL,
  peer_alt_jid text,
  peer_phone text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('inbound','outbound')),
  text_content text,
  message_type text,
  sender_name text,
  authorized boolean NOT NULL DEFAULT false,
  occurred_at timestamptz NOT NULL,
  reply_to_id text REFERENCES whatsapp_nexo.output_conversation_messages(id) ON DELETE SET NULL,
  acknowledged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_nexo_output_conversation_source_idx
  ON whatsapp_nexo.output_conversation_messages (account_id, whatsapp_message_id, direction);

CREATE INDEX IF NOT EXISTS whatsapp_nexo_output_conversation_peer_time_idx
  ON whatsapp_nexo.output_conversation_messages (peer_phone, occurred_at DESC);

CREATE INDEX IF NOT EXISTS whatsapp_nexo_output_conversation_pending_idx
  ON whatsapp_nexo.output_conversation_messages (occurred_at ASC)
  WHERE direction = 'inbound' AND authorized = true AND acknowledged_at IS NULL;
