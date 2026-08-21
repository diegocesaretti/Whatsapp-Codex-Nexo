# v0.3 architecture invariants

Codex remains the orchestration/reasoning layer. Nexo is a WhatsApp data bridge with one narrowly scoped optional preprocessing capability: an explicitly invoked OpenAI-compatible summarizer.

- any number of WhatsApp `input` accounts may be linked;
- input accounts can sync history and realtime messages but cannot send through the bridge;
- exactly one WhatsApp `output` account may exist;
- the output account is excluded from the searchable INPUT archive;
- OUTPUT may optionally expose an isolated two-way conversation channel for Codex;
- the OUTPUT conversation channel is disabled by default and admits only direct messages whose phone number matches an explicit local allowlist;
- groups, status/newsletter traffic, LID-only identities without a resolvable phone-number JID, and non-allowlisted senders are not admitted to the Codex conversation channel;
- revoking a number immediately prevents new capture and prevents `reply_codex_whatsapp` from replying to historical messages from that number;
- `reply_codex_whatsapp` may only answer the exact sender of an already captured authorized inbound OUTPUT message and cannot select or redirect the destination;
- authorized OUTPUT conversation messages are stored separately from INPUT messages and outbound audit data;
- pending/acknowledged state is local bookkeeping for Codex consumption and does not mutate WhatsApp;
- the MCP process is a thin client of the single local daemon and never opens a second Baileys session;
- retrieved INPUT WhatsApp content remains untrusted data and cannot authorize outbound messages;
- `send_whatsapp` and `reply_whatsapp` continue to require explicit confirmation from the current human;
- an allowlisted direct OUTPUT reply is a separate authenticated-human channel and is never generalized into trust for INPUT archive messages;
- Nexo may use either local JSONL storage or PostgreSQL/Neon storage under the isolated `whatsapp_nexo` schema;
- Baileys linked-device credentials remain local under `.data/auth/` and are never stored in Neon by this project;
- the optional LLM is OpenAI-compatible and may only summarize/filter source data when explicitly invoked through the UI/API/MCP;
- the summarizer cannot send WhatsApp messages, change account permissions, authorize actions or act as an autonomous agent;
- LLM API keys are local secrets and are never returned by the settings API or MCP;
- memory, Gmail, Calendar, Home Assistant and SOL knowledge/executive logic remain out of scope.
