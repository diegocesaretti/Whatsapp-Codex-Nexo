import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { normalizeImportedPhone, type ParsedContact } from "./contact-import.js";

export interface WhatsappContactObservation {
  id?: string | null;
  name?: string | null;
  notify?: string | null;
  verifiedName?: string | null;
  phoneNumber?: string | null;
}

export interface WhatsappContact {
  accountId: string;
  jid: string;
  phone?: string;
  displayName?: string;
  savedName?: string;
  pushName?: string;
  verifiedName?: string;
  firstObservedAt: string;
  lastObservedAt: string;
  source: "history" | "realtime" | "import";
  sources?: Array<"history" | "realtime" | "import">;
  importedName?: string;
  importedAt?: string;
}

interface ContactsFile {
  version: 1;
  accounts: Record<string, Record<string, WhatsappContact>>;
}

const blank = (): ContactsFile => ({ version: 1, accounts: {} });

function keyForContact(contact: WhatsappContact): string {
  return contact.phone ? "tel:" + contact.phone : "jid:" + contact.jid;
}

function uniqueSources(...groups: Array<Array<WhatsappContact["source"]> | undefined>): Array<WhatsappContact["source"]> {
  return [...new Set(groups.flatMap(group => group ?? []))];
}

function mergeContact(previous: WhatsappContact | undefined, next: WhatsappContact): WhatsappContact {
  const merged: WhatsappContact = {
    ...previous, ...next,
    // Never regress a saved WhatsApp name when a notify-only update arrives.
    savedName: next.savedName ?? previous?.savedName,
    importedName: next.importedName ?? previous?.importedName,
    pushName: next.pushName ?? previous?.pushName,
    verifiedName: next.verifiedName ?? previous?.verifiedName,
    phone: next.phone ?? previous?.phone,
    jid: next.jid.startsWith("tel:") && previous?.jid ? previous.jid : next.jid,
    firstObservedAt: previous?.firstObservedAt ?? next.firstObservedAt,
    sources: uniqueSources(previous?.sources ?? (previous ? [previous.source] : []), next.sources ?? [next.source]),
    importedAt: next.importedAt ?? previous?.importedAt,
  };
  merged.displayName = merged.savedName ?? merged.importedName ?? merged.verifiedName ?? merged.pushName ?? previous?.displayName;
  return merged;
}

function cleanName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const name = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 240);
  return name || undefined;
}

export function normalizeWhatsappContact(value: WhatsappContactObservation): {
  jid: string;
  phone?: string;
  savedName?: string;
  pushName?: string;
  verifiedName?: string;
} | undefined {
  const jid = typeof value.id === "string" ? value.id.trim().toLowerCase() : "";
  // Contact events sometimes contain groups, broadcasts or newsletters. Do not
  // promote those into people, or turn opaque LIDs into invented phone numbers.
  const match = /^(\d{5,20})@(s\.whatsapp\.net|lid)$/.exec(jid);
  if (!match) return undefined;
  const phoneJid = jid.endsWith("@s.whatsapp.net") ? match[1] : undefined;
  const alternatePhone = typeof value.phoneNumber === "string"
    ? /^(\d{5,20})@s\.whatsapp\.net$/.exec(value.phoneNumber.trim().toLowerCase())?.[1]
    : undefined;
  return {
    jid,
    ...(phoneJid || alternatePhone ? { phone: phoneJid || alternatePhone } : {}),
    ...(cleanName(value.name) ? { savedName: cleanName(value.name) } : {}),
    ...(cleanName(value.notify) ? { pushName: cleanName(value.notify) } : {}),
    ...(cleanName(value.verifiedName) ? { verifiedName: cleanName(value.verifiedName) } : {}),
  };
}

export class WhatsappContactsStore {
  private readonly path: string;
  private mutation: Promise<unknown> = Promise.resolve();

  constructor(dataDir: string) {
    this.path = join(dataDir, "contacts.json");
  }

  private async load(): Promise<ContactsFile> {
    try {
      const parsed = JSON.parse(await readFile(this.path, "utf8")) as ContactsFile;
      if (parsed?.version !== 1 || !parsed.accounts || typeof parsed.accounts !== "object") return blank();
      // Backward compatible with 0.11.7's JID-keyed contacts. Group only within
      // the same INPUT account and only when normalized phone numbers match.
      const normalized = blank();
      for (const [accountId, bucket] of Object.entries(parsed.accounts)) {
        const target: Record<string, WhatsappContact> = {};
        for (const entry of Object.values(bucket)) {
          if (!entry || typeof entry !== "object" || !entry.jid) continue;
          const key = keyForContact(entry);
          target[key] = mergeContact(target[key], entry);
        }
        normalized.accounts[accountId] = target;
      }
      return normalized;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return blank();
      throw error;
    }
  }

