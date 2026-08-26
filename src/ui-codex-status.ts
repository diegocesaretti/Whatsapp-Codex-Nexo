export function augmentCodexStatusUi(html: string): string {
  const extension = String.raw`
<style>
.codex-cli-state{margin-top:10px;padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:#0f1216;line-height:1.45}.codex-cli-state.good{border-color:rgba(84,214,138,.35)}.codex-cli-state.error{border-color:rgba(255,115,115,.4)}.codex-cli-path{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;overflow-wrap:anywhere;margin-top:4px}
</style>
<script>
(()=>{
  let busy=false;
  const hx=v=>String(v==null?'':v).replace(/[&<>'\"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','\"':'&quot;'}[ch]));
  const sourceLabel=source=>({env:'NEXO_CODEX_PATH',path:'PATH de Windows','desktop-app':'Bundle local de Codex','npm-global':'npm global',winget:'WinGet',scoop:'Scoop','local-bin':'~/.local/bin','msix-appx':'Microsoft Store / AppX',unavailable:'no encontrado'}[source]||source||'desconocido');
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
      const signature=JSON.stringify([Boolean(cli.available),Boolean(cli.toolsAvailable),cli.path||'',cli.bundleDir||'',cli.codeModeHostPath||'',cli.commandRunnerPath||'',cli.sandboxSetupPath||'',cli.source||'',cli.packageVersion||'',cli.installLocation||'',JSON.stringify(cli.missingBundleFiles||[]),cli.error||'']);
      if(slot.dataset.signature===signature)return;
      slot.dataset.signature=signature;
      const healthy=Boolean(cli.available&&cli.toolsAvailable===true);
      slot.className='codex-cli-state small '+(healthy?'good':'error');
      const packageInfo=cli.source==='msix-appx'&&cli.packageVersion?'<div class="muted" style="margin-top:5px">Paquete activo · '+hx(cli.packageVersion)+'</div>':'';
      const installInfo=cli.source==='msix-appx'&&cli.installLocation?'<div class="codex-cli-path">'+hx(cli.installLocation)+'</div>':'';
      const bundleInfo=cli.bundleDir?'<div class="muted" style="margin-top:5px">Bundle</div><div class="codex-cli-path">'+hx(cli.bundleDir)+'</div>':'';
      const missing=(cli.missingBundleFiles||[]).length?'<div class="error" style="margin-top:5px">Faltan: '+hx((cli.missingBundleFiles||[]).join(', '))+'</div>':'';
      if(healthy){
        slot.innerHTML='<strong>Codex CLI · listo · toolsAvailable ✓</strong> <span class="muted">('+hx(sourceLabel(cli.source))+')</span>'+packageInfo+installInfo+bundleInfo+'<div class="codex-cli-path">'+hx(cli.path||'')+'</div>'+(cli.codeModeHostPath?'<div class="muted" style="margin-top:5px">Code Mode host ✓</div><div class="codex-cli-path">'+hx(cli.codeModeHostPath)+'</div>':'')+(cli.commandRunnerPath?'<div class="muted" style="margin-top:5px">Command runner ✓</div><div class="codex-cli-path">'+hx(cli.commandRunnerPath)+'</div>':'')+(cli.sandboxSetupPath?'<div class="muted" style="margin-top:5px">Windows sandbox setup ✓</div><div class="codex-cli-path">'+hx(cli.sandboxSetupPath)+'</div>':'')+'<div class="muted" style="margin-top:5px">Nexo exige los cuatro ejecutables del bundle en el mismo directorio. <button id="codexRediscover" style="padding:4px 8px;margin-left:6px">Detectar nuevamente</button></div>';
      }else{
        const title=cli.path?'Codex · bundle incompleto':'Codex CLI · no encontrado';
        slot.innerHTML='<strong>'+title+'</strong>'+packageInfo+installInfo+bundleInfo+'<div class="error" style="margin-top:4px">'+hx(cli.error||'No se pudo preparar Codex con sus herramientas locales.')+'</div>'+missing+(cli.path?'<div class="codex-cli-path">'+hx(cli.path)+'</div>':'')+'<div class="muted" style="margin-top:5px">Orden: NEXO_CODEX_PATH → PATH → %LOCALAPPDATA%\\OpenAI\\Codex\\bin\\&lt;versión&gt; → npm → WinGet → Scoop → ~/.local/bin; AppX queda como fallback. Los candidatos incompletos se descartan y se sigue buscando. <button id="codexRediscover" style="padding:4px 8px;margin-left:6px">Detectar nuevamente</button></div>';
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
