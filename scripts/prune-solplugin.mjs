import { readdir, rm, stat } from "node:fs/promises";
import { basename, join } from "node:path";

const root = process.argv[2];
if (!root) {
  throw new Error("Usage: node scripts/prune-solplugin.mjs <node_modules-dir>");
}

const removableDirectoryNames = new Set([
  "test",
  "tests",
  "__tests__",
  "doc",
  "docs",
  "example",
  "examples",
  "coverage",
  "benchmark",
  "benchmarks",
]);

const removableDocPrefixes = [
  "readme",
  "changelog",
  "changes",
  "history",
  "authors",
  "contributors",
];

function isLicenseFile(name) {
  const lower = name.toLowerCase();
  return lower.startsWith("license") || lower.startsWith("licence");
}

function isRemovableFile(path) {
  const name = basename(path).toLowerCase();
  if (isLicenseFile(name)) return false;
  if (name.endsWith(".d.ts") || name.endsWith(".map") || name.endsWith(".md") || name.endsWith(".markdown")) return true;
  if (removableDocPrefixes.some((prefix) => name.startsWith(prefix))) return true;
  if (/\.(test|spec)\.[cm]?[jt]s$/.test(name)) return true;
  return false;
}

let removedFiles = 0;
let removedDirectories = 0;

async function prune(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (removableDirectoryNames.has(entry.name.toLowerCase())) {
        await rm(path, { recursive: true, force: true });
        removedDirectories++;
        continue;
      }
      await prune(path);
      if ((await readdir(path)).length === 0) {
        await rm(path, { recursive: true, force: true });
        removedDirectories++;
      }
      continue;
    }
    if (entry.isFile() && isRemovableFile(path)) {
      await rm(path, { force: true });
      removedFiles++;
    }
  }
}

await stat(root);
await prune(root);
console.log(`Pruned ${removedFiles} non-runtime files and ${removedDirectories} empty/non-runtime directories from SOL plugin dependencies.`);
