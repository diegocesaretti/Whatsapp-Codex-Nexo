const TRANSIENT_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "EPIPE",
]);

const DEFAULT_DELAYS_MS = [2_000, 5_000, 10_000, 30_000, 60_000];

function errorObjects(error: unknown): unknown[] {
  const result: unknown[] = [];
  const queue: unknown[] = [error];
  const seen = new Set<unknown>();
  while (queue.length) {
    const current = queue.shift();
    if (current === undefined || current === null || seen.has(current)) continue;
    seen.add(current);
    result.push(current);
    if (typeof current !== "object") continue;
    const value = current as { cause?: unknown; errors?: unknown[] };
    if (value.cause !== undefined) queue.push(value.cause);
    if (Array.isArray(value.errors)) queue.push(...value.errors);
  }
  return result;
}

export function transientStartupCode(error: unknown): string | undefined {
  for (const current of errorObjects(error)) {
    if (!current || typeof current !== "object") continue;
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && TRANSIENT_CODES.has(code.toUpperCase())) return code.toUpperCase();
  }
  const text = errorObjects(error)
    .map((current) => current instanceof Error ? `${current.name}: ${current.message}` : String(current))
    .join(" ")
    .toUpperCase();
  for (const code of TRANSIENT_CODES) {
    if (text.includes(code)) return code;
  }
  if (text.includes("GETADDRINFO") && text.includes("NOT FOUND")) return "ENOTFOUND";
  if (text.includes("CONNECTION TERMINATED UNEXPECTEDLY")) return "ECONNRESET";
  return undefined;
}

export function isTransientStartupError(error: unknown): boolean {
  return Boolean(transientStartupCode(error));
}

export function startupRetryDelayMs(attempt: number, delays = DEFAULT_DELAYS_MS): number {
  const normalized = Math.max(1, Math.trunc(attempt));
  return delays[Math.min(normalized - 1, delays.length - 1)] ?? 60_000;
}

function message(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export async function retryTransientStartup<T>(
  label: string,
  operation: () => Promise<T>,
  options: {
    delaysMs?: number[];
    sleep?: (ms: number) => Promise<void>;
    maxAttempts?: number;
    log?: (line: string) => void;
  } = {},
): Promise<T> {
  const delays = options.delaysMs?.length ? options.delaysMs : DEFAULT_DELAYS_MS;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const log = options.log ?? ((line: string) => console.warn(line));
  let failures = 0;

  for (;;) {
    try {
      const result = await operation();
      if (failures) log(`[startup] ${label} recovered after ${failures} transient failure(s).`);
      return result;
    } catch (error) {
      const code = transientStartupCode(error);
      if (!code) throw error;
      failures += 1;
      if (options.maxAttempts !== undefined && failures >= options.maxAttempts) throw error;
      const delayMs = startupRetryDelayMs(failures, delays);
      log(`[startup] ${label} unavailable (${code}: ${message(error)}). Retrying in ${Math.round(delayMs / 1000)}s; Nexo stays alive.`);
      await sleep(delayMs);
    }
  }
}
