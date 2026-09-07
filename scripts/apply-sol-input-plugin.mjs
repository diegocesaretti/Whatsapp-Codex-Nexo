import { readFile, writeFile, rm } from "node:fs/promises";

async function patch(path, transforms) {
  let text = await readFile(path, "utf8");
  let changed = false;
  for (const [from, to] of transforms) {
    if (text.includes(to)) continue;
    if (!text.includes(from)) throw new Error(`Patch anchor not found in ${path}: ${from.slice(0, 140)}`);
    text = text.replace(from, to);
    changed = true;
  }
  if (changed) await writeFile(path, text, "utf8");
}

await patch("src/config.ts", [
  [
    "const database = discoverDatabaseUrl();",
    'const pluginRuntime = Boolean(process.env.SOL_PLUGIN_TOKEN?.trim());\nconst database: DatabaseDiscovery = pluginRuntime ? { source: "none" } : discoverDatabaseUrl();',
  ],
  [
    '  dataDir: resolve(process.env.NEXO_WHATSAPP_DATA_DIR?.trim() || ".data"),',
    '  dataDir: resolve(process.env.SOL_PLUGIN_DATA_DIR?.trim() || process.env.NEXO_WHATSAPP_DATA_DIR?.trim() || ".data"),',
  ],
]);

await patch("src/sol-plugin-client.ts", [
  [
    "      externalAccountId: account.id,",
    "      externalAccountId: account.phoneJid?.trim() || account.id,",
  ],
  [
    "  ): Promise<void> {\n    const sourceAccountId = await this.ensureInput(account);",
    "  ): Promise<void> {\n    if (!this.sourceAccounts.has(account.id) && !account.phoneJid?.trim() && status !== \"connected\") return;\n    const sourceAccountId = await this.ensureInput(account);",
  ],
]);

await patch("src/whatsapp-manager.ts", [
  [
    'import { AppSettingsStore } from "./settings.js";\n',
    'import { AppSettingsStore } from "./settings.js";\nimport { SolPluginClient } from "./sol-plugin-client.js";\n',
  ],
  [
    '    private readonly conversationStore?: OutputConversationStore,\n  ) {}',
    '    private readonly conversationStore?: OutputConversationStore,\n    private readonly solPlugin?: SolPluginClient,\n  ) {}',
  ],
  [
    '        }).catch((error) => console.error(`[whatsapp:${account.id}] account state update failed`, error));\n      }\n      if (update.connection === "close") {',
    '        }).catch((error) => console.error(`[whatsapp:${account.id}] account state update failed`, error));\n        if (account.role === "input" && this.solPlugin) {\n          const linkedAccount = {\n            ...account,\n            phoneJid: socket.user?.id ?? account.phoneJid,\n            displayName: socket.user?.name ?? account.displayName,\n          };\n          void this.solPlugin.setStatus(linkedAccount, "connected", new Date().toISOString()).catch((error) => {\n            this.solPlugin?.log("warn", `Could not mark ${account.label} connected in SOL: ${error instanceof Error ? error.message : String(error)}`);\n          });\n        }\n      }\n      if (update.connection === "close") {\n        if (account.role === "input" && this.solPlugin) {\n          void this.solPlugin.setStatus(account, "disconnected").catch(() => undefined);\n        }',
  ],
  [
    '    if (await this.store.appendMessage(stored)) {\n      runtime.storedMessages += 1;\n      runtime.updatedAt = new Date();\n    }\n  }',
    '    if (await this.store.appendMessage(stored)) {\n      runtime.storedMessages += 1;\n      runtime.updatedAt = new Date();\n    }\n    if (this.solPlugin) {\n      const sourceAccount = { ...account, phoneJid: account.phoneJid ?? runtime.phoneJid };\n      await this.solPlugin.ingestWhatsappMessage(sourceAccount, stored).catch((error) => {\n        runtime.lastError = `SOL ingestion: ${error instanceof Error ? error.message : String(error)}`;\n        runtime.updatedAt = new Date();\n        this.solPlugin?.reportHealth("degraded", { accountId: account.id, reason: runtime.lastError });\n        this.solPlugin?.log("warn", `SOL ingestion failed for ${account.label}: ${runtime.lastError}`);\n      });\n    }\n  }',
  ],
  [
    '    runtime.state = "idle";\n    runtime.updatedAt = new Date();\n  }\n}',
    '    runtime.state = "idle";\n    runtime.updatedAt = new Date();\n    if (this.solPlugin) await this.solPlugin.setDisconnectedByAccountId(runtime.accountId).catch(() => undefined);\n  }\n}',
  ],
]);

