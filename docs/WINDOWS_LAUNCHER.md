# Windows launcher and Neon startup recovery

Nexo 0.5.1 includes a desktop launcher and transient startup retry behavior intended for a resident Windows installation.

## Desktop shortcut

Create or repair the current user's desktop shortcut with:

```powershell
pnpm shortcut
```

This creates `Nexo.lnk` on the Windows desktop. The shortcut runs `scripts/windows/nexo-open.ps1` rather than pointing directly at the browser.

On double click it:

1. checks `http://127.0.0.1:3210/health`;
2. opens the dashboard immediately when Nexo is healthy;
3. otherwise starts/recovers the tray host;
4. waits for the daemon to become healthy;
5. opens the dashboard when ready;
6. if startup is still waiting on network/Neon, leaves Nexo running and shows a diagnostic message with the local log path.

The tray menu also contains **Crear / reparar acceso directo**.

Useful commands:

```powershell
pnpm open
pnpm tray
pnpm shortcut
```

The tray host is protected by a named Windows mutex so repeated launcher clicks do not create multiple tray icons. It also checks the saved daemon PID before starting another daemon and performs a lightweight watchdog check every 10 seconds.

## Neon / DNS startup retry

If Nexo is configured for Neon and startup fails with a transient network/DNS condition, the process no longer exits immediately. Examples include:

```text
getaddrinfo ENOTFOUND ...neon.tech
EAI_AGAIN
ECONNREFUSED
ECONNRESET
ETIMEDOUT
ENETUNREACH
EHOSTUNREACH
```

The startup backoff is:

```text
2s -> 5s -> 10s -> 30s -> 60s -> 60s ...
```

Nexo keeps retrying while the failure is classified as transient. Once DNS/network access recovers, startup continues automatically.

Configuration failures are deliberately not retried forever. Missing database schemas, authentication/password errors and other non-network failures still surface immediately so an actual setup problem is not hidden.

Runtime log when launched from the tray:

```text
.data/nexo-tray.log
```
