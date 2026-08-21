export function renderAdminPage(): string {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>WhatsApp Codex Nexo</title>
<style>
:root{font-family:Inter,system-ui,sans-serif;color-scheme:dark;--bg:#0b0d10;--panel:#14171c;--line:#2a3038;--muted:#949ca8;--good:#54d68a;--warn:#efbf52;--bad:#ff7373}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:#f5f7fa}.page{width:min(1180px,calc(100% - 32px));margin:auto;padding:34px 0 80px}h1{font-size:clamp(34px,5vw,58px);letter-spacing:-.05em;margin:8px 0}.lead{color:var(--muted);max-width:850px;line-height:1.55}.grid{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:14px;margin-top:22px}.card{grid-column:span 6;background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:18px}.wide{grid-column:1/-1}.row{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap}.cluster{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.badge{border:1px solid var(--line);border-radius:999px;padding:5px 9px;font-size:12px;color:var(--muted)}.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--warn);margin-right:6px}.dot.open{background:var(--good)}.dot.error,.dot.logged_out{background:var(--bad)}button,input,select,textarea{font:inherit}button{border:1px solid var(--line);border-radius:10px;padding:9px 12px;background:#1c2128;color:#fff;font-weight:700;cursor:pointer}button.primary{background:#f5f7fa;color:#0b0d10}button.danger{color:var(--bad);background:transparent}button:disabled{opacity:.5}input,select,textarea{width:100%;background:#0f1216;color:#fff;border:1px solid var(--line);border-radius:10px;padding:10px}textarea{min-height:110px;resize:vertical}.fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.fields3{display:grid;grid-template-columns:2fr 1fr auto;gap:8px;align-items:end}.field label{display:block;font-size:12px;color:var(--muted);margin:0 0 5px}.check{display:flex;gap:8px;align-items:center}.check input{width:auto}.muted{color:var(--muted)}.small{font-size:12px}.qr{background:#fff;border-radius:14px;padding:12px;width:min(340px,100%);margin-top:14px}.qr img{display:block;width:100%}.list{display:grid;gap:10px;margin-top:12px}.message{padding:10px 0;border-top:1px solid var(--line)}.message:first-child{border-top:0}.text{white-space:pre-wrap;overflow-wrap:anywhere;margin-top:4px}.status{min-height:20px;margin-top:8px}.error{color:var(--bad)}.good{color:var(--good)}.section-title{font-size:20px;font-weight:800;margin-bottom:4px}hr{border:0;border-top:1px solid var(--line);margin:18px 0}@media(max-width:760px){.card{grid-column:1/-1}.fields,.fields3{grid-template-columns:1fr}.page{padding-top:24px}}
</style>
</head>
<body>
<main class="page">
  <div class="small muted">CODEX NEXO · WHATSAPP · v0.3</div>
  <h1>WhatsApp bridge.</h1>
  <p class="lead">Varias cuentas INPUT observadas, una cuenta OUTPUT para Codex y un canal conversacional bidireccional opcional, aislado y limitado a números explícitamente autorizados.</p>
  <div id="app"><div class="card wide muted">Cargando…</div></div>
</main>
<script>
const app = document.getElementById('app');
const esc = value => String(value == null ? '' : value).replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[char]));

async function api(path, options) {
  const opts = options || {};
  const response = await fetch(path, Object.assign({cache:'no-store'}, opts));
  let body = {};
  try { body = await response.json(); } catch {}
  return { response, body };
}

function accountCard(account) {
  const runtime = account.runtime || {state:'idle'};
  const role = account.role === 'output' ? 'OUTPUT · Codex' : 'INPUT · observado';
  let html = '<article class="card">';
  html += '<div class="row"><div><strong>' + esc(account.label) + '</strong><div class="small muted" style="margin-top:4px">' + role;
  if (account.phoneJid) html += ' · ' + esc(account.phoneJid);
  html += '</div></div><span class="badge"><span class="dot ' + esc(runtime.state) + '"></span>' + esc(runtime.state) + '</span></div>';
  if (runtime.lastError) html += '<div class="error small" style="margin-top:10px">' + esc(runtime.lastError) + '</div>';
  if (runtime.qrDataUrl) html += '<div class="qr"><img src="' + esc(runtime.qrDataUrl) + '" alt="QR WhatsApp"><div style="color:#111;text-align:center;font-weight:700;margin-top:6px">WhatsApp → Dispositivos vinculados</div></div>';
  html += '<div class="cluster" style="margin-top:14px"><button data-connect="' + esc(account.id) + '">' + (runtime.state === 'open' ? 'Reiniciar' : 'Conectar / QR') + '</button><button class="danger" data-delete="' + esc(account.id) + '">Desvincular y borrar</button></div>';
  html += '<div class="small muted" style="margin-top:10px">recibidos ' + Number(runtime.receivedMessages || 0) + ' · guardados ' + Number(runtime.storedMessages || 0) + ' · historial ' + Number(runtime.historyMessages || 0) + '</div></article>';
  return html;
}