await patch("src/index.ts", [
  [
    'import { retryTransientStartup } from "./startup-retry.js";\n',
    'import { retryTransientStartup } from "./startup-retry.js";\nimport { SolPluginClient } from "./sol-plugin-client.js";\n',
  ],
  [
    'const manager = new WhatsappManager(store, settingsStore, conversationStore);',
    'const solPlugin = new SolPluginClient();\nconst manager = new WhatsappManager(store, settingsStore, conversationStore, solPlugin);',
  ],
  [
    '  console.log("Multiple INPUT accounts are read-only; OUTPUT conversation replies and media are isolated from the searchable INPUT archive.");\n  void codexWorker.start()',
    '  console.log("Multiple INPUT accounts are read-only; OUTPUT conversation replies and media are isolated from the searchable INPUT archive.");\n  solPlugin.reportReady({ bridgeUrl: `http://${config.host}:${config.port}`, storage: store.storageMode, mode: "whatsapp" });\n  void codexWorker.start()',
  ],
]);

await patch("package.json", [
  ['  "version": "0.7.5",', '  "version": "0.8.0",'],
]);

await patch(".github/workflows/ci.yml", [
  [
    "      - run: pnpm typecheck\n",
    "      - run: pnpm typecheck\n      - run: pnpm build\n      - name: Verify SOL plugin package can be assembled\n        run: |\n          rm -rf .solplugin-stage Nexo.solplugin\n          mkdir -p .solplugin-stage\n          cp package.json sol-plugin.json .solplugin-stage/\n          cp -R dist .solplugin-stage/dist\n          cd .solplugin-stage\n          npm install --omit=dev --ignore-scripts --no-package-lock\n          zip -qry ../Nexo.solplugin .\n          cd ..\n          test -s Nexo.solplugin\n",
  ],
]);

await writeFile(".github/workflows/sol-plugin-release.yml", `name: SOL Plugin Release\n\non:\n  push:\n    branches: [main]\n    paths:\n      - src/**\n      - package.json\n      - sol-plugin.json\n      - .github/workflows/sol-plugin-release.yml\n  workflow_dispatch:\n\npermissions:\n  contents: write\n\njobs:\n  package:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 22\n      - run: corepack enable\n      - run: pnpm install\n      - run: pnpm test\n      - run: pnpm typecheck\n      - run: pnpm build\n      - name: Build Nexo.solplugin\n        run: |\n          rm -rf .solplugin-stage Nexo.solplugin\n          mkdir -p .solplugin-stage\n          cp package.json sol-plugin.json .solplugin-stage/\n          cp -R dist .solplugin-stage/dist\n          cd .solplugin-stage\n          npm install --omit=dev --ignore-scripts --no-package-lock\n          zip -qry ../Nexo.solplugin .\n          cd ..\n      - uses: actions/upload-artifact@v4\n        with:\n          name: Nexo.solplugin\n          path: Nexo.solplugin\n      - name: Publish rolling SOL plugin release\n        env:\n          GH_TOKEN: \${{ github.token }}\n        run: |\n          gh release delete sol-plugin-latest -y --cleanup-tag || true\n          gh release create sol-plugin-latest Nexo.solplugin --target \"$GITHUB_SHA\" --title \"Nexo · WhatsApp SOL plugin\" --notes \"Rolling SOL plugin package built from main.\"\n`, "utf8");

await rm("scripts/apply-sol-input-plugin.mjs", { force: true });
await rm(".github/workflows/apply-sol-input-plugin.yml", { force: true });
console.log("Nexo SOL input plugin integration applied");
