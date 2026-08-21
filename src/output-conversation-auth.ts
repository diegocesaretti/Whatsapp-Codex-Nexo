export function normalizePhoneNumber(value: string | undefined | null): string | undefined {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 18) return undefined;
  return digits;
}

export function phoneNumberFromJid(jid: string | undefined | null): string | undefined {
  if (!jid?.endsWith("@s.whatsapp.net")) return undefined;
  const local = jid.slice(0, -"@s.whatsapp.net".length).split(":", 1)[0];
  return normalizePhoneNumber(local);
}

export function safePhoneJid(...jids: Array<string | undefined | null>): string | undefined {
  for (const jid of jids) {
    const phone = phoneNumberFromJid(jid);
    if (phone) return `${phone}@s.whatsapp.net`;
  }
  return undefined;
}

export function normalizeAuthorizedNumbers(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => normalizePhoneNumber(value)).filter((value): value is string => Boolean(value)))].slice(0, 20);
}

export function isAuthorizedPhone(authorizedNumbers: readonly string[], phone: string | undefined): boolean {
  if (!phone) return false;
  return authorizedNumbers.includes(phone);
}
