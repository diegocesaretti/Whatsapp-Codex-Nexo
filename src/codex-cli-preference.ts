import {
  discoverDesktopCodexBundles,
  queryCodexAppxPackages,
  type CodexAppxPackage,
  type CodexDesktopBundle,
} from "./codex-cli.js";

export function preferredOfficialCodexPath(input: {
  explicit?: string;
  desktopBundles?: CodexDesktopBundle[];
  appxPackages?: CodexAppxPackage[];
}): string | undefined {
  const explicit = input.explicit?.trim();
  if (explicit) return explicit;
  const desktop = input.desktopBundles?.find((bundle) => bundle.complete && bundle.cliPath);
  if (desktop?.cliPath) return desktop.cliPath;
  const appx = input.appxPackages?.find((pkg) =>
    Boolean(pkg.cliPath && pkg.codeModeHostPath && pkg.sandboxSetupPath && pkg.commandRunnerPath),
  );
  return appx?.cliPath;
}

export async function preferOfficialCodexCliOnWindows(env: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
  if (process.platform !== "win32") return env.NEXO_CODEX_PATH?.trim() || undefined;
  const explicit = env.NEXO_CODEX_PATH?.trim();
  if (explicit) return explicit;

  const desktopBundles = await discoverDesktopCodexBundles(env);
  const appxPackages = await queryCodexAppxPackages();
  const preferred = preferredOfficialCodexPath({ desktopBundles, appxPackages });
  if (!preferred) return undefined;

  // Make the official app/desktop bundle an explicit resolver candidate. This avoids
  // an older global npm/WinGet PATH shim winning simply because it appears earlier.
  env.NEXO_CODEX_PATH = preferred;
  return preferred;
}
