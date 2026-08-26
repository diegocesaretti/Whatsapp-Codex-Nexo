# Nexo 0.7.5 Codex bundle compatibility fix

Nexo 0.7.5 removes the unsupported `--color never` argument from `codex exec` and tightens Windows Codex discovery so the resident WhatsApp worker only accepts a complete native bundle.

A valid Windows bundle contains these four executables in the same directory:

- `codex.exe`
- `codex-code-mode-host.exe`
- `codex-command-runner.exe`
- `codex-windows-sandbox-setup.exe`

Discovery order on Windows:

1. `NEXO_CODEX_PATH`
2. current `PATH`
3. `%LOCALAPPDATA%\OpenAI\Codex\bin\<version>`
4. `%APPDATA%\npm`
5. WinGet
6. Scoop
7. `%USERPROFILE%\.local\bin`
8. Microsoft Store / AppX compatibility fallback

Incomplete candidates are reported in diagnostics and skipped while Nexo continues looking for a complete bundle. The worker status exposes `bundleDir`, `codeModeHostPath`, `codeModeHostAvailable`, `toolsAvailable`, command-runner and sandbox paths, and missing bundle files.
