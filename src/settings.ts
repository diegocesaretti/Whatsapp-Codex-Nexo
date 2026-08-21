import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const AUTOSTART_VALUE = "WhatsappCodexNexo";
const AUTOSTART_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";

export interface AppSettings {
  autoConnectLinkedAccounts: boolean;
  openDashboardOnLaunch: boolean;
  uiRefreshMs: number;
  maxSearchResults: number;
}

const defaults: AppSettings = {
  autoConnectLinkedAccounts: true,
  openDashboardOnLaunch: true,
  uiRefreshMs: 1500,
  maxSearchResults: 80,
};

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

export class AppSettingsStore {
  private readonly path: string;

  constructor(dataDir: string) {
    this.path = resolve(dataDir, "settings.json");
  }

  async get(): Promise<AppSettings> {
    try {
      const parsed = JSON.parse(await readFile(this.path, "utf8")) as Partial<AppSettings>;
      return this.normalize(parsed);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ...defaults };
      throw error;
    }
  }

  async update(patch: Partial<AppSettings>): Promise<AppSettings> {
    const next = this.normalize({ ...(await this.get()), ...patch });
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    return next;
  }

  private normalize(value: Partial<AppSettings>): AppSettings {
    return {
      autoConnectLinkedAccounts: value.autoConnectLinkedAccounts !== false,
      openDashboardOnLaunch: value.openDashboardOnLaunch !== false,
      uiRefreshMs: clampInt(value.uiRefreshMs, 500, 10_000, defaults.uiRefreshMs),
      maxSearchResults: clampInt(value.maxSearchResults, 10, 200, defaults.maxSearchResults),
    };
  }
}

export async function getWindowsAutostart(): Promise<boolean> {
  if (process.platform !== "win32") return false;
  try {
    const { stdout } = await execFileAsync("reg.exe", ["query", AUTOSTART_KEY, "/v", AUTOSTART_VALUE], { windowsHide: true });
    return stdout.includes(AUTOSTART_VALUE);
  } catch {
    return false;
  }
}

export async function setWindowsAutostart(enabled: boolean): Promise<boolean> {
  if (process.platform !== "win32") throw new Error("Windows autostart is only available on Windows");
  if (enabled) {
    const script = resolve(process.cwd(), "scripts", "windows", "nexo-tray.ps1");
    const command = `powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File \"${script}\"`;
    await execFileAsync("reg.exe", ["add", AUTOSTART_KEY, "/v", AUTOSTART_VALUE, "/t", "REG_SZ", "/d", command, "/f"], { windowsHide: true });
  } else {
    await execFileAsync("reg.exe", ["delete", AUTOSTART_KEY, "/v", AUTOSTART_VALUE, "/f"], { windowsHide: true }).catch(() => undefined);
  }
  return getWindowsAutostart();
}
