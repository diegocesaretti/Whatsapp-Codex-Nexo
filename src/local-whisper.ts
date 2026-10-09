import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface LocalSpeechResult {
  text: string;
  provider: string;
  model: string;
}

export async function transcribeWithLocalWhisper(audioPath: string, timeoutMs: number): Promise<LocalSpeechResult> {
  const python = process.env.NEXO_LOCAL_STT_PYTHON?.trim() ||
    join(process.env.LOCALAPPDATA || "", "SOL", "plugin-data", "nexo-whatsapp", "stt-venv", "Scripts", "python.exe");
  const script = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "local-whisper.py");
  if (!existsSync(python) || !existsSync(script)) throw new Error("local_whisper_not_installed");
  return await new Promise((resolve, reject) => {
    const child = spawn(python, [script, audioPath], {
      windowsHide: true,
      env: { ...process.env, NEXO_LOCAL_STT_LANGUAGE: process.env.NEXO_LOCAL_STT_LANGUAGE || "es" },
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (error?: Error, value?: LocalSpeechResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else if (value) resolve(value);
      else reject(new Error("local_whisper_missing_result"));
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error("local_whisper_timeout"));
    }, Math.max(20_000, timeoutMs));
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout = (stdout + chunk).slice(-90_000); });
    child.stderr.on("data", (chunk: string) => { stderr = (stderr + chunk).slice(-6_000); });
    child.on("error", (err) => finish(err));
    child.on("close", (code) => {
      if (settled) return;
      if (code !== 0) return finish(new Error("local_whisper_failed: " + stderr.slice(-1000)));
      try {
        const parsed = JSON.parse(stdout.trim()) as LocalSpeechResult;
        if (!parsed.text?.trim() || parsed.provider !== "local") throw new Error("invalid_transcript");
        finish(undefined, parsed);
      } catch (err) { finish(err instanceof Error ? err : new Error(String(err))); }
    });
  });
}
