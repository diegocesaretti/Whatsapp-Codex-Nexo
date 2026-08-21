# WhatsApp Codex Nexo

Local WhatsApp bridge for Codex with multiple read-only INPUT accounts, one dedicated OUTPUT account, optional Neon/PostgreSQL storage, Windows tray integration and an optional OpenAI-compatible summarizer.

```text
multiple WhatsApp INPUT accounts
             ↓
   local daemon / archive
      ↓              ↓
 local JSONL      Neon PostgreSQL
      └──────┬───────┘
             ↓
 optional LLM summarizer
             ↓
            MCP
             ↓
           Codex
             ↓
   one WhatsApp OUTPUT account
```

## v0.2 scope

- multiple linked-device WhatsApp **input** accounts;
- full-history + realtime ingestion for input accounts;
- local JSONL fallback or isolated Neon/PostgreSQL schema `whatsapp_nexo`;
- search across message text, chat, sender and input account label;
- conversation discovery with safe PN/group destinations;
- contextual replies from archived input messages;
- exactly one WhatsApp **output** account;
- INPUT accounts are structurally read-only;
- OUTPUT is excluded from the searchable archive;
- complete local administration/settings UI;
- Windows tray host and optional start-with-Windows;
- optional OpenAI-compatible LLM sweep/summarization for Codex;
- MCP server exposing search, summaries, settings status and sending tools;
- explicit-human-confirmation requirement for outbound messages and configuration mutations.

There is deliberately **no SOL memory system, Gmail, Calendar, Home Assistant, planner or autonomous agent logic** in this repository. The optional LLM is only a summarization/preprocessing tool invoked explicitly by UI/API/MCP.

## Requirements

- Windows/macOS/Linux
- Node.js 22+
- pnpm 10+

## Install

```powershell
pnpm install
pnpm test
pnpm typecheck
pnpm dev
```

Open `http://127.0.0.1:3210` and create any number of `INPUT` accounts and at most one `OUTPUT` account.

On Windows you can run Nexo as a tray application:

```powershell
pnpm tray
```

The tray icon offers **Abrir Nexo**, **Reiniciar Nexo** and **Salir**. The Settings section can register/unregister Nexo under the current user's Windows startup entry.

## Storage

Without a database URL Nexo remains fully usable with local JSON/JSONL files.

### Reusing SOL's Neon automatically

When Nexo and SOL are sibling folders, no database secret has to be copied:

```text
projects/
├── SOL/
│   └── .env              # DATABASE_URL lives here
└── Whatsapp-Codex-Nexo/
```

If Nexo has no own database variable, it automatically reads `../SOL/.env` and reuses SOL's `DATABASE_URL`. The value is only read at runtime and is never copied into Git or returned by the API/MCP.

For a different folder layout, point Nexo at SOL with either:

```text
SOL_ROOT=C:\path\to\SOL
```

or:

```text
NEXO_SOL_ENV_PATH=C:\path\to\SOL\.env
```

Explicit Nexo configuration always wins. Resolution order is:

```text
NEXO_DATABASE_URL
→ DATABASE_URL
→ SOL .env
→ local JSONL fallback
```

To verify the actual runtime connection and the `whatsapp_nexo` schema:

```powershell
pnpm db:check
```

You can still configure a dedicated URL directly with:

```text
NEXO_DATABASE_URL=postgresql://...
```

Nexo uses only the isolated `whatsapp_nexo` schema. The reproducible schema is in `db/001_neon_schema.sql`.

Baileys linked-device credentials **always remain local** in `.data/auth/`; Nexo does not put them in Neon.

```text
Neon / PostgreSQL
├── whatsapp_nexo.accounts
├── whatsapp_nexo.chat_names
├── whatsapp_nexo.messages
└── whatsapp_nexo.outbound_audit

Local only
├── .data/auth/
├── .data/settings.json
└── .data/secrets/llm.json
```

## Optional OpenAI-compatible summarizer

