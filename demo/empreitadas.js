// ══════════════════════════════════════════════════════════════════
//  EMPREITADAS FSBF — demonstração (só no beta3)
// ══════════════════════════════════════════════════════════════════
//
// Ecrã à parte, carregado pela página principal. Usa o que ela já tem:
// apiFetch, esc, toast, openModal/closeModal e o Leaflet.
//
// Propostas chegam de uma fonte externa (o plano de actividades no formato
// do SISF); a empreitada nasce de uma delas ou é desenhada de raiz no mapa.
(function () {
  'use strict';

  // Cor por modo de execução: é o que diz, à primeira vista, que meios a
  // operação vai pedir. Valores que se lêem nos mapas claro e escuro.
  const MODOS = {
    'mecanico':    { cor: '#d08a2c', nome: 'Mecânico' },
    'moto-manual': { cor: '#5fae5f', nome: 'Moto-manual' },
    'rede-viaria': { cor: '#a8754a', nome: 'Rede viária' },
    'fogo':        { cor: '#e05050', nome: 'Fogo controlado' },
    'quimico':     { cor: '#9b6fd1', nome: 'Químico' },
    'manual':      { cor: '#429abd', nome: 'Manual' },
  };
  const POV    = { 1: 'Resinosas', 2: 'Folhosas', 3: 'Mistos', 4: 'Matos / incultos' };
  const FGC    = { FIC: 'Faixa de interrupção de combustível', FRC: 'Faixa de redução de combustível' };
  const ELEM   = { RVF: 'Rede viária florestal', LA: 'Linha de água', OUI: 'Outra infraestrutura' };
  const FIN    = { SP: 'Serviço Público', SN: 'Serviço Normal (autofinanciamento)' };
  const TRIM   = { '1T': '1.º trimestre', '2T': '2.º trimestre', '3T': '3.º trimestre', '4T': '4.º trimestre' };
  const ESTADOS = {
    seleccionada: { nome: 'Seleccionada', cor: 'var(--accent3)' },
    planeada:     { nome: 'Planeada',     cor: 'var(--accent)' },
    em_execucao:  { nome: 'Em execução',  cor: 'var(--warn)' },
    concluida:    { nome: 'Concluída',    cor: 'var(--success)' },
    cancelada:    { nome: 'Cancelada',    cor: 'var(--muted)' },
  };

  const st = {
    montado: false, aba: 'propostas', cat: null, propostas: [], empreitadas: [],
    filtro: { base: '', modo: '', estado: '', q: '' },
    sel: null,               // { tipo: 'proposta'|'empreitada', id }
    mapa: null, camadas: null, mosaico: null, porId: new Map(),
    desenho: null,           // { tipo, pts, camada }
  };

  // O Leaflet escreve a cor como atributo SVG, e aí var(--x) não vale:
  // lê-se o valor do token no momento de desenhar.
  const tok = nome => getComputedStyle(document.documentElement).getPropertyValue(nome).trim() || '#888';
  const fmt = (n, c = 1) => Number(n).toLocaleString('pt-PT', { minimumFractionDigits: c, maximumFractionDigits: c });
  const opDe = cod => st.cat?.operacoes.find(o => o.codigo === cod);
  const corDe = cod => MODOS[opDe(cod)?.modo]?.cor || '#888';
  const medida = x => x.area_ha != null ? `${fmt(x.area_ha)} ha` : `${fmt(x.comprimento_km, 2)} km`;

  // ── Estilos próprios do ecrã ────────────────────────────────────
  const CSS = `
    #page-empreitadas .emp-barra{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:14px}
    #page-empreitadas .emp-barra .icnf-tabs{margin:0;border:none;flex:0 0 auto}
    #page-empreitadas .emp-filtros{display:flex;gap:8px;flex-wrap:wrap;flex:1;justify-content:flex-end;align-items:center}
    #page-empreitadas .emp-filtros .form-input,#page-empreitadas .emp-filtros .form-select{font-size:12px;padding:5px 8px}
    #page-empreitadas .emp-grelha{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(320px,1fr);gap:16px;align-items:start}
    #page-empreitadas .emp-mapa-wrap{position:relative;border:1px solid var(--border);background:var(--surface2)}
    #emp-mapa{height:calc(100vh - 230px);min-height:420px}
    #page-empreitadas .emp-legenda{position:absolute;left:10px;bottom:22px;z-index:500;background:var(--surface);border:1px solid var(--border);
      padding:8px 10px;font-size:11px;display:grid;gap:3px;pointer-events:none}
    #page-empreitadas .emp-legenda i{display:inline-block;width:10px;height:10px;margin-right:6px;vertical-align:-1px;border-radius:2px}
    #page-empreitadas .emp-desenho{position:absolute;top:10px;left:50%;transform:translateX(-50%);z-index:600;background:var(--surface);
      border:1px solid var(--accent);padding:8px 12px;display:flex;gap:8px;align-items:center;font-size:12px;flex-wrap:wrap;max-width:94%}
    #page-empreitadas .emp-lado{display:flex;flex-direction:column;gap:12px;min-width:0}
    #page-empreitadas .emp-lista{border:1px solid var(--border);background:var(--surface);max-height:calc(100vh - 230px);overflow-y:auto}
    #page-empreitadas .emp-item{display:grid;grid-template-columns:12px 1fr auto;gap:10px;align-items:center;padding:9px 12px;
      border-bottom:1px solid var(--border);cursor:pointer}
    #page-empreitadas .emp-item:hover{background:var(--surface2)}
    #page-empreitadas .emp-item.sel{background:var(--s-alpha);box-shadow:inset 3px 0 0 var(--accent)}
    #page-empreitadas .emp-item.tomada{opacity:.55}
    #page-empreitadas .emp-ponto{width:12px;height:12px;border-radius:2px}
    #page-empreitadas .emp-item .t{font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #page-empreitadas .emp-item .s{font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--muted);margin-top:2px}
    #page-empreitadas .emp-item .d{font-family:'IBM Plex Mono',monospace;font-size:11px;font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}
    #page-empreitadas .emp-det{border:1px solid var(--border);background:var(--surface);padding:16px 18px}
    #page-empreitadas .emp-det h3{font-family:'Barlow Condensed',sans-serif;font-size:19px;font-weight:700;letter-spacing:.03em;margin:4px 0 2px;text-wrap:balance}
    #page-empreitadas .emp-eyebrow{font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
    #page-empreitadas .emp-attrs{display:grid;grid-template-columns:auto 1fr;gap:5px 14px;margin:14px 0;font-size:12px}
    #page-empreitadas .emp-attrs dt{font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--muted);letter-spacing:.06em;padding-top:2px}
    #page-empreitadas .emp-attrs dd{margin:0}
    #page-empreitadas .emp-attrs code{font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--accent3);margin-right:6px}
    #page-empreitadas .emp-acoes{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}
    #page-empreitadas .emp-ops,#emp-modal .emp-ops{width:100%;border-collapse:collapse;font-size:12px;margin-top:6px}
    #page-empreitadas .emp-ops td,#emp-modal .emp-ops td{padding:4px 4px 4px 0;vertical-align:middle}
    #page-empreitadas .emp-ops .form-select,#page-empreitadas .emp-ops .form-input,#emp-modal .emp-ops .form-select,#emp-modal .emp-ops .form-input{font-size:12px;padding:5px 7px;width:100%}
    #page-empreitadas .emp-aviso{font-size:11px;color:var(--muted);border-left:2px solid var(--warn);padding:4px 0 4px 8px;margin-top:12px}
    #page-empreitadas .emp-pill{display:inline-block;padding:2px 8px;border-radius:20px;font-size:10px;font-weight:600;
      font-family:'IBM Plex Mono',monospace;border:1px solid currentColor}
    #page-empreitadas .emp-vazio{padding:28px 16px;color:var(--muted);font-size:12px;text-align:center}
    #page-empreitadas .emp-campos{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px}
    #page-empreitadas .emp-campos .form-field.span2{grid-column:span 2}
    #page-empreitadas .emp-campos .form-input,#page-empreitadas .emp-campos .form-select,#page-empreitadas .emp-campos .form-textarea{font-size:12px;padding:6px 8px}
    @media (max-width:980px){
      #page-empreitadas .emp-grelha{grid-template-columns:1fr}
      #emp-mapa{height:56vh;min-height:320px}
      #page-empreitadas .emp-lista{max-height:none}
      #page-empreitadas .emp-filtros{justify-content:flex-start}
    }`;

  // ── Montagem ───────────────────────────────────────────────────
  function montar() {
    const pag = document.getElementById('page-empreitadas');
    const estilo = document.createElement('style');
    estilo.textContent = CSS;
    document.head.appendChild(estilo);
    pag.innerHTML = `
      <div class="emp-barra">
        <div class="icnf-tabs">
          <button class="icnf-tab-btn active" data-aba="propostas">Propostas <span id="emp-n-prop"></span></button>
          <button class="icnf-tab-btn" data-aba="empreitadas">Empreitadas <span id="emp-n-emp"></span></button>
        </div>
        <div class="emp-filtros">
          <input class="form-input" id="emp-f-q" placeholder="Procurar nome ou código…" style="width:170px"/>
          <select class="form-select" id="emp-f-base"><option value="">Todas as bases</option></select>
          <select class="form-select" id="emp-f-modo"><option value="">Todos os modos</option></select>
          <select class="form-select" id="emp-f-estado" style="display:none"><option value="">Todos os estados</option></select>
          <button class="btn btn-primary btn-sm" id="emp-btn-nova">+ Nova empreitada</button>
        </div>
      </div>
      <div class="emp-grelha">
        <div class="emp-mapa-wrap">
          <div id="emp-mapa"></div>
          <div class="emp-legenda" id="emp-legenda"></div>
          <div class="emp-desenho" id="emp-desenho" style="display:none"></div>
        </div>
        <div class="emp-lado">
          <div class="emp-det" id="emp-det"></div>
          <div class="emp-lista" id="emp-lista"></div>
        </div>
      </div>`;

    pag.querySelectorAll('[data-aba]').forEach(b => b.onclick = () => mudarAba(b.dataset.aba));
    const f = st.filtro;
    pag.querySelector('#emp-f-q').oninput      = e => { f.q = e.target.value.trim().toLowerCase(); desenharTudo(); };
    pag.querySelector('#emp-f-base').onchange  = e => { f.base = e.target.value; desenharTudo(); };
    pag.querySelector('#emp-f-modo').onchange  = e => { f.modo = e.target.value; desenharTudo(); };
    pag.querySelector('#emp-f-estado').onchange = e => { f.estado = e.target.value; desenharTudo(); };
    pag.querySelector('#emp-btn-nova').onclick = () => iniciarDesenho();

    document.getElementById('emp-legenda').innerHTML =
      Object.values(MODOS).map(m => `<div><i style="background:${m.cor}"></i>${m.nome}</div>`).join('') +
      `<div style="margin-top:4px;color:var(--muted)">tracejado = proposta · cheio = empreitada</div>`;

    criarModal();
    st.montado = true;
  }

  function criarMapa() {
    st.mapa = L.map('emp-mapa', { zoomControl: true }).setView([39.7, -8.0], 7);
    st.camadas = L.featureGroup().addTo(st.mapa);
    aplicarMosaico();
    // O tema muda com o botão da barra de topo: acompanha-se a classe no <html>.
    new MutationObserver(aplicarMosaico).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    st.mapa.on('click', e => { if (st.desenho) juntarVertice(e.latlng); });
    st.mapa.on('dblclick', e => { if (st.desenho) { L.DomEvent.stop(e); concluirDesenho(); } });
    for (const b of st.cat.bases)
      L.circleMarker([b.lat, b.lon], { radius: 5, color: tok('--text'), weight: 1.5, fillColor: '#fff', fillOpacity: .9 })
        .bindTooltip(`Base FSBF · ${esc(b.nome)}`).addTo(st.mapa);
  }

  function aplicarMosaico() {
    if (!st.mapa) return;
    const claro = document.documentElement.classList.contains('theme-light');
    const chave = window.EMP_CARTO_KEY;
    const qs = chave && !chave.startsWith('__') ? `?key=${chave}` : '';
    if (st.mosaico) st.mapa.removeLayer(st.mosaico);
    st.mosaico = L.tileLayer(`https://{s}.basemaps.cartocdn.com/${claro ? 'light_all' : 'dark_all'}/{z}/{x}/{y}{r}.png${qs}`, {
      attribution: '&copy; <a href="https://www.openstreetmap.org/">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
      subdomains: 'abcd', maxZoom: 19,
    }).addTo(st.mapa);
    st.mosaico.bringToBack();
  }

  // ── Dados ──────────────────────────────────────────────────────
  async function carregar() {
    const pedidos = [apiFetch('/api/demo/propostas'), apiFetch('/api/demo/empreitadas')];
    if (!st.cat) pedidos.push(apiFetch('/api/demo/catalogos'));
    const [p, e, c] = await Promise.all(pedidos);
    const falha = [p, e, c].find(x => x && x.error);
    if (falha) { toast(falha.error.message, 'err'); return false; }
    st.propostas = p.data;
    st.empreitadas = e.data;
    if (c) {
      st.cat = c.data;
      const sb = document.getElementById('emp-f-base');
      sb.innerHTML += st.cat.bases.map(b => `<option>${esc(b.nome)}</option>`).join('');
      document.getElementById('emp-f-modo').innerHTML += Object.entries(MODOS)
        .map(([k, m]) => `<option value="${k}">${m.nome}</option>`).join('');
      document.getElementById('emp-f-estado').innerHTML += Object.entries(ESTADOS)
        .map(([k, s]) => `<option value="${k}">${s.nome}</option>`).join('');
    }
    return true;
  }

  // ── Desenho ────────────────────────────────────────────────────
  function filtrados() {
    const f = st.filtro;
    const modoDe = x => st.aba === 'propostas' ? opDe(x.interv)?.modo : x.operacoes.map(o => o.modo);
    const lista = st.aba === 'propostas' ? st.propostas : st.empreitadas;
    return lista.filter(x => {
      if (f.base && (x.base_proxima || x.base) !== f.base) return false;
      if (f.modo && ![].concat(modoDe(x)).includes(f.modo)) return false;
      if (st.aba === 'empreitadas' && f.estado && x.estado !== f.estado) return false;
      if (f.q && !`${x.nome} ${x.codigo || ''} ${x.interv || ''}`.toLowerCase().includes(f.q)) return false;
      return true;
    });
  }

  function desenharTudo() {
    document.getElementById('emp-n-prop').textContent = `(${st.propostas.filter(p => !p.empreitada_id).length})`;
    document.getElementById('emp-n-emp').textContent = `(${st.empreitadas.length})`;
    document.getElementById('emp-f-estado').style.display = st.aba === 'empreitadas' ? '' : 'none';
    const itens = filtrados();
    desenharLista(itens);
    desenharMapa(itens);
    desenharDetalhe();
  }

  function desenharLista(itens) {
    const el = document.getElementById('emp-lista');
    if (!itens.length) {
      el.innerHTML = `<div class="emp-vazio">${st.aba === 'propostas'
        ? 'Nenhuma proposta com estes filtros.'
        : 'Ainda não há empreitadas. Escolha uma proposta e seleccione-a, ou desenhe uma nova no mapa.'}</div>`;
      return;
    }
    el.innerHTML = itens.map(x => {
      const ehP = st.aba === 'propostas';
      const sel = st.sel && st.sel.id === x.id && st.sel.tipo === (ehP ? 'proposta' : 'empreitada');
      const cor = ehP ? corDe(x.interv) : corDe(x.operacoes[0]?.operacao);
      const sub = ehP
        ? `${x.interv} · ${POV[x.tipo_pov]} · ${x.cod_equipa}${x.empreitada_codigo ? ' · → ' + x.empreitada_codigo : ''}`
        : `${x.codigo} · ${x.operacoes.map(o => o.operacao).join(', ')} · ${x.base || '—'}`;
      const dir = ehP ? medida(x)
        : `<span class="emp-pill" style="color:${ESTADOS[x.estado].cor}">${ESTADOS[x.estado].nome}</span>`;
      return `<div class="emp-item${sel ? ' sel' : ''}${ehP && x.empreitada_id ? ' tomada' : ''}" data-id="${x.id}">
        <span class="emp-ponto" style="background:${cor}"></span>
        <div style="min-width:0"><div class="t">${esc(x.nome)}</div><div class="s">${esc(sub)}</div></div>
        <div class="d">${dir}</div></div>`;
    }).join('');
    el.querySelectorAll('.emp-item').forEach(n => n.onclick = () =>
      seleccionar(st.aba === 'propostas' ? 'proposta' : 'empreitada', isNaN(n.dataset.id) ? n.dataset.id : +n.dataset.id, true));
  }

  function desenharMapa(itens) {
    st.camadas.clearLayers();
    st.porId.clear();
    const ehP = st.aba === 'propostas';
    for (const x of itens) {
      const cor = ehP ? corDe(x.interv) : corDe(x.operacoes[0]?.operacao);
      const sel = st.sel && st.sel.id === x.id;
      const tomada = ehP && x.empreitada_id;
      const estilo = {
        color: cor, weight: sel ? 4 : (x.geometria === 'linha' ? 3 : 2),
        dashArray: ehP ? '6 5' : null, opacity: tomada ? .45 : .95,
        fillColor: cor, fillOpacity: ehP ? (tomada ? .06 : .18) : .32,
      };
      const camada = L.geoJSON(x.geom, { style: () => estilo })
        .bindTooltip(`<b>${esc(x.nome)}</b><br>${ehP ? esc(x.interv) : esc(x.codigo)} · ${medida(x)}`, { sticky: true })
        .on('click', ev => { if (st.desenho) return; L.DomEvent.stop(ev); seleccionar(ehP ? 'proposta' : 'empreitada', x.id, false); });
      camada.addTo(st.camadas);
      st.porId.set(x.id, camada);
    }
    // As geometrias pequenas desaparecem quando o mapa está afastado; um
    // marcador no centro mantém-nas visíveis à escala do país.
    for (const x of itens) {
      const b = st.porId.get(x.id).getBounds().getCenter();
      L.circleMarker(b, { radius: 3, stroke: false, fillColor: ehP ? corDe(x.interv) : corDe(x.operacoes[0]?.operacao), fillOpacity: .9 })
        .on('click', () => seleccionar(ehP ? 'proposta' : 'empreitada', x.id, true)).addTo(st.camadas);
    }
  }

  function seleccionar(tipo, id, centrar) {
    if (st.desenho) return;
    st.sel = { tipo, id };
    desenharTudo();
    const c = st.porId.get(id);
    if (c && centrar) st.mapa.fitBounds(c.getBounds(), { maxZoom: 14, padding: [40, 40] });
    const item = document.querySelector(`#emp-lista .emp-item[data-id="${id}"]`);
    if (item) item.scrollIntoView({ block: 'nearest' });
  }

  function mudarAba(aba) {
    st.aba = aba;
    st.sel = null;
    document.querySelectorAll('#page-empreitadas [data-aba]').forEach(b => b.classList.toggle('active', b.dataset.aba === aba));
    desenharTudo();
    enquadrar();
  }

  function enquadrar() {
    const b = st.camadas.getBounds();
    if (b.isValid()) st.mapa.fitBounds(b, { padding: [30, 30], maxZoom: 11 });
  }

  // ── Painel de detalhe ──────────────────────────────────────────
  function desenharDetalhe() {
    const el = document.getElementById('emp-det');
    if (!st.sel) {
      el.innerHTML = st.aba === 'propostas'
        ? `<div class="emp-eyebrow">Plano de actividades · fonte externa</div>
           <h3>${st.propostas.length} propostas recebidas</h3>
           <p style="font-size:12px;color:var(--muted);margin:6px 0 0;line-height:1.5">
             Cada proposta é um elemento da camada PA do SISF: um polígono ou uma linha, com a intervenção
             pretendida (<code style="font-family:'IBM Plex Mono',monospace">INTERV</code>). Escolha uma no mapa ou na lista
             para a ver e seleccionar como empreitada. Se a que procura não está aqui, use «Nova empreitada» e desenhe-a.</p>`
        : `<div class="emp-eyebrow">Empreitadas</div>
           <h3>${st.empreitadas.length} empreitada${st.empreitadas.length === 1 ? '' : 's'}</h3>
           <p style="font-size:12px;color:var(--muted);margin:6px 0 0">Escolha uma para ver e editar.</p>`;
      return;
    }
    if (st.sel.tipo === 'proposta') detalheProposta(el, st.propostas.find(p => p.id === st.sel.id));
    else detalheEmpreitada(el, st.empreitadas.find(e => e.id === st.sel.id));
  }

  function detalheProposta(el, p) {
    if (!p) { el.innerHTML = ''; return; }
    const op = opDe(p.interv);
    const linha = (k, v) => v == null || v === '' ? '' : `<dt>${k}</dt><dd>${v}</dd>`;
    el.innerHTML = `
      <div class="emp-eyebrow">Proposta n.º ${p.id} · ${esc(p.fase)} ${p.ano} · ${esc(p.cod_equipa)}</div>
      <h3>${esc(p.nome)}</h3>
      <span class="emp-pill" style="color:${corDe(p.interv)}">${MODOS[op?.modo]?.nome || ''}</span>
      <dl class="emp-attrs">
        ${linha('INTERV', `<code>${esc(p.interv)}</code>${esc(op?.designacao || '')}`)}
        ${linha('TIPO_INTERV', p.tipo_interv != null ? `<code>${p.tipo_interv}</code>${esc(op?.tipo_interv_desc || '')}` : null)}
        ${linha('TIPO_ELEM', p.tipo_elem ? `<code>${p.tipo_elem}</code>${ELEM[p.tipo_elem]}` : null)}
        ${linha('TIPO_FGC', p.tipo_fgc ? `<code>${p.tipo_fgc}</code>${FGC[p.tipo_fgc]}` : null)}
        ${linha('TIPO_POV', `<code>${p.tipo_pov}</code>${POV[p.tipo_pov]}`)}
        ${linha(p.geometria === 'linha' ? 'Comprimento' : 'Área', medida(p))}
        ${linha('TRIM', `<code>${p.trim}</code>${TRIM[p.trim]}`)}
        ${linha('N_DIAS', `${p.n_dias} dias previstos pela equipa`)}
        ${linha('FIN', `<code>${p.fin}</code>${FIN[p.fin]}`)}
        ${linha('Base próxima', esc(p.base_proxima))}
        ${linha('OBSERV', p.observ ? esc(p.observ) : null)}
      </dl>
      <div class="emp-acoes">
        ${p.empreitada_id
          ? `<button class="btn btn-ghost btn-sm" id="emp-abrir">Abrir ${esc(p.empreitada_codigo)}</button>`
          : `<button class="btn btn-primary btn-sm" id="emp-escolher">Seleccionar como empreitada</button>`}
        <button class="btn btn-ghost btn-sm" id="emp-fechar">Fechar</button>
      </div>`;
    el.querySelector('#emp-fechar').onclick = () => { st.sel = null; desenharTudo(); };
    if (p.empreitada_id) el.querySelector('#emp-abrir').onclick = () => { mudarAba('empreitadas'); seleccionar('empreitada', p.empreitada_id, true); };
    else el.querySelector('#emp-escolher').onclick = () => criarDeProposta(p);
  }

  async function criarDeProposta(p) {
    const { data, error } = await apiFetch('/api/demo/empreitadas', { method: 'POST', body: JSON.stringify({ proposta_id: p.id }) });
    if (error) return toast(error.message, 'err');
    toast(`Empreitada ${data.codigo} criada a partir da proposta n.º ${p.id}.`);
    await carregar();
    mudarAba('empreitadas');
    seleccionar('empreitada', data.id, true);
  }

  // Linhas de operação editáveis. `geometria` restringe o catálogo: numa
  // linha só entram operações medidas em km.
  function linhasOperacoes(ops, geometria) {
    const opcoes = st.cat.operacoes.filter(o => o.geometria === geometria);
    const linha = o => `<tr>
      <td><select class="form-select emp-op-cod">${opcoes.map(c =>
        `<option value="${c.codigo}"${c.codigo === o.operacao ? ' selected' : ''}>${c.codigo} — ${esc(c.designacao)}</option>`).join('')}</select></td>
      <td style="width:92px"><input class="form-input emp-op-q" type="number" min="0.01" step="0.01" value="${o.quantidade ?? ''}"/></td>
      <td style="width:26px;font-size:11px;color:var(--muted)">${geometria === 'linha' ? 'km' : 'ha'}</td>
      <td style="width:28px"><button class="btn btn-ghost btn-xs emp-op-rem" title="Retirar operação">✕</button></td></tr>`;
    return { html: ops.map(linha).join(''), nova: q => linha({ operacao: opcoes[0].codigo, quantidade: q }) };
  }
  function ligarOperacoes(tabela, nova) {
    tabela.querySelectorAll('.emp-op-rem').forEach(b => b.onclick = () => b.closest('tr').remove());
    return () => { tabela.querySelector('tbody').insertAdjacentHTML('beforeend', nova()); ligarOperacoes(tabela, nova); };
  }
  function lerOperacoes(tabela) {
    return [...tabela.querySelectorAll('tbody tr')].map(tr => ({
      operacao: tr.querySelector('.emp-op-cod').value, quantidade: tr.querySelector('.emp-op-q').value,
    }));
  }

  function detalheEmpreitada(el, e) {
    if (!e) { el.innerHTML = ''; return; }
    const ops = linhasOperacoes(e.operacoes, e.geometria);
    const qDefeito = e.area_ha ?? e.comprimento_km;
    el.innerHTML = `
      <div class="emp-eyebrow">${esc(e.codigo)} · ${e.origem === 'proposta' ? `da proposta n.º ${e.proposta_id}` : 'criada de raiz'} · base ${esc(e.base || '—')}</div>
      <h3>${esc(e.nome)}</h3>
      <span class="emp-pill" style="color:${ESTADOS[e.estado].cor}">${ESTADOS[e.estado].nome}</span>
      <span style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--muted);margin-left:8px">${medida(e)} · ${POV[e.tipo_pov]}</span>
      <div class="emp-campos">
        <div class="form-field span2"><label class="form-label">Nome</label><input class="form-input" id="emp-e-nome" value="${esc(e.nome)}"/></div>
        <div class="form-field"><label class="form-label">Estado</label><select class="form-select" id="emp-e-estado">${
          Object.entries(ESTADOS).map(([k, s]) => `<option value="${k}"${k === e.estado ? ' selected' : ''}>${s.nome}</option>`).join('')}</select></div>
        <div class="form-field"><label class="form-label">Povoamento</label><select class="form-select" id="emp-e-pov">${
          Object.entries(POV).map(([k, n]) => `<option value="${k}"${+k === e.tipo_pov ? ' selected' : ''}>${n}</option>`).join('')}</select></div>
        <div class="form-field"><label class="form-label">Início previsto</label><input class="form-input" type="date" id="emp-e-ini" value="${e.inicio_previsto || ''}"/></div>
        <div class="form-field"><label class="form-label">Fim previsto</label><input class="form-input" type="date" id="emp-e-fim" value="${e.fim_previsto || ''}"/></div>
      </div>
      <div class="form-label" style="margin-top:14px">Operações</div>
      <table class="emp-ops" id="emp-e-ops"><tbody>${ops.html}</tbody></table>
      <button class="btn btn-ghost btn-xs" id="emp-e-op-add" style="margin-top:4px">+ Operação</button>
      <div class="form-field" style="margin-top:12px"><label class="form-label">Observações</label>
        <textarea class="form-textarea" id="emp-e-obs" rows="2" style="font-size:12px;padding:6px 8px;resize:vertical">${esc(e.observacoes || '')}</textarea></div>
      <div class="emp-aviso">Meios afectos: ${e.n_meios}. A afectação e a recomendação de meios são o passo seguinte da demonstração.</div>
      <div class="emp-acoes">
        <button class="btn btn-primary btn-sm" id="emp-e-guardar">Guardar</button>
        <button class="btn btn-ghost btn-sm" id="emp-e-fechar">Fechar</button>
        <button class="btn btn-danger btn-sm" id="emp-e-apagar" style="margin-left:auto">Eliminar</button>
      </div>`;
    const tabela = el.querySelector('#emp-e-ops');
    el.querySelector('#emp-e-op-add').onclick = ligarOperacoes(tabela, () => ops.nova(qDefeito));
    el.querySelector('#emp-e-fechar').onclick = () => { st.sel = null; desenharTudo(); };
    el.querySelector('#emp-e-guardar').onclick = async () => {
      const corpo = {
        nome: el.querySelector('#emp-e-nome').value, estado: el.querySelector('#emp-e-estado').value,
        tipo_pov: +el.querySelector('#emp-e-pov').value,
        inicio_previsto: el.querySelector('#emp-e-ini').value || null, fim_previsto: el.querySelector('#emp-e-fim').value || null,
        observacoes: el.querySelector('#emp-e-obs').value, operacoes: lerOperacoes(tabela),
      };
      const { error } = await apiFetch(`/api/demo/empreitadas/${e.id}`, { method: 'PUT', body: JSON.stringify(corpo) });
      if (error) return toast(error.message, 'err');
      toast(`${e.codigo} guardada.`);
      await carregar();
      desenharTudo();
    };
    el.querySelector('#emp-e-apagar').onclick = async () => {
      const volta = e.origem === 'proposta' ? ' A proposta volta à lista.' : '';
      if (!confirm(`Eliminar ${e.codigo}?${volta}`)) return;
      const { error } = await apiFetch(`/api/demo/empreitadas/${e.id}`, { method: 'DELETE' });
      if (error) return toast(error.message, 'err');
      toast(`${e.codigo} eliminada.`);
      st.sel = null;
      await carregar();
      desenharTudo();
    };
  }

  // ── Nova empreitada: desenhar no mapa ──────────────────────────
  function iniciarDesenho(tipo = 'poligono') {
    cancelarDesenho();
    st.sel = null;
    st.desenho = { tipo, pts: [], camada: null, marcas: L.layerGroup().addTo(st.mapa) };
    st.mapa.doubleClickZoom.disable();
    document.getElementById('emp-mapa').style.cursor = 'crosshair';
    barraDesenho();
    desenharDetalhe();
  }

  function barraDesenho() {
    const d = st.desenho, el = document.getElementById('emp-desenho');
    el.style.display = 'flex';
    const minimo = d.tipo === 'poligono' ? 3 : 2;
    const m = medirDesenho();
    el.innerHTML = `
      <select class="form-select" id="emp-d-tipo" style="font-size:12px;padding:4px 6px">
        <option value="poligono"${d.tipo === 'poligono' ? ' selected' : ''}>Polígono</option>
        <option value="linha"${d.tipo === 'linha' ? ' selected' : ''}>Linha</option></select>
      <span style="color:var(--muted)">${d.pts.length < minimo
        ? `Clique no mapa para marcar os vértices (${d.pts.length}/${minimo}).`
        : `${d.pts.length} vértices · <b style="color:var(--text)">${m}</b> · duplo clique para concluir`}</span>
      <button class="btn btn-ghost btn-xs" id="emp-d-desf"${d.pts.length ? '' : ' disabled'}>Desfazer</button>
      <button class="btn btn-primary btn-xs" id="emp-d-ok"${d.pts.length >= minimo ? '' : ' disabled'}>Concluir</button>
      <button class="btn btn-ghost btn-xs" id="emp-d-sair">Cancelar</button>`;
    el.querySelector('#emp-d-tipo').onchange = ev => iniciarDesenho(ev.target.value);
    el.querySelector('#emp-d-desf').onclick = () => { d.pts.pop(); redesenharDesenho(); };
    el.querySelector('#emp-d-ok').onclick = concluirDesenho;
    el.querySelector('#emp-d-sair').onclick = () => { cancelarDesenho(); desenharDetalhe(); };
  }

  function juntarVertice(ll) {
    st.desenho.pts.push([+ll.lng.toFixed(6), +ll.lat.toFixed(6)]);
    redesenharDesenho();
  }

  function redesenharDesenho() {
    const d = st.desenho;
    if (d.camada) st.mapa.removeLayer(d.camada);
    d.marcas.clearLayers();
    const lls = d.pts.map(([lon, lat]) => [lat, lon]);
    d.camada = (d.tipo === 'poligono' && lls.length >= 3
      ? L.polygon(lls, { color: tok('--accent'), weight: 2, fillOpacity: .2 })
      : L.polyline(lls, { color: tok('--accent'), weight: 3 })).addTo(st.mapa);
    lls.forEach(ll => L.circleMarker(ll, { radius: 4, color: tok('--accent'), fillColor: '#fff', fillOpacity: 1, weight: 2 }).addTo(d.marcas));
    barraDesenho();
  }

  // As mesmas contas do servidor (demo/dados_demo.js), para mostrar a medida
  // enquanto se desenha. A que fica guardada é a do servidor.
  function geomDesenho() {
    const d = st.desenho;
    return d.tipo === 'poligono'
      ? { type: 'Polygon', coordinates: [[...d.pts, d.pts[0]]] }
      : { type: 'LineString', coordinates: d.pts };
  }
  // Hectares (polígono) ou quilómetros (linha); null enquanto faltam vértices.
  function valorDesenho() {
    const d = st.desenho;
    const mLon = lat => 111320 * Math.cos(lat * Math.PI / 180), mLat = 110540;
    if (d.tipo === 'poligono') {
      if (d.pts.length < 3) return null;
      const anel = [...d.pts, d.pts[0]], k = mLon(anel[0][1]);
      let s = 0;
      for (let i = 0; i < anel.length - 1; i++)
        s += anel[i][0] * k * anel[i + 1][1] * mLat - anel[i + 1][0] * k * anel[i][1] * mLat;
      return Math.abs(s) / 2 / 10000;
    }
    if (d.pts.length < 2) return null;
    let s = 0;
    for (let i = 1; i < d.pts.length; i++)
      s += Math.hypot((d.pts[i][0] - d.pts[i - 1][0]) * mLon(d.pts[i][1]), (d.pts[i][1] - d.pts[i - 1][1]) * mLat);
    return s / 1000;
  }
  function medirDesenho() {
    const v = valorDesenho();
    return v == null ? '' : st.desenho.tipo === 'poligono' ? `${fmt(v)} ha` : `${fmt(v, 2)} km`;
  }

  function concluirDesenho() {
    const d = st.desenho;
    if (!d || d.pts.length < (d.tipo === 'poligono' ? 3 : 2)) return;
    abrirModalNova(geomDesenho(), d.tipo, +valorDesenho().toFixed(2));
  }

  function cancelarDesenho() {
    const d = st.desenho;
    if (!d) return;
    if (d.camada) st.mapa.removeLayer(d.camada);
    st.mapa.removeLayer(d.marcas);
    st.desenho = null;
    st.mapa.doubleClickZoom.enable();
    document.getElementById('emp-mapa').style.cursor = '';
    document.getElementById('emp-desenho').style.display = 'none';
  }

  // ── Modal da nova empreitada ───────────────────────────────────
  function criarModal() {
    if (document.getElementById('emp-modal')) return;
    document.body.insertAdjacentHTML('beforeend', `
      <div class="modal-overlay" id="emp-modal">
        <div class="modal" style="width:640px">
          <button class="modal-close" onclick="closeModal('emp-modal')">✕</button>
          <div class="modal-title">Nova empreitada</div>
          <div id="emp-m-corpo"></div>
        </div>
      </div>`);
  }

  function abrirModalNova(geom, tipo, quantidade) {
    const ops = linhasOperacoes([], tipo);
    const corpo = document.getElementById('emp-m-corpo');
    corpo.innerHTML = `
      <p style="font-size:12px;color:var(--muted);margin:0 0 14px">
        ${tipo === 'poligono' ? 'Polígono' : 'Linha'} desenhado com ${fmt(quantidade, tipo === 'linha' ? 2 : 1)} ${tipo === 'linha' ? 'km' : 'ha'}.
        Não está em nenhuma proposta recebida: fica registada como criada de raiz.</p>
      <div class="form-grid">
        <div class="form-field span2"><label class="form-label">Nome</label><input class="form-input" id="emp-m-nome" placeholder="Ex.: Faixa de gestão — Serra de …"/></div>
        <div class="form-field"><label class="form-label">Povoamento</label><select class="form-select" id="emp-m-pov">${
          Object.entries(POV).map(([k, n]) => `<option value="${k}"${k === '4' ? ' selected' : ''}>${n}</option>`).join('')}</select></div>
        <div class="form-field"></div>
        <div class="form-field"><label class="form-label">Início previsto</label><input class="form-input" type="date" id="emp-m-ini"/></div>
        <div class="form-field"><label class="form-label">Fim previsto</label><input class="form-input" type="date" id="emp-m-fim"/></div>
      </div>
      <div class="form-label" style="margin-top:16px">Operações</div>
      <table class="emp-ops" id="emp-m-ops"><tbody>${ops.nova(quantidade)}</tbody></table>
      <button class="btn btn-ghost btn-xs" id="emp-m-op-add" style="margin-top:4px">+ Operação</button>
      <div class="form-field" style="margin-top:14px"><label class="form-label">Observações</label>
        <textarea class="form-textarea" id="emp-m-obs" rows="2"></textarea></div>
      <div class="modal-actions" style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px">
        <button class="btn btn-ghost" onclick="closeModal('emp-modal')">Voltar ao desenho</button>
        <button class="btn btn-primary" id="emp-m-criar">Criar empreitada</button>
      </div>`;
    const tabela = corpo.querySelector('#emp-m-ops');
    corpo.querySelector('#emp-m-op-add').onclick = ligarOperacoes(tabela, () => ops.nova(quantidade));
    corpo.querySelector('#emp-m-criar').onclick = async () => {
      const b = {
        nome: corpo.querySelector('#emp-m-nome').value, tipo_pov: +corpo.querySelector('#emp-m-pov').value,
        inicio_previsto: corpo.querySelector('#emp-m-ini').value || null, fim_previsto: corpo.querySelector('#emp-m-fim').value || null,
        observacoes: corpo.querySelector('#emp-m-obs').value || null, operacoes: lerOperacoes(tabela), geom,
      };
      const { data, error } = await apiFetch('/api/demo/empreitadas', { method: 'POST', body: JSON.stringify(b) });
      if (error) return toast(error.message, 'err');
      closeModal('emp-modal');
      cancelarDesenho();
      toast(`Empreitada ${data.codigo} criada.`);
      await carregar();
      mudarAba('empreitadas');
      seleccionar('empreitada', data.id, true);
    };
    openModal('emp-modal');
    setTimeout(() => corpo.querySelector('#emp-m-nome').focus(), 50);
  }

  // ── Entrada ────────────────────────────────────────────────────
  window.renderEmpreitadasPage = async function () {
    if (!st.montado) montar();
    if (!(await carregar())) return;
    const primeira = !st.mapa;
    if (primeira) criarMapa();
    desenharTudo();
    // A página estava escondida: o Leaflet mediu o contentor com zero, e
    // enquadrar antes de ele saber o tamanho real deixa o país inteiro.
    setTimeout(() => { st.mapa.invalidateSize(); if (primeira) enquadrar(); }, 60);
  };
})();
