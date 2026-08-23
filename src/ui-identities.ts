export function augmentIdentityUi(html: string): string {
  const extension = String.raw`
<style>
.identity-grid{display:grid;gap:12px;margin-top:14px}.identity-item{border:1px solid var(--line);border-radius:14px;padding:14px;background:#0f1216}.identity-head{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}.identity-fields{display:grid;grid-template-columns:1.4fr 1fr .8fr 1.4fr;gap:9px;margin-top:12px}.identity-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px}.identity-source{font-size:11px;color:var(--muted);border:1px solid var(--line);padding:4px 7px;border-radius:999px}.identity-linked{font-size:12px;color:var(--muted);margin-top:8px}.identity-add{border:1px dashed var(--line);border-radius:14px;padding:14px;margin-top:14px}.identity-permission{display:flex;gap:8px;align-items:center;font-size:13px}.identity-permission input{width:auto}.identity-note{font-size:12px;color:var(--muted);line-height:1.5}@media(max-width:900px){.identity-fields{grid-template-columns:1fr 1fr}}@media(max-width:620px){.identity-fields{grid-template-columns:1fr}}
</style>
<script>
(()=>{
  const roles=['owner','adult','member','child','guest'];
  const roleLabels={owner:'Propietario',adult:'Adulto',member:'Miembro',child:'Menor',guest:'Invitado'};
  let rendering=false;
  const hx=v=>String(v==null?'':v).replace(/[&<>'"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[ch]));
  async function jsonFetch(path,options){
    const r=await fetch(path,Object.assign({cache:'no-store'},options||{}));
    let b={};try{b=await r.json()}catch{}
    if(!r.ok)throw new Error(b.error||('HTTP '+r.status));
    return b;
  }
  function phoneList(value){return String(value||'').split(/[\n,;]+/).map(v=>v.trim()).filter(Boolean)}
  function sourceLabel(identity){
    if(identity.source==='input')return 'WhatsApp INPUT';
    if(identity.source==='legacy')return 'Migrada de allowlist';
    return 'Manual';
  }
  function roleOptions(current){return roles.map(role=>'<option value="'+role+'" '+(role===current?'selected':'')+'>'+roleLabels[role]+'</option>').join('')}
  function syncTechnicalAllowlist(settings){
    const textarea=document.getElementById('convNumbers');
    if(!textarea)return;
    textarea.value=(settings.outputConversation.authorizedNumbers||[]).join(String.fromCharCode(10));
    textarea.readOnly=true;
    textarea.title='Derivada automáticamente de Personas e identidades';
    textarea.style.opacity='.65';
    const label=textarea.closest('.field')&&textarea.closest('.field').querySelector('label');
    if(label)label.textContent='Allowlist técnica · derivada de identidades';
  }
  async function saveRegistry(identities){
    await jsonFetch('/api/settings',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({outputConversation:{identities}})});
  }
  async function draw(section){
    if(rendering)return;rendering=true;
    try{
      const [settingsResponse,state]=await Promise.all([jsonFetch('/api/settings'),jsonFetch('/api/state')]);
      const settings=settingsResponse.settings;
      syncTechnicalAllowlist(settings);
      const identities=settings.outputConversation.identities||[];
      const accountNames=new Map((state.accounts||[]).map(a=>[a.id,a.label+(a.phoneJid?' · '+String(a.phoneJid).split('@')[0]:'')]));
      let h='<div class="row"><div><div class="section-title">Personas e identidades</div><div class="identity-note">Los WhatsApp INPUT vinculados se registran acá automáticamente y quedan habilitados para hablar con Codex por defecto. El número autentica; nombre, apodo y rol le dan contexto humano a Nexo y al MCP.</div></div><span class="badge">'+identities.length+' identidad(es)</span></div>';
      h+='<div class="identity-grid">';
      for(const identity of identities){
        const linked=(identity.linkedInputAccountIds||[]).map(id=>accountNames.get(id)||id);
        h+='<div class="identity-item" data-identity="'+hx(identity.id)+'"><div class="identity-head"><div><strong>'+hx(identity.displayName)+'</strong> <span class="identity-source">'+hx(sourceLabel(identity))+'</span></div><label class="identity-permission"><input data-f="allowed" type="checkbox" '+(identity.codexConversationEnabled?'checked':'')+'> Puede hablar con Codex</label></div>';
        h+='<div class="identity-fields"><div class="field"><label>Nombre</label><input data-f="name" maxlength="160" value="'+hx(identity.displayName)+'"></div><div class="field"><label>Apodo</label><input data-f="nick" maxlength="80" value="'+hx(identity.nickname||'')+'"></div><div class="field"><label>Rol</label><select data-f="role">'+roleOptions(identity.role)+'</select></div><div class="field"><label>Teléfono(s)</label><input data-f="phones" value="'+hx((identity.phoneNumbers||[]).map(p=>'+'+p).join(', '))+'"></div></div>';
        if(linked.length)h+='<div class="identity-linked">INPUT asociado: '+linked.map(hx).join(' · ')+'</div>';
        h+='<div class="identity-actions"><button data-save-identity="'+hx(identity.id)+'" class="primary">Guardar identidad</button>'+(identity.source==='manual'&&!linked.length?'<button data-delete-identity="'+hx(identity.id)+'" class="danger">Eliminar</button>':'')+'<span class="small muted">ID MCP: '+hx(identity.id)+'</span></div></div>';
      }
      if(!identities.length)h+='<div class="muted small">Todavía no hay identidades. Al vincular un INPUT aparecerá automáticamente.</div>';
      h+='</div>';
      h+='<div class="identity-add"><strong>Agregar identidad manual</strong><div class="identity-note" style="margin-top:4px">Para alguien que puede hablar con Codex aunque no tenga una cuenta INPUT vinculada.</div><div class="identity-fields"><div class="field"><label>Nombre</label><input id="identityNewName" placeholder="Ej: Mariana Núñez"></div><div class="field"><label>Apodo</label><input id="identityNewNick" placeholder="Ej: Mari"></div><div class="field"><label>Rol</label><select id="identityNewRole">'+roleOptions('member')+'</select></div><div class="field"><label>Teléfono</label><input id="identityNewPhone" placeholder="+54 9 ..."></div></div><div class="identity-actions"><label class="identity-permission"><input id="identityNewAllowed" type="checkbox" checked> Puede hablar con Codex</label><button id="identityAdd" class="primary">Agregar persona</button><span id="identityStatus" class="small muted"></span></div></div>';
      section.innerHTML=h;

      section.querySelectorAll('[data-save-identity]').forEach(button=>button.addEventListener('click',async()=>{
        const id=button.getAttribute('data-save-identity');
        const row=section.querySelector('[data-identity="'+CSS.escape(id)+'"]');
        const status=section.querySelector('#identityStatus');
        button.disabled=true;
        try{
          const latest=await jsonFetch('/api/settings');
          const next=(latest.settings.outputConversation.identities||[]).map(item=>item.id!==id?item:Object.assign({},item,{
            displayName:row.querySelector('[data-f="name"]').value,
            nickname:row.querySelector('[data-f="nick"]').value,
            role:row.querySelector('[data-f="role"]').value,
            phoneNumbers:phoneList(row.querySelector('[data-f="phones"]').value),
            codexConversationEnabled:row.querySelector('[data-f="allowed"]').checked
          }));
          await saveRegistry(next);if(status)status.textContent='Identidad guardada.';await drawFresh(section);
        }catch(error){alert('No se pudo guardar la identidad: '+error.message)}finally{button.disabled=false}
      }));
      section.querySelectorAll('[data-delete-identity]').forEach(button=>button.addEventListener('click',async()=>{
        const id=button.getAttribute('data-delete-identity');
        if(!confirm('¿Eliminar esta identidad manual?'))return;
        try{const latest=await jsonFetch('/api/settings');await saveRegistry((latest.settings.outputConversation.identities||[]).filter(item=>item.id!==id));await drawFresh(section)}catch(error){alert('No se pudo eliminar: '+error.message)}
      }));
      const add=section.querySelector('#identityAdd');
      if(add)add.addEventListener('click',async()=>{
        const name=section.querySelector('#identityNewName').value.trim();
        const nick=section.querySelector('#identityNewNick').value.trim();
        const phone=section.querySelector('#identityNewPhone').value.trim();
        if(!name||!phone){alert('Nombre y teléfono son obligatorios.');return}
        add.disabled=true;
        try{
          const latest=await jsonFetch('/api/settings');
          const identities=[...(latest.settings.outputConversation.identities||[])];
          identities.push({id:'manual-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,7),displayName:name,nickname:nick||name.split(/\s+/)[0],role:section.querySelector('#identityNewRole').value,phoneNumbers:[phone],linkedInputAccountIds:[],codexConversationEnabled:section.querySelector('#identityNewAllowed').checked,source:'manual'});
          await saveRegistry(identities);await drawFresh(section);
        }catch(error){alert('No se pudo agregar la identidad: '+error.message)}finally{add.disabled=false}
      });
    }catch(error){section.innerHTML='<div class="section-title">Personas e identidades</div><div class="error small">'+hx(error.message)+'</div>'}
    finally{rendering=false}
  }
  async function drawFresh(section){rendering=false;await draw(section)}
  async function ensure(){
    const grid=document.querySelector('#app .grid');
    if(!grid)return;
    const settingsResponse=await jsonFetch('/api/settings').catch(()=>null);
    if(settingsResponse)syncTechnicalAllowlist(settingsResponse.settings);
    let section=document.getElementById('identityRegistry');
    if(section)return;
    section=document.createElement('section');section.id='identityRegistry';section.className='card wide';section.innerHTML='<div class="muted small">Cargando identidades…</div>';
    const settingsCard=[...grid.children].find(node=>node.textContent&&node.textContent.includes('Configuración'));
    if(settingsCard)grid.insertBefore(section,settingsCard);else grid.appendChild(section);
    await draw(section);
  }
  let queued=false;
  const observer=new MutationObserver(()=>{if(queued)return;queued=true;setTimeout(()=>{queued=false;ensure().catch(()=>{})},0)});
  const app=document.getElementById('app');if(app)observer.observe(app,{childList:true,subtree:true});
  ensure().catch(()=>{});
})();
</script>`;
  return html.replace("</body>", `${extension}\n</body>`);
}
