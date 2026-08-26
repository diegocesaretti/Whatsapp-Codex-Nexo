# Resident Codex WhatsApp worker

Nexo v0.7.3 can turn the authorized OUTPUT conversation into a resident remote interface for the locally authenticated Codex CLI.

## Flow

```text
authorized direct WhatsApp message
  -> OUTPUT account
  -> Nexo allowlist validation
  -> pending OUTPUT conversation row
  -> resident Codex worker
  -> `codex exec` / `codex exec resume`
  -> Codex tools + configured MCPs
  -> final agent text
  -> Nexo sends reply to the exact authorized peer
```

The worker is part of the Nexo daemon. It does not require a separate terminal once Nexo is running from `pnpm start`, `pnpm dev`, or the Windows desktop app.

## Authentication

The worker does **not** use an OpenAI API key. It launches the locally installed/authenticated Codex CLI under the same Windows/user account as Nexo, so Codex uses the existing login/session and the normal `~/.codex/config.toml` configuration.

Run this once in a terminal if the machine has never authenticated Codex:

```powershell
codex login
```

The Nexo MCP should remain configured in Codex so a WhatsApp turn can search/summarize INPUT WhatsApp when needed.

## Windows Codex Desktop bundles

The official Codex Windows app keeps per-version native binaries in paths such as:

```text
%LOCALAPPDATA%\OpenAI\Codex\bin\<version-hash>\codex.exe
%LOCALAPPDATA%\OpenAI\Codex\bin\<version-hash>\codex-code-mode-host.exe
```

Some builds also expose an app-server plugin bundle at:

```text
%USERPROFILE%\.codex\plugins\.plugin-appserver\
```

Nexo scans both locations and prefers a **complete bundle** containing both `codex.exe` and `codex-code-mode-host.exe`. It does not hard-code the version hash because that directory changes when Codex updates.

When a complete native bundle is selected, the worker prepends its directory to its child PATH and exports:

```text
CODEX_CLI_PATH=<selected codex.exe>
CODEX_CODE_MODE_HOST_PATH=<matching codex-code-mode-host.exe>
```

This matters because a standalone `codex.exe` can still answer normal text while local Code Mode/tool calls fail if its matching host executable cannot be resolved. The admin UI shows both resolved paths.

`NEXO_CODEX_PATH` remains supported as an explicit override. If it points into an incomplete stale Codex Desktop cache directory, Nexo is allowed to select a newer complete official bundle instead.

## Conversation continuity

Nexo stores one Codex `thread_id` per authorized phone number in:

```text
.data/codex-worker-sessions.json
```

The first message starts `codex exec`; later messages use `codex exec resume <thread_id>`. The state is deliberately local because the Codex authentication/session files are local too.

Nexo also includes recent isolated OUTPUT conversation history in every turn as fallback context. If Codex ever replaces a missing/stale session with a new thread, Nexo records the newly returned `thread_id`.

## Settings

Admin UI → **Codex resident worker**:

- `responder automáticamente`: master enable switch;
- polling interval: how often Nexo checks for pending authorized replies;
- debounce: short window used to group multiple quick WhatsApp messages into one turn;
- timeout: maximum Codex CLI execution time;
- maximum grouped messages;
- working directory: optional Codex working directory. Empty means Nexo's process directory.

The worker defaults to enabled, but it still does nothing unless the OUTPUT conversation channel itself is enabled and at least one phone number is explicitly allowlisted.

## Safety boundaries

- only currently allowlisted direct OUTPUT peers are consumed;
- the allowlist is re-read before every turn;
- groups and INPUT accounts never become authenticated instructions;
- Gmail, WhatsApp INPUT, MercadoLibre, web pages, files and other retrieved material remain untrusted evidence;
- the authenticated WhatsApp message is the human instruction for that turn;
- the worker tells Codex not to use WhatsApp send/reply MCP tools merely to deliver the final response, preventing duplicate delivery;
- the final response is sent by Nexo and bound to the same authorized peer;
- a failed Codex run is not acknowledged, so it can be retried with backoff.

## Diagnostics

The admin UI shows worker state, session count, last success, last error, selected Codex CLI and Code Mode host. The same information is available through:

```text
GET /api/codex-worker/status
```

and MCP:

```text
get_codex_whatsapp_worker_status
```

Typical failures:

- `Codex CLI no encontrado`: no usable Codex installation was discovered for the Windows account running Nexo;
- `bundle incompleto` / missing `codex-code-mode-host.exe`: the selected Codex Desktop cache only contains the CLI; update/restart Codex and use **Detectar nuevamente** so Nexo can select another complete bundle;
- authentication/login error: run `codex login` under that same account;
- timeout: increase the worker timeout, or reduce the work requested in one WhatsApp turn;
- MCP unavailable inside Codex: first verify that the UI reports both Codex CLI and Code Mode host as ready, then verify the global Codex MCP configuration still points to Nexo.
