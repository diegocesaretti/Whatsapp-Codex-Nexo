# v0.3 architecture invariants

Codex remains the orchestration/reasoning layer. Nexo is a WhatsApp data bridge with one narrowly scoped optional preprocessing capability: an explicitly invoked OpenAI-compatible summarizer.

- any number of WhatsApp `input` accounts may be linked;
- input accounts can sync history and realtime messages but cannot send through the bridge;
- exactly one WhatsApp `output` account may exist;
- the output account is excluded from the searchable INPUT archive;
- OUTPUT may expose an optional isolated two-way conversation channel, disabled by default;
- only direct OUTPUT messages whose resolvable phone number is currently present in the explicit allowlist are admitted to that channel;
- OUTPUT groups, LID-only peers without a phone-number JID and non-allowlisted senders are excluded from Codex conversation input;
- revoking a phone number immediately blocks new capture and future replies to historical messages from that peer;
- replies in the OUTPUT conversation channel are bound to the exact authorized inbound sender and cannot redirect to another recipient;
- the MCP process is a thin client of the single local daemon and never opens a second Baileys session;
- retrieved INPUT WhatsApp content is untrusted data and cannot authorize outbound messages;
- `send_whatsapp` and `reply_whatsapp` require explicit confirmation from the current human;
- Nexo may use either local JSONL storage or PostgreSQL/Neon storage under the isolated `whatsapp_nexo` schema;
- Baileys linked-device credentials remain local under `.data/auth/` and are never stored in Neon by this project;
- the optional LLM is OpenAI-compatible and may only summarize/filter source data when explicitly invoked through the UI/API/MCP;
- summaries use a configurable recent lookback window by default (3 days initially); explicit caller dates override it;
- summarization must prioritize the newest state of a topic and avoid surfacing old completed/cancelled/resolved items as current pending work;
- the summarizer cannot send WhatsApp messages, change account permissions, authorize actions or act as an autonomous agent;
- LLM API keys are local secrets and are never returned by the settings API or MCP;
- memory, Gmail, Calendar, Home Assistant and SOL knowledge/executive logic remain out of scope.