function settingsCard(settingsResponse) {
  const settings = settingsResponse.settings;
  const llm = settings.llm;
  const conversation = settings.outputConversation || {enabled:false,authorizedNumbers:[],maxContextMessages:80};
  const numbersText = (conversation.authorizedNumbers || []).join(String.fromCharCode(10));
  const windows = settingsResponse.platform === 'win32';
  let html = '<section class="card wide">';
  html += '<div class="row"><div><div class="section-title">Configuración</div><div class="small muted">Storage, Windows, conversación OUTPUT y resumen LLM.</div></div><span class="badge">Storage · ' + esc(settingsResponse.storage.mode) + '</span></div>';
  html += '<div class="fields" style="margin-top:16px"><div class="field"><label>Backend</label><input disabled value="' + esc(settingsResponse.storage.mode === 'neon' ? 'Neon PostgreSQL · schema whatsapp_nexo' : 'Local JSONL') + '"></div><div class="field"><label>Datos locales / credenciales</label><input disabled value="' + esc(settingsResponse.storage.dataDir) + '"></div></div>';
  html += '<div class="fields" style="margin-top:12px"><label class="check"><input id="cfgAuto" type="checkbox" ' + (settings.autoConnectLinkedAccounts ? 'checked' : '') + '> Reconectar cuentas vinculadas al iniciar</label><label class="check"><input id="cfgOpen" type="checkbox" ' + (settings.openDashboardOnLaunch ? 'checked' : '') + '> Abrir panel al iniciar</label><label class="check"><input id="cfgWin" type="checkbox" ' + (settingsResponse.windowsAutostart ? 'checked' : '') + ' ' + (windows ? '' : 'disabled') + '> Iniciar Nexo con Windows</label><div class="field"><label>Refresco UI (ms)</label><input id="cfgRefresh" type="number" min="500" max="10000" value="' + Number(settings.uiRefreshMs) + '"></div><div class="field"><label>Máx. resultados búsqueda</label><input id="cfgMax" type="number" min="10" max="200" value="' + Number(settings.maxSearchResults) + '"></div></div>';

  html += '<hr><div class="row"><div><strong>Conversación bidireccional con Codex</strong><div class="small muted">Sólo chats directos de números autorizados. INPUT sigue siendo no confiable.</div></div><label class="check"><input id="convEnabled" type="checkbox" ' + (conversation.enabled ? 'checked' : '') + '> habilitada</label></div>';
  html += '<div class="fields" style="margin-top:12px"><div class="field"><label>Números autorizados · uno por línea</label><textarea id="convNumbers" placeholder="5493532...">' + esc(numbersText) + '</textarea></div><div><div class="field"><label>Máx. mensajes de contexto</label><input id="convMax" type="number" min="10" max="500" value="' + Number(conversation.maxContextMessages || 80) + '"></div><div class="small muted" style="margin-top:8px">Usá código de país. Nexo normaliza +, espacios y guiones. Revocar un número bloquea respuestas inmediatamente.</div><button id="checkReplies" style="margin-top:12px">Ver respuestas pendientes</button></div></div><div id="convst" class="status small"></div>';

  html += '<hr><div class="row"><div><strong>LLM para barrido y resumen</strong><div class="small muted">OpenAI-compatible · analiza INPUT como datos no confiables.</div></div><label class="check"><input id="llmEnabled" type="checkbox" ' + (llm.enabled ? 'checked' : '') + '> habilitado</label></div>';
  html += '<div class="fields" style="margin-top:12px"><div class="field"><label>Base URL</label><input id="llmUrl" value="' + esc(llm.baseUrl) + '"></div><div class="field"><label>Modelo</label><input id="llmModel" value="' + esc(llm.model) + '"></div><div class="field"><label>Temperatura</label><input id="llmTemp" type="number" step="0.1" min="0" max="2" value="' + Number(llm.temperature) + '"></div><div class="field"><label>Máx. mensajes por barrido</label><input id="llmMax" type="number" min="20" max="5000" value="' + Number(llm.maxInputMessages) + '"></div><div class="field"><label>API key</label><input id="llmKey" type="password" placeholder="' + (settingsResponse.llmApiKeyConfigured ? 'Configurada · dejar vacío para conservar' : 'Opcional para endpoints locales') + '"></div><div class="field"><label>Estado secreto</label><input disabled value="' + (settingsResponse.llmApiKeyConfigured ? 'API key configurada' : 'Sin API key') + '"></div></div>';
  html += '<div class="field" style="margin-top:10px"><label>System prompt</label><textarea id="llmPrompt">' + esc(llm.systemPrompt) + '</textarea></div><div class="cluster" style="margin-top:12px"><button id="saveCfg" class="primary">Guardar configuración</button><button id="testLlm">Probar resumen</button></div><div id="cfgst" class="status small"></div></section>';
  return html;
}

