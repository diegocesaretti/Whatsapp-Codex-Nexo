export interface ParsedContact {
  name: string;
  phone: string;
}

export interface ContactImportParseResult {
  format: "csv" | "vcf";
  contacts: ParsedContact[];
  skipped: number;
}

const MAX_ROWS = 20_000;

export function normalizeImportedPhone(value: unknown, countryCode = "54"): string | undefined {
  if (typeof value !== "string") return undefined;
  let input = value.trim();
  if (!input) return undefined;
  input = input.replace(/^tel:/i, "").replace(/^https?:\/\/(?:wa\.me|api\.whatsapp\.com\/send\?phone=)\//i, "");
  input = input.replace(/@s\.whatsapp\.net$/i, "");
  const explicit = input.startsWith("+") || input.startsWith("00") || input.endsWith("@s.whatsapp.net");
  let digits = input.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  const prefix = countryCode.replace(/\D/g, "");
  if (!explicit && prefix && digits.length >= 8 && digits.length <= 10 && !digits.startsWith(prefix)) {
    digits = prefix + digits.replace(/^0+/, "");
  }
  if (!/^\d{8,16}$/.test(digits)) return undefined;
  return digits;
}

function unescapeVcard(value: string): string {
  return value.replace(/\\[nN]/g, " ").replace(/\\([\\;,])/g, "$1").trim();
}

function parseVcards(text: string): ContactImportParseResult {
  // RFC 6350 folding: subsequent lines starting with a space or tab.
  const unfolded = text.replace(/\r?\n[ \t]/g, "");
  const cards = unfolded.split(/BEGIN:VCARD/i).slice(1);
  const contacts: ParsedContact[] = [];
  let skipped = 0;
  for (const card of cards) {
    if (contacts.length >= MAX_ROWS) throw new Error("contact_import_too_many_rows");
    const body = card.split(/END:VCARD/i)[0] || "";
    const lines = body.split(/\r?\n/);
    const names: string[] = [];
    const phones: string[] = [];
    for (const line of lines) {
      const colon = line.indexOf(":");
      if (colon < 0) continue;
      const prop = line.slice(0, colon).split(";")[0]?.toUpperCase().replace(/^ITEM\d+\./, "");
      const value = unescapeVcard(line.slice(colon + 1));
      if (prop === "FN" && value) names.unshift(value);
      else if (prop === "N" && value) names.push(value.split(";").filter(Boolean).reverse().join(" ").trim());
      else if (prop === "TEL" && value) phones.push(value.replace(/^tel:/i, ""));
    }
    const name = names.find(Boolean);
    if (!name || !phones.length) { skipped++; continue; }
    for (const phone of phones) contacts.push({ name, phone });
  }
  return { format: "vcf", contacts, skipped };
}

function csvTable(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === delimiter && !quoted) {
      row.push(cell.trim()); cell = "";
    } else if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell.trim()); cell = "";
      if (row.some(Boolean)) rows.push(row);
      row = [];
      if (rows.length > MAX_ROWS) throw new Error("contact_import_too_many_rows");
    } else {
      cell += ch;
    }
  }
  if (quoted) throw new Error("contact_import_unterminated_quote");
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  if (rows.length > MAX_ROWS) throw new Error("contact_import_too_many_rows");
  return rows;
}

function normalizedHeader(value: string): string {
  return value.toLocaleLowerCase("es-AR").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
}

function parseCsv(text: string): ContactImportParseResult {
  const headerLine = text.split(/\r?\n/, 1)[0] || "";
  const counts = [";", ",", "\t"].map(delim => ({
    delim, count: headerLine.split(delim).length - 1,
  }));
  const delimiter = counts.sort((a,b) => b.count - a.count)[0]?.delim || ",";
  const rows = csvTable(text, delimiter);
  if (!rows.length) return { format: "csv", contacts: [], skipped: 0 };
  const headers = rows[0]!.map(normalizedHeader);
  const nameColumns = headers.map((h,i) => ({
    index: i, rank: /^(name|displayname|fullname|nombre|nombrecompleto|contacto)$/.test(h) ? 0
      : /^(givenname|firstname|nombrede pila|nombres)$/.test(h) ? 1 : 4,
  })).filter(item => item.rank !== 4).sort((a,b) => a.rank-b.rank);
  const familyColumns = headers.map((h,i) => ({ h,i })).filter(x => /^(familyname|lastname|surname|apellido|apellidos)$/.test(x.h)).map(x => x.i);
  const phoneColumns = headers.map((h,i) => ({ h,i }))
    .filter(({ h }) => /^(phone|telefono|telefonos|tel|mobile|movil|celular|numero|numerodetelefono|whatsapp|phone\d+value|phone\d+|telefono\d+valor)$/.test(h))
    .map(({i})=>i);
  const hasHeaders = nameColumns.length > 0 && phoneColumns.length > 0;
  const contacts: ParsedContact[] = [];
  let skipped = 0;
  const list = hasHeaders ? rows.slice(1) : rows;
  for (const row of list) {
    const name = hasHeaders
      ? (row[nameColumns[0]!.index] || [row[nameColumns.find(x=>x.rank===1)?.index ?? -1], row[familyColumns[0] ?? -1]].filter(Boolean).join(" "))
      : row[0];
    const phones = hasHeaders ? phoneColumns.map(i=>row[i]).filter((x): x is string=>Boolean(x)) : [row[1]];
    if (!name || phones.length===0 || !phones.some(Boolean)) {skipped++;continue;}
    for (const phone of phones) if (phone) contacts.push({ name: name.trim(), phone });
  }
  return { format: "csv", contacts, skipped };
}

export function parseContactFile(filename: string, contents: string): ContactImportParseResult {
  const ext = filename.toLocaleLowerCase("es-AR").split(".").pop();
  if (ext !== "csv" && ext !== "vcf") throw new Error("contact_import_unsupported_format");
  if (Buffer.byteLength(contents, "utf8") > 3 * 1024 * 1024) throw new Error("contact_import_file_too_large");
  const clean = contents.replace(/^\uFEFF/, "");
  const parsed = ext === "vcf" ? parseVcards(clean) : parseCsv(clean);
  if (!parsed.contacts.length) throw new Error("contact_import_no_contacts");
  if (parsed.contacts.length > MAX_ROWS) throw new Error("contact_import_too_many_rows");
  return parsed;
}
