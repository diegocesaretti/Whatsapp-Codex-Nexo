import { readFile, writeFile } from "node:fs/promises";

async function patch(path, transforms) {
  let text = await readFile(path, "utf8");
  let changed = false;
  for (const [from, to] of transforms) {
    if (text.includes(to)) continue;
    if (!text.includes(from)) throw new Error(`Patch anchor not found in ${path}: ${from.slice(0, 120)}`);
    text = text.replace(from, to);
    changed = true;
  }
  if (changed) await writeFile(path, text, "utf8");
}

await patch("src/config.ts", [
  [
    '  dataDir: resolve(process.env.NEXO_WHATSAPP_DATA_DIR?.trim() || ".data"),',
    '  dataDir: resolve(process.env.NEXO_WHATSAPP_DATA_DIR?.trim() || process.env.SOL_PLUGIN_DATA_DIR?.trim() || ".data"),',
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
    '    if (!account) throw new Error("WhatsApp account not found");\n    if (!account.enabled) throw new Error("WhatsApp account is disabled");\n\n    let runtime',
    '    if (!account) throw new Error("WhatsApp account not found");\n    if (!account.enabled) throw new Error("WhatsApp account is disabled");\n    if (account.role === "input") {\n      await this.solPlugin?.ensureInput(account).catch((error) => {\n        this.solPlugin?.log("warn", `Could not register WhatsApp input ${account.label}: ${error instanceof Error ? error.message : String(error)}`);\n      });\n    }\n\n    let runtime',
  ],
  [
    '        }).catch((error) => console.error(`[whatsapp:${account.id}] account state update failed`, error));\n      }\n      if (update.connection === "close") {',
    '        }).catch((error) => console.error(`[whatsapp:${account.id}] account state update failed`, error));\n        if (account.role === "input") {\n          void this.solPlugin?.setStatus(account, "connected", new Date().toISOString()).catch((error) => {\n            this.solPlugin?.log("warn", `Could not mark ${account.label} connected in SOL: ${error instanceof Error ? error.message : String(error)}`);\n          });\n        }\n      }\n      if (update.connection === "close") {\n        if (account.role === "input") {\n          void this.solPlugin?.setStatus(account, "disconnected").catch(() => undefined);\n        }',
  ],
  [
    '    if (await this.store.appendMessage(stored)) {\n      runtime.storedMessages += 1;\n      runtime.updatedAt = new Date();\n    }\n  }',
    '    if (await this.store.appendMessage(stored)) {\n      runtime.storedMessages += 1;\n      runtime.updatedAt = new Date();\n    }\n    await this.solPlugin?.ingestWhatsappMessage(account, stored).catch((error) => {\n      this.solPlugin?.log("warn", `SOL ingestion failed for ${account.label}: ${error instanceof Error ? error.message : String(error)}`);\n    });\n  }',
  ],
  [
    '    runtime.state = "idle";\n    runtime.updatedAt = new Date();\n  }\n}',
    '    runtime.state = "idle";\n    runtime.updatedAt = new Date();\n    await this.solPlugin?.setDisconnectedByAccountId(runtime.accountId).catch(() => undefined);\n  }\n}',
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

console.log("Nexo SOL input plugin integration applied");