function render(state, settings) {
  const accounts = state.accounts || [];
  const hasOutput = accounts.some(account => account.role === 'output');
  let html = '<div class="grid">';
  html += '<section class="card wide"><div class="row"><div><strong>Agregar cuenta</strong><div class="small muted">Podés crear todos los INPUT que quieras; OUTPUT está limitado a uno.</div></div></div><form id="add" class="fields3" style="margin-top:12px"><input name="label" placeholder="Ej: WhatsApp Diego" required maxlength="120"><select name="role"><option value="input">Input</option><option value="output" ' + (hasOutput ? 'disabled' : '') + '>Output de Codex</option></select><button class="primary">Crear y vincular</button></form><div id="addst" class="status small"></div></section>';
  html += accounts.map(accountCard).join('');
  html += '<section class="card wide"><strong>Buscar en INPUT</strong><div class="cluster" style="margin-top:12px"><input id="q" placeholder="Ej: Juan bomba" style="max-width:420px"><button id="search">Buscar</button><button id="recent">Recientes</button></div><div id="results" class="list"></div></section>';
  if (hasOutput) html += '<section class="card wide"><strong>Probar OUTPUT</strong><p class="small muted">Diagnóstico local; el MCP usa el mismo canal.</p><div class="fields3"><input id="to" placeholder="549... o JID"><input id="msg" placeholder="Mensaje"><button id="send">Enviar</button></div><div id="sendst" class="status small"></div></section>';
  html += settingsCard(settings) + '</div>';
  app.innerHTML = html;
  bind();
}

function showMessages(messages) {
  const slot = document.getElementById('results');
  if (!messages || !messages.length) { slot.innerHTML = '<div class="muted small">Sin resultados.</div>'; return; }
  slot.innerHTML = messages.map(message => '<div class="message"><div class="small muted">' + esc(new Date(message.occurredAt).toLocaleString()) + ' · ' + esc(message.accountLabel) + ' · ' + esc(message.chatName || message.chatJid) + (message.senderName ? ' · ' + esc(message.senderName) : '') + '</div><div class="text">' + esc(message.text || '[' + (message.messageType || 'mensaje sin texto') + ']') + '</div></div>').join('');
}

function parseAuthorizedNumbers() {
  let value = document.getElementById('convNumbers').value;
  value = value.split(String.fromCharCode(13)).join('');
  value = value.split(String.fromCharCode(10)).join(',');
  value = value.split(';').join(',');
  return value.split(',').map(item => item.trim()).filter(Boolean);
}

