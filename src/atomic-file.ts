import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const WINDOWS_REPLACE_ERRORS = new Set(["EPERM", "EACCES", "EBUSY", "EEXIST", "ENOTEMPTY"]);

function fsCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : undefined;
}

export function isRetryableWindowsReplaceError(error: unknown): boolean {
  return WINDOWS_REPLACE_ERRORS.has(fsCode(error) ?? "");
}

async function delay(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export async function writeTextAtomic(
  path: string,
  content: string,
  options: {
    renameFile?: typeof rename;
    writeText?: typeof writeFile;
    removeFile?: typeof rm;
    wait?: (ms: number) => Promise<void>;
  } = {},
): Promise<void> {
  const renameFile = options.renameFile ?? rename;
  const writeText = options.writeText ?? writeFile;
  const removeFile = options.removeFile ?? rm;
  const wait = options.wait ?? delay;
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  await writeText(temporary, content, "utf8");

  try {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        await renameFile(temporary, path);
        return;
      } catch (error) {
        if (!isRetryableWindowsReplaceError(error)) throw error;
        if (attempt < 5) await wait(20 * 2 ** attempt);
      }
    }

    // Windows antivirus/indexing can briefly deny replacement of an existing file.
    // If every atomic replacement attempt is rejected, prefer a serialized direct
    // overwrite over losing account/settings state entirely.
    await writeText(path, content, "utf8");
  } finally {
    await removeFile(temporary, { force: true }).catch(() => undefined);
  }
}