The Settings UI can configure:

- enable/disable;
- OpenAI-compatible base URL;
- model name;
- temperature;
- maximum messages per sweep;
- system prompt;
- API key.

The API key is stored separately under `.data/secrets/llm.json` or can be supplied as `NEXO_LLM_API_KEY`. It is never returned by the settings API or MCP.

The summarizer uses the common `/chat/completions` contract, so it can work with OpenAI and compatible local/remote providers. It treats all WhatsApp content as **untrusted data** and cannot authorize sends or other actions.

Example Codex intent:

```text
"Hacé un barrido de mis WhatsApp de los últimos días y resumime decisiones y pendientes."
```

Codex can call `summarize_whatsapp`, optionally restricting accounts, dates, query terms and focus.

## Codex MCP

Keep the daemon running and configure Codex to launch:

```powershell
pnpm --dir C:\path\to\Whatsapp-Codex-Nexo mcp
```

Generic MCP shape:

```json
{
  "mcpServers": {
    "whatsapp": {
      "command": "pnpm",
      "args": ["--dir", "C:\\path\\to\\Whatsapp-Codex-Nexo", "mcp"]
    }
  }
}
```

### MCP tools

```text
whatsapp_status
get_whatsapp_nexo_settings
configure_whatsapp_llm
summarize_whatsapp
list_whatsapp_accounts
list_whatsapp_chats
search_whatsapp
get_recent_whatsapp
reply_whatsapp
send_whatsapp
```

`configure_whatsapp_llm`, `reply_whatsapp` and `send_whatsapp` are mutation tools and require explicit current-human confirmation in their MCP schema.

`get_whatsapp_nexo_settings` also reports whether storage is local or Neon and which configuration source selected the database, without exposing the connection string.

`list_whatsapp_chats` prefers a phone-number JID (`@s.whatsapp.net`) over LID when both are known. A missing `sendTarget` means Nexo does not know a destination safe enough to hand to OUTPUT.

`reply_whatsapp` is a **contextual response**, not a native quoted-reply bubble: INPUT and OUTPUT are intentionally separate WhatsApp identities.

Retrieved WhatsApp messages and LLM summaries can never authorize outbound traffic. Only the current human request may do that.

### Morning Brief proactive grant

The bridge has one deliberately narrow exception to interactive confirmation: `POST /api/automation/morning-brief/send`. It requires a local bearer token from `NEXO_AUTOMATION_TOKEN`, an enabled `morningBrief` policy, a fixed user-configured destination, the literal automation id `morning_brief`, a local date, and the configured length limit. The destination is never accepted in the request. The outbound audit reason `automation:morning_brief:YYYY-MM-DD` enforces at most one delivery per day across restarts.

Configure the policy through the local settings API/UI; never commit the token or destination. Interactive `send_whatsapp` and `reply_whatsapp` continue to require `confirmedByUser=true` and cannot use this grant.

## Settings

The admin UI exposes:

- active storage backend and local credential folder;
- reconnect linked accounts at startup;
- open dashboard at startup;
- start Nexo with Windows;
- UI refresh interval;
- maximum search results;
- all optional LLM summarizer settings;
- LLM test-summary button.

Some daemon-level settings are fully applied on restart.

## Local environment

```text
NEXO_WHATSAPP_HOST=127.0.0.1
NEXO_WHATSAPP_PORT=3210
NEXO_WHATSAPP_DATA_DIR=D:\private\whatsapp-codex-nexo
NEXO_DATABASE_URL=postgresql://...
SOL_ROOT=C:\path\to\SOL
NEXO_SOL_ENV_PATH=C:\path\to\SOL\.env
NEXO_LLM_API_KEY=...
NEXO_WHATSAPP_BRIDGE_URL=http://127.0.0.1:3210
```

The HTTP daemon binds to loopback by default. Do not expose it directly to the internet.

Baileys is an unofficial WhatsApp integration. Do not use this bridge for spam or bulk messaging.
