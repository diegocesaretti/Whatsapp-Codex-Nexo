# WhatsApp Codex Nexo

A small local WhatsApp companion for Codex.

The project has one job: give Codex a WhatsApp bridge without turning the bridge itself into another assistant.

```text
multiple WhatsApp INPUT accounts
             ↓
      local message archive
             ↓
            MCP
             ↓
           Codex
             ↓
   one WhatsApp OUTPUT account
```

## v0.1 scope

- multiple linked-device WhatsApp **input** accounts;
- full-history + realtime ingestion for input accounts;
- local append-only JSONL archive;
- search across message text, chat, sender and input account label;
- exactly one linked-device WhatsApp **output** account;
- input accounts are structurally read-only;
- the output account is structurally excluded from the searchable archive;
- local administration/diagnostic UI;
- MCP server for Codex;
- explicit-human-confirmation requirement for outbound messages.

There is deliberately **no memory system, Gmail, Calendar, Home Assistant, internal LLM, planner or chatbot logic** in this repository.

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

Open:

```text
http://127.0.0.1:3210
```

Create any number of `INPUT` accounts and at most one `OUTPUT` account. Each account is linked using WhatsApp → **Dispositivos vinculados**.

## Codex MCP

Keep the daemon running:

```powershell
pnpm dev
```

Then configure Codex to launch:

```powershell
pnpm --dir C:\path\to\Whatsapp-Codex-Nexo mcp
```

Generic MCP configuration shape:

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

If the daemon uses another address, set:

```text
NEXO_WHATSAPP_BRIDGE_URL=http://127.0.0.1:3210
```

### MCP tools

```text
whatsapp_status
list_whatsapp_accounts
search_whatsapp
get_recent_whatsapp
send_whatsapp
```

`send_whatsapp` requires `confirmedByUser=true`. Retrieved WhatsApp messages are explicitly treated as untrusted data and cannot authorize an outbound send.

## Account roles

### INPUT

An input account can:

- sync WhatsApp history;
- receive realtime messages;
- store messages locally;
- expose those messages to Codex search.

It **cannot send messages through this bridge**.

### OUTPUT

The single output account can:

- send text requested by Codex;
- keep a local outbound audit log.

It does **not** sync or expose inbound/history messages to the searchable archive.

This separation is intentional. A normal personal input account cannot accidentally become Codex's sending identity.

## Local data

Runtime data lives in `.data/` by default:

```text
.data/
├── accounts.json
├── chats.json
├── auth/
├── messages/
└── outbound.jsonl
```

`.data/` is excluded from Git. Baileys linked-device credentials inside `.data/auth/` are sensitive and should be protected like account credentials.

Override the location with:

```text
NEXO_WHATSAPP_DATA_DIR=D:\private\whatsapp-codex-nexo
```

Other variables:

```text
NEXO_WHATSAPP_HOST=127.0.0.1
NEXO_WHATSAPP_PORT=3210
NEXO_WHATSAPP_MAX_SEARCH_RESULTS=80
```

The HTTP daemon intentionally binds to loopback by default. Do not expose it directly to the internet.

## Storage note

v0.1 uses JSONL deliberately: it is transparent, easy to debug and avoids adding a database just to validate the architecture. If archive size makes streaming search noticeably slow, the next storage step should be SQLite/FTS without changing the MCP contract.

## Next likely steps

1. contact/JID normalization across WhatsApp LID/PN identifiers;
2. better conversation/contact discovery;
3. reply-to-message support;
4. media metadata and optional attachment retrieval;
5. controlled proactive outbound policy, separate from user-confirmed sends;
6. SQLite FTS when archive size justifies it.

Baileys is an unofficial WhatsApp integration. Do not use this bridge for spam or bulk messaging.
