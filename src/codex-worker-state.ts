import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

interface SessionRecord {
  threadId: string;
  updatedAt: string;
}

interface StateFile {
  version: 1;
  sessions: Record<string, SessionRecord>;
}

const emptyState = (): StateFile => ({ version: 1, sessions: {} });

export class CodexWorkerStateStore {
  private readonly path: string;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(dataDir: string) {
    this.path = resolve(dataDir, "codex-worker-sessions.json");
  }

  private async read(): Promise<StateFile> {
    try {
      const parsed = JSON.parse(await readFile(this.path, "utf8")) as StateFile;
      return parsed?.version === 1 && parsed.sessions ? parsed : emptyState();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyState();
      throw error;
    }
  }

  async getThreadId(peerPhone: string): Promise<string | undefined> {
    return (await this.read()).sessions[peerPhone]?.threadId;
  }

  async setThreadId(peerPhone: string, threadId: string): Promise<void> {
    const task = async () => {
      const state = await this.read();
      state.sessions[peerPhone] = { threadId, updatedAt: new Date().toISOString() };
      await mkdir(dirname(this.path), { recursive: true });
      const temp = `${this.path}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
      await rename(temp, this.path);
    };
    const run = this.chain.then(task, task);
    this.chain = run.then(() => undefined, () => undefined);
    await run;
  }

  async count(): Promise<number> {
    return Object.keys((await this.read()).sessions).length;
  }
}
