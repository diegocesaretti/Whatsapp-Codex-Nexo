const advancedSettingsPanel = String.raw`
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

export function ensureAdvancedSettingsPanel(html: string): string {
  if (html.includes('id="advanced-form"')) return html;
  const marker = '<div id="runtime-info"></div></div>\n      </div>\n    </section>';
  if (!html.includes(marker)) {
    throw new Error("nexo_v5_settings_panel_anchor_not_found");
  }
  return html.replace(
    marker,
    `<div id="runtime-info"></div></div>\n${advancedSettingsPanel}      </div>\n    </section>`,
  );
}
