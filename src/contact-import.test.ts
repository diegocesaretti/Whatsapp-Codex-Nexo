import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseContactFile, normalizeImportedPhone } from "./contact-import.js";
import { WhatsappContactsStore } from "./contacts.js";

test("CSV handles BOM, semicolon delimiter, quoted names and multiple phone columns", () => {
  const parsed=parseContactFile("contactos.csv", '\uFEFFNombre;Teléfono;Celular\n"Perez, Juan";+54 9 353 211 1111;\nMariana;;+54 9 353 222 2222\n');
  assert.deepEqual(parsed.contacts, [
    {name:"Perez, Juan",phone:"+54 9 353 211 1111"},
    {name:"Mariana",phone:"+54 9 353 222 2222"},
  ]);
  assert.equal(parsed.format,"csv");
});

test("Google Contacts CSV headers and quoted separators work", () => {
  const parsed=parseContactFile("google.csv", 'Name,Phone 1 - Value,Phone 2 - Value\n"Juan, Electricista",+5493532111111,+5493532111111\n');
  assert.equal(parsed.contacts.length,2);
  assert.equal(parsed.contacts[0]?.name,"Juan, Electricista");
});

test("vCards accept folded names, multiple phones and avoid groups", () => {
  const file='BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Juan Perez\r\nTEL;TYPE=CELL:+5493532111111\r\nTEL;TYPE=HOME:+54 353 222 2222\r\nEND:VCARD\r\nBEGIN:VCARD\r\nFN:Mariana\r\n Lopez\r\nTEL;VALUE=uri:tel:+5493533333333\r\nEND:VCARD\r\n';
  const parsed=parseContactFile("agenda.vcf",file);
  assert.equal(parsed.contacts.length,3);
  assert.equal(parsed.contacts[2]?.name,"MarianaLopez");
  assert.equal(normalizeImportedPhone(parsed.contacts[2]?.phone),"5493533333333");
});

test("rejects invalid formats, truncated quoted CSV and excessive file size", () => {
  assert.throws(()=>parseContactFile("contacts.xls","Name,Phone\nJuan,54353"),/unsupported_format/);
  assert.throws(()=>parseContactFile("contacts.csv",'Name,Phone\n"Juan,12345'),/unterminated_quote/);
  assert.throws(()=>parseContactFile("contacts.csv","x".repeat(3*1024*1024+1)),/file_too_large/);
  assert.equal(normalizeImportedPhone("123"),undefined);
  assert.equal(normalizeImportedPhone("+5493532111111"),"5493532111111");
  assert.equal(normalizeImportedPhone("0035493532111111"),"35493532111111");
});

test("import deduplicates exact normalized phone and merges WhatsApp metadata", async () => {
  const dir=await mkdtemp(join(tmpdir(),"nexo-contact-import-"));
  const first="11111111-1111-1111-1111-111111111111";
  const other="22222222-2222-2222-2222-222222222222";
  try {
    const book=new WhatsappContactsStore(dir);
    await book.ingest(first,[{id:"5493532111111@s.whatsapp.net",name:"Juan Whatsapp"}],"history");
    const imported=parseContactFile("lista.csv","Nombre,Teléfono\nJuan del archivo,+5493532111111\nJuan duplicado,+54 93532111111\nMariana,+5493532222222\n");
    const result=await book.importContacts(first,imported.contacts);
    assert.deepEqual(result,{added:1,updated:1,duplicates:2,invalid:0});
    const list=await book.list({accountIds:[first]});
    assert.equal(list.total,2);
    const juan=list.contacts.find(c=>c.phone==="5493532111111");
    assert.equal(juan?.displayName,"Juan Whatsapp");
    assert.equal(juan?.importedName,"Juan duplicado");
    assert.ok(juan?.sources?.includes("import"));
    assert.ok(juan?.sources?.includes("history"));
    const repeat=await book.importContacts(first,imported.contacts);
    assert.equal(repeat.added,0);
    assert.equal((await book.list({accountIds:[first]})).total,2);
    await book.importContacts(other,[{name:"Juan en otra cuenta",phone:"+5493532111111"}]);
    assert.equal((await book.list()).total,3);
    assert.equal((await book.list({accountIds:[first],offset:1,limit:1})).contacts.length,1);
    assert.equal((await book.list({accountIds:[]})).total,0);
    const stored=JSON.parse(await readFile(join(dir,"contacts.json"),"utf8"));
    assert.equal(Object.keys(stored.accounts[first]).length,2);
    assert.equal(Object.keys(stored.accounts[other]).length,1);
    await book.deleteAccount(first);
    assert.equal((await book.list({accountIds:[first]})).total,0);
    assert.equal((await book.list()).total,1);
  } finally { await rm(dir,{recursive:true,force:true});}
});

test("0.11.7 contact records keyed by JID migrate without losing contact names", async () => {
  const dir=await mkdtemp(join(tmpdir(),"nexo-legacy-contact-import-"));
  try {
    const account="legacy";
    const book=new WhatsappContactsStore(dir);
    await book.ingest(account,[{id:"5493532111111@s.whatsapp.net",name:"Antiguo"}],"history");
    await book.importContacts(account,[{name:"Importado",phone:"+5493532111111"}]);
    assert.equal((await book.list()).total,1);
    assert.equal((await book.list()).contacts[0]?.displayName,"Antiguo");
  } finally {await rm(dir,{recursive:true,force:true});}
});

test("new UI mounts contacts tab and secure import form", async () => {
  const { renderAdminPage }=await import("./ui.js");
  const html=renderAdminPage();
  assert.ok(html.includes('data-section="contacts"'));
  assert.ok(html.includes('data-nav="contacts"'));
  assert.ok(html.includes('id="nx-import-button"'));
  assert.ok(html.includes('id="nx-account-filter"'));
  assert.ok(html.includes("/api/contacts/import"));
});
