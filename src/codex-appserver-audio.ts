import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { basename, dirname, extname, resolve } from "node:path";
import { environmentWithCodexPath } from "./codex-cli.js";

const CODEX_TRANSCRIBE_ENDPOINT = "https://chatgpt.com/backend-api/transcribe";
const SUPPORTED_AUDIO_EXTENSIONS = new Set([".wav", ".mp3", ".m4a", ".mp4", ".webm", ".ogg", ".oga", ".flac"]);

export interface CodexOAuthAudioResult {
  text: string;
  model: string;
  provider: "codex-oauth";
}

export interface CodexOAuthAudioOptions {
  cliPath: string;
  audioPath: string;
  timeoutMs: number;
  cwd?: string;
  language?: string;
  model?: string;
}

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface CodexAuthStatus {
  authMethod?: unknown;
  authToken?: unknown;
  requiresOpenaiAuth?: unknown;
}

export function codexSupportsLocalAudioPath(path: string): boolean {
  return SUPPORTED_AUDIO_EXTENSIONS.has(extname(path).toLowerCase());
}

export function isCodexChatGptOAuthAccount(result: unknown): boolean {
  if (!result || typeof result !== "object") return false;
  const account = (result as { account?: unknown }).account;
  if (!account || typeof account !== "object") return false;
  return String((account as { type?: unknown }).type ?? "").toLowerCase() === "chatgpt";
}

export function inferCodexTranscriptionMime(path: string): string {
  switch (extname(path).toLowerCase()) {
    case ".wav": return "audio/wav";
    case ".mp3": return "audio/mpeg";
    case ".m4a":
    case ".mp4": return "audio/mp4";
    case ".webm": return "audio/webm";
    case ".ogg":
    case ".oga": return "audio/ogg";
    case ".flac": return "audio/flac";
    default: return "application/octet-stream";
  }
}

export function accountIdFromAccessToken(token: string): string | undefined {
  const raw = token.trim().replace(/^Bearer\s+/i, "");
  const payload = raw.split(".")[1];
  if (!payload) return undefined;
  try {
    const body = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
    const auth = body["https://api.openai.com/auth"];
    if (!auth || typeof auth !== "object") return undefined;
    const accountId = (auth as Record<string, unknown>).chatgpt_account_id;
    return typeof accountId === "string" && accountId.trim() ? accountId.trim() : undefined;
  } catch {
    return undefined;
  }
}

export function authTokenFromStatus(result: unknown): string | undefined {
  if (!result || typeof result !== "object") return undefined;
  const status = result as CodexAuthStatus;
  if (String(status.authMethod ?? "").toLowerCase() !== "chatgpt") return undefined;
  return typeof status.authToken === "string" && status.authToken.trim()
    ? status.authToken.trim().replace(/^Bearer\s+/i, "")
    : undefined;
}

function clippedBackendError(raw: string): string {
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text) return "empty response";
  return text.length <= 500 ? text : `${text.slice(0, 500)}…`;
}

class CodexAppServerClient {
  private child?: ChildProcessWithoutNullStreams;
  private nextId = 0;
  private readonly pending = new Map<string, PendingRequest>();
  private stderrTail = "";
  private closedError?: Error;

  constructor(
    private readonly cliPath: string,
    private readonly cwd: string,
    private readonly operationTimeoutMs: number,
  ) {}

