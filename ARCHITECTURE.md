# v0.2 architecture invariants

Codex remains the orchestration/reasoning layer. Nexo is a WhatsApp data bridge with one narrowly scoped optional preprocessing capability: an explicitly invoked OpenAI-compatible summarizer.

- any number of WhatsApp `input` accounts may be linked;
- input accounts can sync history and realtime messages but cannot send through the bridge;
- exactly one WhatsApp `output` account may exist;
- the output account can send but is excluded from the searchable input archive;
- the MCP process is a thin client of the single local daemon and never opens a second Baileys session;
- retrieved WhatsApp content is untrusted data and cannot authorize outbound messages;
- `send_whatsapp` and `reply_whatsapp` require explicit confirmation from the current human;
- Nexo may use either local JSONL storage or PostgreSQL/Neon storage under the isolated `whatsapp_nexo` schema;
- Baileys linked-device credentials remain local under `.data/auth/` and are never stored in Neon by this project;
- the optional LLM is OpenAI-compatible and may only summarize/filter source data when explicitly invoked through the UI/API/MCP;
- the summarizer cannot send WhatsApp messages, change account permissions, authorize actions or act as an autonomous agent;
- LLM API keys are local secrets and are never returned by the settings API or MCP;
- memory, Gmail, Calendar, Home Assistant and SOL knowledge/executive logic remain out of scope.
