export function augmentCodexStatusUi(html: string): string {
  const extension = String.raw`
<style>
.codex-cli-state{margin-top:10px;padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:#0f1216;line-height:1.45}.codex-cli-state.good{border-color:rgba(84,214,138,.35)}.codex-cli-state.error{border-color:rgba(255,115,115,.4)}.codex-cli-path{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;overflow-wrap:anywhere;margin-top:4px}
</style>
<script>
(()=>{
  let busy=false;
  const hx=v=>String(v==null?'':v).replace(/[&<>'"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[ch]));
  const sourceLabel=source=>({env:'NEXO_CODEX_PATH','desktop-app':'App oficial de Codex',path:'PATH de Windows','npm-global':'npm global',winget:'WinGet',scoop:'Scoop','local-bin':'~/.local/bin',unavailable:'no encontrado'}[source]||source||'desconocido');
  async function sync(force){
    if(busy)return;busy=true;
    try{
      if(force){await fetch('/api/codex-worker/rediscover',{method:'POST',cache:'no-store'}).catch(()=>null)}
      const response=await fetch('/api/settings',{cache:'no-store'});if(!response.ok)return;
      const body=await response.json();const cli=(body.codexWorkerStatus||{}).codexCli||{};
      const refresh=document.getElementById('workerRefresh');if(!refresh)return;
      const fields=refresh.closest('.fields');if(!fields)return;
      let slot=document.getElementById('codexCliState');
      if(!slot){slot=document.createElement('div');slot.id='codexCliState';fields.insertAdjacentElement('afterend',slot)}
      const signature=JSON.stringify([Boolean(cli.available),Boolean(cli.toolsAvailable),cli.path||'',cli.codeModeHostPath||'',cli.source||'',cli.error||'']);
      if(slot.dataset.signature===signature)return;
      slot.dataset.signature=signature;
      const healthy=Boolean(cli.available&&cli.toolsAvailable!==false);
      slot.className='codex-cli-state small '+(healthy?'good':'error');
      if(healthy){
        slot.innerHTML='<strong>Codex CLI · listo</strong> <span class="muted">('+hx(sourceLabel(cli.source))+')</span><div class="codex-cli-path">'+hx(cli.path||'')+'</div>'+(cli.codeModeHostPath?'<div class="muted" style="margin-top:5px">Code Mode host ✓</div><div class="codex-cli-path">'+hx(cli.codeModeHostPath)+'</div>':'')+'<div class="muted" style="margin-top:5px">Nexo prepara PATH y los overrides internos de Codex automáticamente. <button id="codexRediscover" style="padding:4px 8px;margin-left:6px">Detectar nuevamente</button></div>';
      }else{
        const title=cli.path?'Codex Desktop · bundle incompleto':'Codex CLI · no encontrado';
        slot.innerHTML='<strong>'+title+'</strong><div class="error" style="margin-top:4px">'+hx(cli.error||'No se pudo preparar Codex con sus herramientas locales.')+'</div>'+(cli.path?'<div class="codex-cli-path">'+hx(cli.path)+'</div>':'')+'<div class="muted" style="margin-top:5px">Se revisa la app oficial (%LOCALAPPDATA%\\OpenAI\\Codex\\bin\\*), ~/.codex/plugins/.plugin-appserver, PATH, npm, WinGet y Scoop. <button id="codexRediscover" style="padding:4px 8px;margin-left:6px">Detectar nuevamente</button></div>';
      }
      const button=document.getElementById('codexRediscover');if(button)button.onclick=()=>sync(true);
    }catch{}finally{busy=false}
  }
  let queued=false;
  const observer=new MutationObserver(()=>{if(queued)return;queued=true;setTimeout(()=>{queued=false;sync(false)},30)});
  const app=document.getElementById('app');if(app)observer.observe(app,{childList:true,subtree:true});
  sync(false);
})();
</script>`;
  return html.replace("</body>", `${extension}\n</body>`);
}