function bind() {
  document.getElementById('add').onsubmit = async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const status = document.getElementById('addst');
    status.textContent = 'Creando cuenta…';
    const created = await api('/api/accounts', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({label:form.get('label'),role:form.get('role')})});
    if (!created.response.ok) { status.className='status small error'; status.textContent=created.body.error || 'Error'; return; }
    status.textContent = 'Iniciando vínculo…';
    await api('/api/accounts/' + encodeURIComponent(created.body.id) + '/connect', {method:'POST'});
    await load();
  };

  document.querySelectorAll('[data-connect]').forEach(button => button.onclick = async () => {
    button.disabled = true;
    const card = button.closest('.card');
    const open = card && card.querySelector('.badge') && card.querySelector('.badge').textContent.includes('open');
    const action = open ? 'restart' : 'connect';
    const result = await api('/api/accounts/' + encodeURIComponent(button.dataset.connect) + '/' + action, {method:'POST'});
    if (!result.response.ok) alert(result.body.error || 'Error');
    await load();
  });

  document.querySelectorAll('[data-delete]').forEach(button => button.onclick = async () => {
    if (!confirm('Esto desvincula WhatsApp y elimina los datos de esta cuenta. ¿Continuar?')) return;
    const result = await api('/api/accounts/' + encodeURIComponent(button.dataset.delete) + '/logout', {method:'POST'});
    if (!result.response.ok) alert(result.body.error || 'Error');
    await load();
  });

  document.getElementById('search').onclick = async () => {
    const query = document.getElementById('q').value.trim();
    if (query.length < 2) return;
    const result = await api('/api/messages/search', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({query,limit:60})});
    showMessages(result.body.messages);
  };
  document.getElementById('recent').onclick = async () => {
    const result = await api('/api/messages/recent?limit=40');
    showMessages(result.body.messages);
  };

  const send = document.getElementById('send');
  if (send) send.onclick = async () => {
    const status = document.getElementById('sendst');
    status.textContent = 'Enviando…';
    const result = await api('/api/output/send', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({to:document.getElementById('to').value,text:document.getElementById('msg').value,reason:'manual admin test',confirmedByUser:true})});
    status.className = 'status small ' + (result.response.ok ? 'good' : 'error');
    status.textContent = result.response.ok ? 'Enviado · ' + (result.body.audit && result.body.audit.messageId ? result.body.audit.messageId : 'ok') : (result.body.error || 'Error');
  };

  document.getElementById('saveCfg').onclick = async () => {
    const status = document.getElementById('cfgst');
    status.textContent = 'Guardando…';
    const key = document.getElementById('llmKey').value;
    const payload = {
      autoConnectLinkedAccounts: document.getElementById('cfgAuto').checked,
      openDashboardOnLaunch: document.getElementById('cfgOpen').checked,
      uiRefreshMs: Number(document.getElementById('cfgRefresh').value),
      maxSearchResults: Number(document.getElementById('cfgMax').value),
      windowsAutostart: document.getElementById('cfgWin').checked,
      outputConversation: {
        enabled: document.getElementById('convEnabled').checked,
        authorizedNumbers: parseAuthorizedNumbers(),
        maxContextMessages: Number(document.getElementById('convMax').value)
      },
      llm: {
        enabled: document.getElementById('llmEnabled').checked,
        baseUrl: document.getElementById('llmUrl').value,
        model: document.getElementById('llmModel').value,
        temperature: Number(document.getElementById('llmTemp').value),
        maxInputMessages: Number(document.getElementById('llmMax').value),
        systemPrompt: document.getElementById('llmPrompt').value
      }
    };
    if (key) payload.llmApiKey = key;
    const result = await api('/api/settings', {method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
    status.className = 'status small ' + (result.response.ok ? 'good' : 'error');
    status.textContent = result.response.ok ? 'Configuración guardada.' : (result.body.error || 'Error');
  };

  document.getElementById('checkReplies').onclick = async () => {
    const status = document.getElementById('convst');
    status.textContent = 'Consultando…';
    const result = await api('/api/output/conversation/replies?pending=true&limit=20');
    status.className = 'status small ' + (result.response.ok ? 'good' : 'error');
    status.textContent = result.response.ok ? String((result.body.messages || []).length) + ' respuesta(s) pendiente(s).' : (result.body.error || 'Error');
  };

  document.getElementById('testLlm').onclick = async () => {
    const status = document.getElementById('cfgst');
    status.textContent = 'Resumiendo últimos mensajes…';
    const result = await api('/api/llm/summarize', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({limit:80,focus:'Prueba de configuración: resumen breve de actividad reciente'})});
    status.className = 'status small ' + (result.response.ok ? 'good' : 'error');
    status.textContent = result.response.ok ? result.body.summary : (result.body.error || 'Error');
  };
}

async function load() {
  const responses = await Promise.all([api('/api/state'), api('/api/settings')]);
  const state = responses[0];
  const settings = responses[1];
  if (!state.response.ok || !settings.response.ok) {
    app.innerHTML = '<div class="card wide error">' + esc(state.body.error || settings.body.error || 'No se pudo cargar') + '</div>';
    return;
  }
  render(state.body, settings.body);
  const waiting = (state.body.accounts || []).some(account => account.runtime && ['connecting','qr','reconnecting'].includes(account.runtime.state));
  if (waiting) setTimeout(load, Number(state.body.settings && state.body.settings.uiRefreshMs ? state.body.settings.uiRefreshMs : 1500));
}
load();
</script>
</body>
</html>`;
}