  private async save(value: ContactsFile): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, JSON.stringify(value) + "\n", { encoding: "utf8", mode: 0o600 });
    await rename(temporary, this.path);
  }

  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const result = this.mutation.then(task, task);
    this.mutation = result.then(() => undefined, () => undefined);
    return result;
  }

  async ingest(accountId: string, observations: WhatsappContactObservation[], source: "history" | "realtime"): Promise<{ observed: number; added: number; updated: number }> {
    const incoming = new Map<string, NonNullable<ReturnType<typeof normalizeWhatsappContact>>>();
    for (const observation of observations) {
      const normalized = normalizeWhatsappContact(observation);
      if (!normalized) continue;
      const prior = incoming.get(normalized.jid);
      incoming.set(normalized.jid, prior ? { ...prior, ...normalized } : normalized);
    }
    if (!incoming.size) return { observed: 0, added: 0, updated: 0 };
    return this.serialize(async () => {
      const file = await this.load();
      const bucket = file.accounts[accountId] ?? {};
      const now = new Date().toISOString();
      let added = 0;
      let updated = 0;
      for (const contact of incoming.values()) {
        const key = contact.phone ? "tel:" + contact.phone : "jid:" + contact.jid;
        const existing = bucket[key];
        const merged = mergeContact(existing, {
          accountId, jid: contact.jid,
          ...(contact.phone ? { phone: contact.phone } : {}),
          ...(contact.savedName ? { savedName: contact.savedName } : {}),
          ...(contact.pushName ? { pushName: contact.pushName } : {}),
          ...(contact.verifiedName ? { verifiedName: contact.verifiedName } : {}),
          firstObservedAt: existing?.firstObservedAt ?? now,
          lastObservedAt: now, source,
        });
        if (!existing) added++;
        else if (existing.displayName !== merged.displayName || existing.phone !== merged.phone || existing.savedName !== merged.savedName || existing.pushName !== merged.pushName || existing.verifiedName !== merged.verifiedName) updated++;
        bucket[key] = merged;
      }
      file.accounts[accountId] = bucket;
      await this.save(file);
      return { observed: incoming.size, added, updated };
    });
  }

  async importContacts(accountId: string, entries: ParsedContact[], countryCode = "54"): Promise<{
    added: number; updated: number; duplicates: number; invalid: number;
  }> {
    const incoming = new Map<string, string>();
    let duplicates = 0;
    let invalid = 0;
    for (const entry of entries) {
      const phone = normalizeImportedPhone(entry.phone, countryCode);
      const name = cleanName(entry.name);
      if (!phone || !name) { invalid++; continue; }
      if (incoming.has(phone)) duplicates++;
      incoming.set(phone, name);
    }
    if (!incoming.size) return { added: 0, updated: 0, duplicates, invalid };
    return this.serialize(async () => {
      const file = await this.load();
      const bucket = file.accounts[accountId] ?? {};
      let added = 0, updated = 0;
      const now = new Date().toISOString();
      for (const [phone, name] of incoming) {
        const key = "tel:" + phone;
        const previous = bucket[key];
        if (previous) duplicates++;
        const merged = mergeContact(previous, {
          accountId, jid: previous?.jid ?? key, phone,
          importedName: name, importedAt: now,
          source: "import", firstObservedAt: previous?.firstObservedAt ?? now, lastObservedAt: now,
        });
        if (!previous) added++;
        else if (merged.importedName !== previous.importedName || merged.displayName !== previous.displayName) updated++;
        bucket[key] = merged;
      }
      file.accounts[accountId] = bucket;
      await this.save(file);
      return { added, updated, duplicates, invalid };
    });
  }

  async list(input: { accountIds?: string[]; query?: string; limit?: number; offset?: number } = {}): Promise<{ contacts: WhatsappContact[]; total: number; importedTotal: number }> {
    await this.mutation;
    const file = await this.load();
    const selected = input.accountIds ? new Set(input.accountIds) : undefined;
    const needle = input.query?.trim().toLocaleLowerCase("es-AR") ?? "";
    const contacts = Object.entries(file.accounts)
      .filter(([accountId]) => !selected || selected.has(accountId))
      .flatMap(([, bucket]) => Object.values(bucket))
      .filter(contact => !needle || [contact.displayName, contact.savedName, contact.pushName, contact.verifiedName, contact.phone, contact.jid]
        .some(value => value?.toLocaleLowerCase("es-AR").includes(needle)))
      .sort((a, b) => (a.displayName || a.phone || a.jid).localeCompare(b.displayName || b.phone || b.jid, "es-AR"));
    const limit = Math.max(1, Math.min(500, Number.isFinite(input.limit) ? Math.trunc(input.limit!) : 100));
    const offset = Math.max(0, Math.min(1_000_000, Math.trunc(input.offset ?? 0)));
    return { contacts: contacts.slice(offset, offset + limit), total: contacts.length };
  }

  async stats(accountIds?: string[]): Promise<{ total: number; byAccount: Record<string, number> }> {
    await this.mutation;
    const file = await this.load();
    const selected = accountIds ? new Set(accountIds) : undefined;
    const byAccount: Record<string, number> = {};
    for (const [accountId, bucket] of Object.entries(file.accounts)) {
      if (!selected || selected.has(accountId)) byAccount[accountId] = Object.keys(bucket).length;
    }
    return { total: Object.values(byAccount).reduce((a, b) => a + b, 0), byAccount };
  }

  async deleteAccount(accountId: string): Promise<void> {
    await this.serialize(async () => {
      const file = await this.load();
      if (!file.accounts[accountId]) return;
      delete file.accounts[accountId];
      await this.save(file);
    });
  }
}
