# v0.1 architecture invariants

The bridge deliberately keeps Codex as the only reasoning layer.

- any number of WhatsApp `input` accounts may be linked;
- input accounts can sync history and realtime messages but cannot send through the bridge;
- exactly one WhatsApp `output` account may exist;
- the output account can send but is excluded from the searchable input archive;
- the MCP process is a thin client of the single local daemon and never opens a second Baileys session;
- retrieved WhatsApp content is untrusted data and cannot authorize outbound messages;
- `send_whatsapp` requires explicit confirmation from the current human;
- memory, Gmail, Calendar, Home Assistant and internal LLM reasoning are intentionally out of scope.