  start(): void {
    if (this.child) return;
    const child = spawn(this.cliPath, ["app-server", "--listen", "stdio://"], {
      cwd: this.cwd,
      windowsHide: true,
      env: environmentWithCodexPath(this.cliPath),
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on("line", (line) => this.handleLine(line));
    child.stderr.on("data", (chunk: string) => {
      this.stderrTail = (this.stderrTail + chunk).slice(-12_000);
    });
    child.on("error", (error) => this.failAll(new Error(`Could not start Codex app-server: ${error.message}`)));
    child.on("close", (code) => {
      if (this.closedError) return;
      const detail = this.stderrTail.trim();
      this.failAll(new Error(`Codex app-server exited with code ${code ?? "unknown"}${detail ? `: ${detail.slice(-4000)}` : ""}`));
    });
  }

  async initialize(): Promise<void> {
    await this.request("initialize", {
      clientInfo: { name: "whatsapp-codex-nexo", title: "Nexo · WhatsApp", version: "0.11.1" },
      capabilities: { experimentalApi: false },
    });
    this.notify("initialized", {});
  }

  async request(method: string, params?: Record<string, unknown>, timeoutMs = 30_000): Promise<any> {
    if (this.closedError) throw this.closedError;
    const child = this.child;
    if (!child?.stdin.writable) throw new Error("Codex app-server stdin is not writable");
    const id = String(++this.nextId);
    return new Promise<any>((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectPromise(new Error(`Codex app-server request ${method} timed out`));
      }, Math.max(1000, Math.min(timeoutMs, this.operationTimeoutMs)));
      timer.unref?.();
      this.pending.set(id, { resolve: resolvePromise, reject: rejectPromise, timer });
      try {
        child.stdin.write(`${JSON.stringify({ id, method, ...(params === undefined ? {} : { params }) })}\n`, "utf8");
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        rejectPromise(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  notify(method: string, params?: Record<string, unknown>): void {
    const child = this.child;
    if (!child?.stdin.writable) throw new Error("Codex app-server stdin is not writable");
    child.stdin.write(`${JSON.stringify({ method, ...(params === undefined ? {} : { params }) })}\n`, "utf8");
  }

  close(): void {
    const child = this.child;
    this.child = undefined;
    this.closedError = new Error("Codex app-server closed");
    if (!child) return;
    try { child.stdin.end(); } catch {}
    try { child.kill(); } catch {}
  }

  private handleLine(line: string): void {
    const raw = line.trim();
    if (!raw.startsWith("{")) return;
    let message: any;
    try { message = JSON.parse(raw); } catch { return; }
    if (!message || message.id === undefined) return;

    const id = String(message.id);
    const pending = this.pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(id);
    if (message.error) {
      const text = typeof message.error?.message === "string" ? message.error.message : JSON.stringify(message.error);
      pending.reject(new Error(`Codex app-server: ${text}`));
    } else {
      pending.resolve(message.result);
    }
  }

  private failAll(error: Error): void {
    if (this.closedError) return;
    this.closedError = error;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

async function transcribeThroughCodexBackend(
  audioPath: string,
  accessToken: string,
  language: string | undefined,
  timeoutMs: number,
): Promise<string> {
  const bytes = await readFile(audioPath);
  if (bytes.length === 0) throw new Error("codex_oauth_transcribe_empty_audio");

  const mime = inferCodexTranscriptionMime(audioPath);
  if (mime === "application/octet-stream") {
    throw new Error(`codex_oauth_transcribe_unsupported:${extname(audioPath).toLowerCase() || "no_extension"}`);
  }

  const form = new FormData();
  form.set("file", new Blob([bytes], { type: mime }), basename(audioPath));
  if (language?.trim()) form.set("language", language.trim());

  const accountId = accountIdFromAccessToken(accessToken);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    originator: "Codex Desktop",
    "User-Agent": `Nexo/0.11.1 (${process.platform}; ${process.arch})`,
  };
  if (accountId) headers["ChatGPT-Account-Id"] = accountId;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(15_000, timeoutMs));
  timer.unref?.();
  try {
    const response = await fetch(CODEX_TRANSCRIBE_ENDPOINT, {
      method: "POST",
      headers,
      body: form,
      signal: controller.signal,
    });
    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`codex_oauth_transcribe_http_${response.status}:${clippedBackendError(raw)}`);
    }
    let parsed: { text?: unknown };
    try {
      parsed = JSON.parse(raw) as { text?: unknown };
    } catch {
      throw new Error("codex_oauth_transcribe_invalid_json");
    }
    const text = typeof parsed.text === "string" ? parsed.text.trim() : "";
    if (!text) throw new Error("codex_oauth_transcribe_empty_text");
    return text;
  } finally {
    clearTimeout(timer);
  }
}

export async function transcribeLocalAudioWithCodexOAuth(options: CodexOAuthAudioOptions): Promise<CodexOAuthAudioResult> {
  const audioPath = resolve(options.audioPath);
  if (!codexSupportsLocalAudioPath(audioPath)) {
    throw new Error(`codex_oauth_transcribe_unsupported:${extname(audioPath).toLowerCase() || "no_extension"}`);
  }

  const cwd = resolve(options.cwd?.trim() || dirname(audioPath));
  const client = new CodexAppServerClient(options.cliPath, cwd, Math.max(15_000, options.timeoutMs));
  client.start();
  try {
    await client.initialize();

    // account/read is the non-secret authority that this local Codex process is really
    // authenticated as a ChatGPT account. Nexo never opens or parses auth.json.
    const account = await client.request("account/read", { refreshToken: true });
    if (!isCodexChatGptOAuthAccount(account)) {
      const accountType = account && typeof account === "object" && (account as any).account?.type
        ? String((account as any).account.type)
        : "none";
      throw new Error(`codex_chatgpt_oauth_required:account_type=${accountType}`);
    }

    // getAuthStatus is the same app-server auth surface used by Codex frontends when
    // an authenticated backend request needs a bearer. The token exists only in this
    // function's memory and is never persisted or logged by Nexo.
    const authStatus = await client.request("getAuthStatus", { includeToken: true, refreshToken: true });
    const accessToken = authTokenFromStatus(authStatus);
    if (!accessToken) throw new Error("codex_chatgpt_oauth_token_unavailable");

    const text = await transcribeThroughCodexBackend(audioPath, accessToken, options.language, options.timeoutMs);
    return { text, model: "codex-dictation", provider: "codex-oauth" };
  } finally {
    client.close();
  }
}
