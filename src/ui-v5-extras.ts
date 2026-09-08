export function augmentAdminPageV5(html: string): string {
  const css = String.raw`
textarea{width:100%;min-height:112px;border:1px solid var(--line);border-radius:11px;background:#0d1015;color:var(--text);padding:10px 11px;font:inherit;outline:none;resize:vertical}.message{padding:12px 0;border-bottom:1px solid var(--line)}.message:last-child{border-bottom:0}.message-text{white-space:pre-wrap;overflow-wrap:anywhere;margin-top:5px;line-height:1.45}.settings-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.settings-grid .wide{grid-column:1/-1}@media(max-width:680px){.tabs-mobile{grid-template-columns:repeat(6,1fr)}.settings-grid{grid-template-columns:1fr}}
`;

  const archiveSection = String.raw`
    <section class="page section" data-section="archive">
      <div class="toolbar"><div><div class="eyebrow">Nexo</div><h1>Archivo.</h1><p class="lead">Buscá y revisá mensajes de las cuentas observadas sin mezclar el archivo INPUT con la conversación OUTPUT de Codex.</p></div><button class="action" id="archive-recent">Recientes</button></div>
      <div class="card"><div class="cluster"><input id="archive-query" placeholder="Ej. Juan bomba, pedido, fecha…" style="max-width:520px"><button class="action primary" id="archive-search">Buscar</button></div><div id="archive-results" style="margin-top:14px"><div class="empty">Usá Buscar o Recientes.</div></div></div>
    </section>
`;

  const advancedSettings = String.raw`
        <form class="card span12" id="advanced-form">
          <div class="toolbar"><div><div class="eyebrow">Administración avanzada</div><h2 style="margin-top:4px">Archivo, Windows, worker y LLM</h2></div><span class="badge" id="llm-key-state">API key —</span></div>
          <div class="divider"></div>
          <div class="settings-grid">
            <label class="toggle"><input id="adv-win" type="checkbox"> Iniciar Nexo con Windows</label>
            <label>Máx. resultados de búsqueda<input id="adv-search-max" type="number" min="10" max="200"></label>
            <label>Máx. mensajes de contexto OUTPUT<input id="adv-context-max" type="number" min="10" max="500"></label>
            <label>Polling del worker (ms)<input id="adv-worker-poll" type="number" min="500" max="10000"></label>
            <label>Debounce del worker (ms)<input id="adv-worker-debounce" type="number" min="0" max="15000"></label>
            <label>Timeout Codex (seg)<input id="adv-worker-timeout" type="number" min="30" max="900"></label>
            <label>Máx. mensajes agrupados<input id="adv-worker-batch" type="number" min="1" max="20"></label>
          </div>
          <div class="divider"></div>
          <div class="row between"><div><strong>LLM para barrido y resumen</strong><div class="muted small">OpenAI-compatible. Analiza INPUT como datos no confiables.</div></div><label class="toggle"><input id="adv-llm-enabled" type="checkbox"> habilitado</label></div>
          <div class="settings-grid" style="margin-top:12px">
            <label>Base URL<input id="adv-llm-url"></label>
            <label>Modelo<input id="adv-llm-model"></label>
            <label>Temperatura<input id="adv-llm-temp" type="number" step="0.1" min="0" max="2"></label>
            <label>Máx. mensajes por barrido<input id="adv-llm-max" type="number" min="20" max="5000"></label>
            <label>Ventana reciente (días)<input id="adv-llm-lookback" type="number" min="1" max="90"></label>
            <label>API key<input id="adv-llm-key" type="password" placeholder="Dejar vacío para conservar"></label>
            <label class="wide">System prompt<textarea id="adv-llm-prompt"></textarea></label>
          </div>
          <div class="cluster" style="justify-content:flex-end;margin-top:16px"><button class="action" type="button" id="adv-test-llm">Probar resumen</button><button class="action primary" type="submit">Guardar avanzada</button></div>
          <div id="adv-status" class="small muted" style="margin-top:10px"></div>
        </form>
`;

  const editModal = String.raw`
<div class="modal" id="person-edit-modal"><div class="modal-card"><div class="toolbar"><div><div class="eyebrow">Persona</div><h2 style="margin-top:4px">Editar persona</h2></div><button class="action ghost" data-close="person-edit-modal">✕</button></div><div class="fields"><label>Nombre<input id="edit-person-name"></label><label>Cómo llamarla<input id="edit-person-nick"></label><label>Teléfonos<input id="edit-person-phones" placeholder="549... separados por coma"></label><label>Rol<select id="edit-person-role"><option value="member">Miembro</option><option value="owner">Owner</option><option value="adult">Adulto</option><option value="child">Niño/a</option><option value="guest">Invitado</option></select></label></div><label class="toggle" style="margin-top:14px"><input id="edit-person-codex" type="checkbox"> Puede conversar con Codex por WhatsApp</label><div class="cluster" style="justify-content:flex-end;margin-top:16px"><button class="action" data-close="person-edit-modal">Cancelar</button><button class="action primary" id="edit-person-save">Guardar persona</button></div></div></div>
`;

  const extraScript = String.raw`
<script>
(function(){
  const originalRenderPeople=renderPeople;
  const originalRenderSettings=renderSettings;
  let editingPersonId='';

  function parsePhoneList(value){return [...new Set(String(value||'').split(/[\s,;]+/).map(v=>v.replace(/\D/g,'')).filter(Boolean))]}
  async function freshIdentityRegistry(){const out=await api('/api/settings');if(!out.r.ok)throw new Error(out.b.error||'No se pudo actualizar Personas');state.settings=out.b;return (out.b.settings?.outputConversation?.identities||[]).map(p=>({...p,phoneNumbers:[...(p.phoneNumbers||[])],linkedInputAccountIds:[...(p.linkedInputAccountIds||[])]}))}
  async function mutateIdentityRegistry(change){try{const current=await freshIdentityRegistry();const next=change(current);if(!next)return false;const out=await api('/api/settings',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({outputConversation:{identities:next}})});if(!out.r.ok)throw new Error(out.b.error||'No se pudieron guardar las personas');await Promise.all([loadSettings(),loadState()]);renderSummary();renderPeople();return true}catch(e){alert(e?.message||'No se pudieron guardar las personas');return false}}

  personCard=function(p){const links=p.linkedInputAccountIds||[],orphan=(p.source==='input'||p.source==='legacy')&&!links.length,canDelete=!links.length;return '<article class="account"><div><div class="person-source">'+esc(orphan?'Residuo de identidad':p.source||'manual')+'</div><div class="row" style="margin-top:4px"><span class="account-title">'+esc(p.displayName)+'</span><span class="badge">'+esc(p.role)+'</span>'+(p.codexConversationEnabled?'<span class="badge"><span class="dot good"></span>Codex habilitado</span>':'<span class="badge">Codex bloqueado</span>')+'</div><div class="account-meta">Apodo: '+esc(p.nickname||'—')+' · '+esc(identityMeta(p))+(orphan?'<div class="warn">Esta identidad ya no está vinculada a ninguna cuenta. Podés quitar el residuo.</div>':'')+'</div></div><div class="cluster"><button class="action" data-person-edit="'+esc(p.id)+'">Editar</button><button class="action" data-person-toggle="'+esc(p.id)+'">'+(p.codexConversationEnabled?'Bloquear Codex':'Permitir Codex')+'</button>'+(canDelete?'<button class="action danger" data-person-delete="'+esc(p.id)+'" data-label="'+esc(p.displayName)+'">'+(orphan?'Quitar residuo':'Eliminar persona')+'</button>':'<span class="badge">vinculada a cuenta</span>')+'</div></article>'}
  renderPeople=function(){originalRenderPeople();document.querySelectorAll('[data-person-edit]').forEach(b=>b.onclick=()=>openPersonEditor(b.dataset.personEdit))}
  togglePerson=async function(id){await mutateIdentityRegistry(list=>list.map(p=>p.id===id?{...p,codexConversationEnabled:!p.codexConversationEnabled}:p))}
  deletePerson=async function(id,label){await mutateIdentityRegistry(list=>{const p=list.find(x=>x.id===id);if(!p)return null;if((p.linkedInputAccountIds||[]).length){alert('Esta persona sigue vinculada a una cuenta.');return null}if(!confirm('¿Quitar “'+(label||p.displayName)+'” de Personas?'))return null;return list.filter(x=>x.id!==id)})}

  function openPersonEditor(id){const p=identities().find(x=>x.id===id);if(!p)return;editingPersonId=id;document.getElementById('edit-person-name').value=p.displayName||'';document.getElementById('edit-person-nick').value=p.nickname||'';document.getElementById('edit-person-phones').value=(p.phoneNumbers||[]).join(', ');document.getElementById('edit-person-role').value=p.role||'member';document.getElementById('edit-person-codex').checked=p.codexConversationEnabled!==false;openModal('person-edit-modal')}
  document.getElementById('edit-person-save').onclick=async()=>{const id=editingPersonId,name=document.getElementById('edit-person-name').value.trim(),nick=document.getElementById('edit-person-nick').value.trim(),phones=parsePhoneList(document.getElementById('edit-person-phones').value),role=document.getElementById('edit-person-role').value,codex=document.getElementById('edit-person-codex').checked;if(!name){alert('Falta el nombre.');return}const ok=await mutateIdentityRegistry(list=>list.map(p=>p.id===id?{...p,displayName:name,nickname:nick||name.split(/\s+/)[0],phoneNumbers:phones,role,codexConversationEnabled:codex}:p));if(ok)closeModal('person-edit-modal')}

  document.getElementById('add-person').onclick=()=>{['person-name','person-nick','person-phone'].forEach(id=>document.getElementById(id).value='');document.getElementById('person-role').value='member';document.getElementById('person-codex').checked=true;openModal('person-modal')};
  document.getElementById('save-person').onclick=async()=>{const name=document.getElementById('person-name').value.trim(),nick=document.getElementById('person-nick').value.trim(),phone=document.getElementById('person-phone').value.replace(/\D/g,'');if(!name){alert('Falta el nombre.');return}const ok=await mutateIdentityRegistry(list=>[...list,{id:'manual-'+Date.now().toString(36),displayName:name,nickname:nick||name.split(/\s+/)[0],role:document.getElementById('person-role').value,phoneNumbers:phone?[phone]:[],linkedInputAccountIds:[],codexConversationEnabled:document.getElementById('person-codex').checked,source:'manual'}]);if(ok)closeModal('person-modal')};

  function archiveRow(m){const when=m.occurredAt?new Date(m.occurredAt).toLocaleString():'—';const who=[m.accountLabel,m.chatName||m.chatJid,m.senderName].filter(Boolean).join(' · ');return '<div class="message"><div class="small muted">'+esc(when)+(who?' · '+esc(who):'')+'</div><div class="message-text">'+esc(m.text||'['+(m.messageType||m.kind||'mensaje sin texto')+']')+'</div></div>'}
  function showArchive(items){const slot=document.getElementById('archive-results');slot.innerHTML=items?.length?items.map(archiveRow).join(''):'<div class="empty">Sin resultados.</div>'}
  async function archiveRecent(){const out=await api('/api/messages/recent?limit=40');if(!out.r.ok){showArchive([]);return}showArchive(out.b.messages||[])}
  document.getElementById('archive-recent').onclick=archiveRecent;
  document.getElementById('archive-search').onclick=async()=>{const q=document.getElementById('archive-query').value.trim();if(q.length<2){alert('Escribí al menos dos caracteres.');return}const out=await api('/api/messages/search',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({query:q,limit:Number(state.settings?.settings?.maxSearchResults||80)})});if(!out.r.ok){alert(out.b.error||'No se pudo buscar');return}showArchive(out.b.messages||[])};
  document.getElementById('archive-query').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();document.getElementById('archive-search').click()}};
  document.querySelectorAll('[data-nav="archive"]').forEach(b=>b.addEventListener('click',()=>archiveRecent()));

  function renderAdvanced(){const s=state.settings?.settings||state.data?.settings||{},meta=state.settings||{},llm=s.llm||{},conv=s.outputConversation||{},worker=s.codexWorker||{};const win=document.getElementById('adv-win');win.checked=!!meta.windowsAutostart;win.disabled=meta.platform!=='win32';document.getElementById('adv-search-max').value=s.maxSearchResults||80;document.getElementById('adv-context-max').value=conv.maxContextMessages||80;document.getElementById('adv-worker-poll').value=worker.pollIntervalMs||1500;document.getElementById('adv-worker-debounce').value=worker.debounceMs||1800;document.getElementById('adv-worker-timeout').value=worker.timeoutSeconds||180;document.getElementById('adv-worker-batch').value=worker.maxBatchMessages||8;document.getElementById('adv-llm-enabled').checked=!!llm.enabled;document.getElementById('adv-llm-url').value=llm.baseUrl||'';document.getElementById('adv-llm-model').value=llm.model||'';document.getElementById('adv-llm-temp').value=llm.temperature??0.2;document.getElementById('adv-llm-max').value=llm.maxInputMessages||500;document.getElementById('adv-llm-lookback').value=llm.defaultLookbackDays||3;document.getElementById('adv-llm-prompt').value=llm.systemPrompt||'';document.getElementById('adv-llm-key').value='';document.getElementById('llm-key-state').textContent=meta.llmApiKeyConfigured?'API key configurada':'API key no configurada'}
  renderSettings=function(){originalRenderSettings();renderAdvanced()}
  document.getElementById('advanced-form').onsubmit=async e=>{e.preventDefault();const status=document.getElementById('adv-status'),key=document.getElementById('adv-llm-key').value;status.className='small muted';status.textContent='Guardando…';const payload={maxSearchResults:Number(document.getElementById('adv-search-max').value),windowsAutostart:document.getElementById('adv-win').checked,outputConversation:{maxContextMessages:Number(document.getElementById('adv-context-max').value)},codexWorker:{pollIntervalMs:Number(document.getElementById('adv-worker-poll').value),debounceMs:Number(document.getElementById('adv-worker-debounce').value),timeoutSeconds:Number(document.getElementById('adv-worker-timeout').value),maxBatchMessages:Number(document.getElementById('adv-worker-batch').value)},llm:{enabled:document.getElementById('adv-llm-enabled').checked,baseUrl:document.getElementById('adv-llm-url').value.trim(),model:document.getElementById('adv-llm-model').value.trim(),temperature:Number(document.getElementById('adv-llm-temp').value),maxInputMessages:Number(document.getElementById('adv-llm-max').value),defaultLookbackDays:Number(document.getElementById('adv-llm-lookback').value),systemPrompt:document.getElementById('adv-llm-prompt').value}};if(key)payload.llmApiKey=key;const out=await api('/api/settings',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});status.className='small '+(out.r.ok?'good':'error');status.textContent=out.r.ok?'Configuración avanzada guardada.':(out.b.error||'Error');if(out.r.ok){await loadSettings();renderAdvanced()}};
  document.getElementById('adv-test-llm').onclick=async()=>{const status=document.getElementById('adv-status');status.className='small muted';status.textContent='Resumiendo actividad reciente…';const out=await api('/api/llm/summarize',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({limit:80,focus:'Prueba de configuración: resumen breve de actividad reciente y vigente'})});status.className='small '+(out.r.ok?'good':'error');status.textContent=out.r.ok?('Resumen: '+(out.b.summary||'sin texto')):(out.b.error||'Error')};

  document.querySelectorAll('#person-edit-modal [data-close]').forEach(b=>b.onclick=()=>closeModal(b.dataset.close));document.getElementById('person-edit-modal').onclick=e=>{if(e.target===document.getElementById('person-edit-modal'))closeModal('person-edit-modal')};
  if((location.hash||'')==='#archive'){setSection('archive');archiveRecent()}
  if(state.active==='people')renderPeople();if(state.active==='settings')renderSettings();
})();
</script>
`;

  let out = html.replace("</style>", `${css}</style>`);
  out = out.replace(
    '<button data-nav="settings"><span class="ico">⚙</span><span class="txt">Configuración</span></button>',
    '<button data-nav="archive"><span class="ico">⌕</span><span class="txt">Archivo</span></button><button data-nav="settings"><span class="ico">⚙</span><span class="txt">Configuración</span></button>',
  );
  out = out.replace(
    '<button data-nav="settings"><span>⚙</span>Config</button>',
    '<button data-nav="archive"><span>⌕</span>Archivo</button><button data-nav="settings"><span>⚙</span>Config</button>',
  );
  out = out.replace(
    '    <section class="page section" data-section="settings">',
    `${archiveSection}\n    <section class="page section" data-section="settings">`,
  );
  out = out.replace(
    '<div id="runtime-info"></div></div></div>\n      </div>\n    </section>',
    `<div id="runtime-info"></div></div></div>\n${advancedSettings}      </div>\n    </section>`,
  );
  out = out.replace("<script>", `${editModal}\n<script>`);
  out = out.replace("</body>", `${extraScript}\n</body>`);
  return out;
}
