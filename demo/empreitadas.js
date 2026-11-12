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
  // Cor dos pedidos pelo tipo de rede: é o que o pedido diz (não diz a
  // intervenção, essa escolhe-se ao seleccionar).
  const REDES  = {
    RPFGC: { cor: '#e0773a', nome: 'Rede primária' },
    RSFGC: { cor: '#3f9fd6', nome: 'Rede secundária' },
    MGC:   { cor: '#8bbf3f', nome: 'Mosaico' },
  };
  const GEOM   = { poligono: 'Polígono', faixa: 'Faixa', linha: 'Linha (rede viária)' };
  const ESTADOS = {
    seleccionada: { nome: 'Seleccionada', cor: 'var(--accent3)' },
    planeada:     { nome: 'Planeada',     cor: 'var(--accent)' },
    em_execucao:  { nome: 'Em execução',  cor: 'var(--warn)' },
    concluida:    { nome: 'Concluída',    cor: 'var(--success)' },
    cancelada:    { nome: 'Cancelada',    cor: 'var(--muted)' },
  };

  const st = {
    montado: false, aba: 'pedidos', cat: null, pedidos: [], empreitadas: [],
    filtro: { base: '', rede: '', modo: '', estado: '', q: '' },
    sel: null,               // { tipo: 'pedido'|'empreitada', id }
    mapa: null, camadas: null, mosaico: null, porId: new Map(),
    desenho: null,           // { tipo, pts, camada }
  };

  // O Leaflet escreve a cor como atributo SVG, e aí var(--x) não vale:
  // lê-se o valor do token no momento de desenhar.
  const tok = nome => getComputedStyle(document.documentElement).getPropertyValue(nome).trim() || '#888';
  const fmt = (n, c = 1) => Number(n).toLocaleString('pt-PT', { minimumFractionDigits: c, maximumFractionDigits: c });
  const opDe = cod => st.cat?.operacoes.find(o => o.codigo === cod);
  const corDe = cod => MODOS[opDe(cod)?.modo]?.cor || '#888';
  const corPedido = p => REDES[p.tiporede]?.cor || '#888';
  const corItem = x => (st.aba === 'pedidos' ? corPedido(x) : corDe(x.operacoes[0]?.operacao));
  const dmy = d => d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '';
  // Pedido de linha: faixa com largura, em ha (comprimento × largura).
  const medida = x => {
    if (x.camada === 'linhas')
      return `${fmt(x.areacalc / 10000)} ha · ${fmt(x.comprim_m / 1000, 2)} km × ${fmt(x.largura_m, 0)} m`;
    if (x.geometria === 'faixa')
      return `${fmt(x.area_ha)} ha · ${fmt(x.comprimento_km, 2)} km × ${fmt(x.largura_m, 0)} m`;
    return x.area_ha != null ? `${fmt(x.area_ha)} ha` : `${fmt(x.comprimento_km, 2)} km`;
  };
  const nomePedido = p => `${p.localtrab || 'Pedido'} · ${p.municipio || p.drcnf || ''}`;

  // Polígono de uma faixa: a linha alargada para cada lado em metade da
  // largura (só para desenhar; as contas fazem-se com comprimento × largura).
  function faixaPoligono(coords, largura) {
    const kx = 111320 * Math.cos(coords[0][1] * Math.PI / 180), ky = 110540, h = largura / 2;
    const xy = coords.map(([lon, lat]) => [lon * kx, lat * ky]);
    const esq = [], dir = [];
    xy.forEach((p, i) => {
      const a = xy[Math.max(0, i - 1)], b = xy[Math.min(xy.length - 1, i + 1)];
      const n = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const nx = -(b[1] - a[1]) / n * h, ny = (b[0] - a[0]) / n * h;
      esq.push([(p[0] + nx) / kx, (p[1] + ny) / ky]);
      dir.push([(p[0] - nx) / kx, (p[1] - ny) / ky]);
    });
    const anel = [...esq, ...dir.reverse()];
    return { type: 'Polygon', coordinates: [[...anel, anel[0]]] };
  }
  // O que se desenha no mapa: numa faixa, a área à volta e a linha ao meio.
  const geomMapa = x => (x.largura_m && x.geom.type === 'LineString'
    ? [faixaPoligono(x.geom.coordinates, Number(x.largura_m)), x.geom] : x.geom);

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
    #page-empreitadas .emp-ter-barra{position:absolute;top:10px;left:50%;transform:translateX(-50%);z-index:600;background:var(--surface);
      border:1px solid var(--accent3);padding:8px 12px;display:flex;gap:8px;align-items:center;font-size:12px;flex-wrap:wrap;
      max-width:96%;justify-content:center}
    #page-empreitadas .emp-ter-barra .form-select,#page-empreitadas .emp-ter-barra .form-input{font-size:12px;padding:4px 6px}
    #page-empreitadas .emp-ter-barra .info{color:var(--muted);font-variant-numeric:tabular-nums}
    #page-empreitadas .emp-ter-barra .info b{color:var(--text)}
    .emp-seg{display:inline-flex;border:1px solid var(--border)}
    .emp-seg button{background:none;border:none;color:var(--muted);font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:.06em;
      text-transform:uppercase;padding:5px 9px;cursor:pointer}
    .emp-seg button+button{border-left:1px solid var(--border)}
    .emp-seg button.on{background:color-mix(in srgb,var(--accent3) 18%,transparent);color:var(--text)}
    .emp-seg button:focus-visible{outline:2px solid var(--accent3);outline-offset:-2px}
    .emp-ter-op{display:grid;grid-template-columns:auto 1fr auto;gap:4px 10px;align-items:center;font-size:11px;margin-top:8px}
    .emp-ter-op .c{font-family:'IBM Plex Mono',monospace;font-weight:600}
    .emp-ter-op .v{font-family:'IBM Plex Mono',monospace;font-variant-numeric:tabular-nums;white-space:nowrap;text-align:right}
    .emp-ter-op .d{grid-column:1/-1;color:var(--muted);font-size:10px;margin-top:-2px}
    .emp-ter-reg{display:grid;grid-template-columns:44px 1fr auto;gap:2px 10px;padding:7px 0;border-bottom:1px solid var(--border);font-size:12px}
    .emp-ter-reg .dt{font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--muted)}
    .emp-ter-reg .q{font-family:'IBM Plex Mono',monospace;font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}
    .emp-ter-reg .m{grid-column:2/-1;color:var(--muted);font-size:11px}
    .emp-ter-reg.anulado{opacity:.5}
    .emp-ter-reg.anulado .q{text-decoration:line-through}
    .emp-ter-reg .decl{color:var(--warn);border-color:color-mix(in srgb,var(--warn) 50%,var(--border))}
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
    #page-empreitadas .emp-sec{margin-top:16px;border-top:1px solid var(--border);padding-top:12px}
    #page-empreitadas .emp-sec-hdr{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
    #page-empreitadas .emp-sec-hdr b{font-family:'IBM Plex Mono',monospace;font-size:12px;font-variant-numeric:tabular-nums}
    #page-empreitadas .emp-grupo{font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:.06em;color:var(--muted);margin:10px 0 4px}
    #page-empreitadas .emp-meio{display:grid;grid-template-columns:18px 1fr auto 22px;gap:8px;align-items:center;padding:5px 0;
      border-bottom:1px dashed var(--border);font-size:12px}
    #page-empreitadas .emp-meio .ic{color:var(--muted);text-align:center}
    #page-empreitadas .emp-meio .r{min-width:0}
    #page-empreitadas .emp-meio .r div:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #page-empreitadas .emp-meio .m{font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--muted)}
    #page-empreitadas .emp-meio .v{font-family:'IBM Plex Mono',monospace;font-size:11px;text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
    .emp-tag{font-family:'IBM Plex Mono',monospace;font-size:9px;letter-spacing:.06em;padding:1px 5px;border:1px solid var(--border);color:var(--muted);border-radius:2px;margin-left:4px}
    #emp-modal-rec .modal{width:1040px}
    .emp-rec-topo{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px;font-size:12px;color:var(--muted)}
    .emp-rec-topo input[type=range]{width:200px;accent-color:var(--accent)}
    .emp-rec-grelha{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
    .emp-alt{border:1px solid var(--border);background:var(--surface2);padding:14px;display:flex;flex-direction:column;gap:10px;min-width:0}
    .emp-alt.melhor{border-color:var(--accent)}
    .emp-alt h4{margin:0;font-family:'Barlow Condensed',sans-serif;font-size:17px;letter-spacing:.05em;text-transform:uppercase}
    .emp-alt .num{display:grid;grid-template-columns:1fr 1fr;gap:6px}
    .emp-alt .num div{background:var(--surface);border:1px solid var(--border);padding:6px 8px}
    .emp-alt .num b{display:block;font-family:'IBM Plex Mono',monospace;font-size:16px;font-variant-numeric:tabular-nums}
    .emp-alt .num span{font-family:'IBM Plex Mono',monospace;font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
    .emp-alt .num b.ganha{color:var(--accent)}
    .emp-alt details{border-top:1px solid var(--border);padding-top:8px;font-size:12px}
    .emp-alt summary{cursor:pointer;list-style:none;display:flex;justify-content:space-between;gap:8px}
    .emp-alt summary::-webkit-details-marker{display:none}
    .emp-alt summary .q{font-family:'IBM Plex Mono',monospace;font-size:11px;font-variant-numeric:tabular-nums;white-space:nowrap}
    .emp-alt .conta{margin:6px 0 4px;padding-left:14px;color:var(--muted);font-size:11px;line-height:1.5}
    .emp-alt .lmeios{font-size:11px;display:grid;gap:2px;margin-top:4px}
    .emp-alt .lmeios div{display:flex;justify-content:space-between;gap:8px}
    .emp-alt .falta{font-size:11px;color:var(--warn)}
    .emp-alt .igual{font-size:11px;color:var(--muted);font-style:italic}
    .emp-nota{font-size:11px;color:var(--muted);margin-top:12px;line-height:1.5}
    #emp-modal-af .modal{width:720px}
    .emp-af-lista{max-height:330px;overflow-y:auto;border:1px solid var(--border);margin-top:8px}
    .emp-af-lista label{display:grid;grid-template-columns:18px 1fr auto;gap:8px;align-items:center;padding:6px 10px;border-bottom:1px solid var(--border);font-size:12px;cursor:pointer}
    .emp-af-lista label.off{opacity:.45;cursor:not-allowed}
    .emp-af-lista .m{font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--muted)}
    #page-empreitadas .emp-ex-linhas{display:grid;gap:7px;margin-top:8px}
    #page-empreitadas .emp-ex-l{display:grid;grid-template-columns:96px 1fr auto;gap:10px;align-items:center;font-size:11px}
    #page-empreitadas .emp-ex-l .n{font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--muted);letter-spacing:.04em}
    #page-empreitadas .emp-ex-l .v{font-family:'IBM Plex Mono',monospace;font-variant-numeric:tabular-nums;white-space:nowrap;text-align:right}
    .emp-barra-p{position:relative;height:8px;background:var(--surface2);border:1px solid var(--border)}
    .emp-barra-p i{position:absolute;left:0;top:0;bottom:0;background:var(--accent3)}
    .emp-barra-p i.acima{background:var(--warn)}
    .emp-barra-p b{position:absolute;top:-3px;bottom:-3px;width:2px;background:var(--text)}
    .emp-desvio{font-family:'IBM Plex Mono',monospace;font-size:10px;font-variant-numeric:tabular-nums;padding:1px 5px;border-radius:2px;white-space:nowrap}
    .emp-desvio.ok{color:var(--muted)}
    .emp-desvio.acima{color:var(--warn);background:color-mix(in srgb,var(--warn) 12%,transparent)}
    .emp-desvio.abaixo{color:var(--accent3);background:color-mix(in srgb,var(--accent3) 12%,transparent)}
    .emp-alerta{font-size:11px;color:var(--warn)}
    #emp-modal-ex .modal{width:1080px}
    .emp-ex-topo{font-size:12px;color:var(--muted);margin-bottom:14px}
    .emp-ex-tiles{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
    .emp-ex-tile{border:1px solid var(--border);background:var(--surface2);padding:10px 12px;display:grid;gap:6px;min-width:0}
    .emp-ex-tile .t{font-family:'IBM Plex Mono',monospace;font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
    .emp-ex-tile .g{font-family:'IBM Plex Mono',monospace;font-size:20px;font-variant-numeric:tabular-nums}
    .emp-ex-tile .s{font-size:11px;color:var(--muted);display:flex;justify-content:space-between;gap:6px;flex-wrap:wrap}
    .emp-ex-anom{margin-top:14px;border:1px solid color-mix(in srgb,var(--warn) 45%,var(--border));padding:10px 12px;font-size:12px}
    .emp-ex-anom div{display:grid;grid-template-columns:150px 130px 1fr;gap:10px;padding:3px 0}
    .emp-ex-anom .m,.emp-ex-tab table.r td:nth-child(-n+3){white-space:nowrap}
    .emp-ex-anom .m{font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--muted)}
    .emp-ex-tab-wrap{overflow-x:auto;margin-top:14px;max-height:52vh;overflow-y:auto;border:1px solid var(--border)}
    .emp-ex-tab{width:100%;border-collapse:collapse;font-size:12px;min-width:820px}
    .emp-ex-tab th{position:sticky;top:0;background:var(--surface);font-family:'IBM Plex Mono',monospace;font-size:9px;letter-spacing:.08em;
      text-transform:uppercase;color:var(--muted);text-align:right;padding:7px 8px;border-bottom:1px solid var(--border);font-weight:500}
    .emp-ex-tab th:first-child,.emp-ex-tab th:nth-child(2){text-align:left}
    .emp-ex-tab td{padding:6px 8px;border-bottom:1px solid var(--border);text-align:right;font-family:'IBM Plex Mono',monospace;font-size:11px;
      font-variant-numeric:tabular-nums;white-space:nowrap;vertical-align:top}
    .emp-ex-tab td:first-child{text-align:left;font-family:inherit;font-size:12px;white-space:normal}
    .emp-ex-tab td:nth-child(2){text-align:left}
    .emp-ex-tab tr.meio{cursor:pointer}
    .emp-ex-tab tr.meio:hover td{background:var(--surface2)}
    .emp-ex-tab tr.grupo td{background:var(--surface2);font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:.08em;color:var(--muted);text-transform:uppercase}
    .emp-ex-tab .sub{color:var(--muted);font-size:10px}
    .emp-ex-tab tr.regs td{background:var(--surface2);padding:4px 8px 10px 30px;text-align:left}
    .emp-ex-tab table.r{border-collapse:collapse;width:100%}
    .emp-ex-tab table.r td{border:none;padding:2px 10px 2px 0;background:none;font-size:10px;text-align:left;font-family:'IBM Plex Mono',monospace}
    .emp-ex-tab table.r tr.mau td{color:var(--warn)}
    #emp-modal-fh .modal{width:960px}
    .emp-fh-dias{display:flex;gap:6px;overflow-x:auto;padding-bottom:6px}
    .emp-fh-dia{flex:0 0 auto;border:1px solid var(--border);background:var(--surface2);padding:5px 9px;font-family:'IBM Plex Mono',monospace;font-size:11px;
      cursor:pointer;display:grid;gap:2px;text-align:center;color:var(--text)}
    .emp-fh-dia small{font-size:9px;color:var(--muted)}
    .emp-fh-dia.completo{border-color:var(--success)}
    .emp-fh-dia.completo small{color:var(--success)}
    .emp-fh-dia.parcial{border-color:var(--warn)}
    .emp-fh-dia.parcial small{color:var(--warn)}
    .emp-fh-dia.sel{outline:2px solid var(--accent);outline-offset:1px}
    .emp-fh-dia:focus-visible{outline:2px solid var(--accent)}
    .emp-fh-tab{width:100%;border-collapse:collapse;font-size:12px;margin-top:12px;min-width:760px}
    .emp-fh-tab th{font-family:'IBM Plex Mono',monospace;font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);text-align:left;
      padding:6px;border-bottom:1px solid var(--border);font-weight:500}
    .emp-fh-tab td{padding:4px 6px;border-bottom:1px solid var(--border);vertical-align:middle}
    .emp-fh-tab .form-input,.emp-fh-tab .form-select{font-size:12px;padding:4px 6px}
    .emp-fh-tab input[type=time]{width:92px}
    .emp-fh-tab input.pausa{width:58px}
    .emp-fh-tab .h{font-family:'IBM Plex Mono',monospace;font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}
    .emp-fh-tab tr.ausente td:not(:first-child){opacity:.4}
    @media (max-width:900px){ .emp-rec-grelha{grid-template-columns:1fr} .emp-ex-tiles{grid-template-columns:1fr 1fr} }
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
          <button class="icnf-tab-btn active" data-aba="pedidos">Pedidos <span id="emp-n-prop"></span></button>
          <button class="icnf-tab-btn" data-aba="empreitadas">Empreitadas <span id="emp-n-emp"></span></button>
        </div>
        <div class="emp-filtros">
          <input class="form-input" id="emp-f-q" placeholder="Procurar nome ou código…" style="width:170px"/>
          <select class="form-select" id="emp-f-base"><option value="">Todas as bases</option></select>
          <select class="form-select" id="emp-f-rede"><option value="">Todas as redes</option></select>
          <select class="form-select" id="emp-f-modo" style="display:none"><option value="">Todos os modos</option></select>
          <select class="form-select" id="emp-f-estado" style="display:none"><option value="">Todos os estados</option></select>
          <button class="btn btn-primary btn-sm" id="emp-btn-nova">+ Nova empreitada</button>
          <button class="btn btn-ghost btn-sm" id="emp-btn-repor" style="display:none" title="Só o administrador">Repor demonstração</button>
        </div>
      </div>
      <div class="emp-grelha">
        <div class="emp-mapa-wrap">
          <div id="emp-mapa"></div>
          <div class="emp-legenda" id="emp-legenda"></div>
          <div class="emp-desenho" id="emp-desenho" style="display:none"></div>
          <div class="emp-ter-barra" id="emp-ter-barra" style="display:none"></div>
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
    pag.querySelector('#emp-f-rede').onchange  = e => { f.rede = e.target.value; desenharTudo(); };
    pag.querySelector('#emp-f-modo').onchange  = e => { f.modo = e.target.value; desenharTudo(); };
    pag.querySelector('#emp-f-estado').onchange = e => { f.estado = e.target.value; desenharTudo(); };
    pag.querySelector('#emp-btn-nova').onclick = () => iniciarDesenho();
    // currentRole é da aplicação principal (let global, visível entre scripts).
    const repor = pag.querySelector('#emp-btn-repor');
    if (typeof currentRole !== 'undefined' && currentRole === 'admin') repor.style.display = '';
    repor.onclick = async () => {
      if (!confirm('Repor a demonstração?\n\nApaga todas as empreitadas e horas registadas, volta a gerar os pedidos e os ' +
                   'registos da frota e das máquinas com a data de hoje, e recria os cenários (concluída, em execução, planeada).')) return;
      repor.disabled = true;
      repor.textContent = 'A repor…';
      const r = await apiFetch('/api/demo/repor', { method: 'POST' });
      repor.disabled = false;
      repor.textContent = 'Repor demonstração';
      if (r.error) return toast(r.error.message, 'err');
      toast(`Demonstração reposta: ${r.data.pedidos} pedidos, ${r.data.cenarios.length} cenários.`);
      st.sel = null;
      await carregar();
      desenharTudo();
    };

    criarModal();
    st.montado = true;
  }

  function criarMapa() {
    st.mapa = L.map('emp-mapa', { zoomControl: true }).setView([39.7, -8.0], 7);
    st.camadas = L.featureGroup().addTo(st.mapa);
    aplicarMosaico();
    // O tema muda com o botão da barra de topo: acompanha-se a classe no <html>.
    new MutationObserver(aplicarMosaico).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    st.mapa.on('click', e => { if (st.desenho) juntarVertice(e.latlng); else if (st.ter) terrenoClique(e.latlng); });
    st.mapa.on('dblclick', e => {
      if (st.desenho) { L.DomEvent.stop(e); concluirDesenho(); }
      else if (st.ter) { L.DomEvent.stop(e); terrenoDuploClique(); }
    });
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
    const chamadas = [apiFetch('/api/demo/pedidos'), apiFetch('/api/demo/empreitadas')];
    if (!st.cat) chamadas.push(apiFetch('/api/demo/catalogos'));
    const [p, e, c] = await Promise.all(chamadas);
    const falha = [p, e, c].find(x => x && x.error);
    if (falha) { toast(falha.error.message, 'err'); return false; }
    st.pedidos = p.data;
    st.empreitadas = e.data;
    if (c) {
      st.cat = c.data;
      const sb = document.getElementById('emp-f-base');
      sb.innerHTML += st.cat.bases.map(b => `<option>${esc(b.nome)}</option>`).join('');
      document.getElementById('emp-f-rede').innerHTML += Object.entries(REDES)
        .map(([k, r]) => `<option value="${k}">${r.nome} (${k})</option>`).join('');
      document.getElementById('emp-f-modo').innerHTML += Object.entries(MODOS)
        .map(([k, m]) => `<option value="${k}">${m.nome}</option>`).join('');
      document.getElementById('emp-f-estado').innerHTML += Object.entries(ESTADOS)
        .map(([k, s]) => `<option value="${k}">${s.nome}</option>`).join('');
    }
    return true;
  }

  // ── Desenho ────────────────────────────────────────────────────
  function filtrados() {
    const f = st.filtro, ehP = st.aba === 'pedidos';
    return (ehP ? st.pedidos : st.empreitadas).filter(x => {
      if (f.base && (x.base_proxima || x.base) !== f.base) return false;
      if (ehP && f.rede && x.tiporede !== f.rede) return false;
      if (!ehP && f.modo && !x.operacoes.some(o => o.modo === f.modo)) return false;
      if (!ehP && f.estado && x.estado !== f.estado) return false;
      const texto = ehP ? `${x.codpedido} ${x.localtrab} ${x.municipio} ${x.mnpf || ''}`
                        : `${x.nome} ${x.codigo} ${x.pedido_codigo || ''}`;
      if (f.q && !texto.toLowerCase().includes(f.q)) return false;
      return true;
    });
  }

  function legenda() {
    const ehP = st.aba === 'pedidos';
    document.getElementById('emp-legenda').innerHTML =
      Object.values(ehP ? REDES : MODOS).map(m => `<div><i style="background:${m.cor}"></i>${m.nome}</div>`).join('') +
      `<div style="margin-top:4px;color:var(--muted)">${ehP ? 'cor = tipo de rede · tracejado = pedido' : 'cor = modo de execução'}</div>`;
  }

  function desenharTudo() {
    if (st.ligacoes) { st.mapa.removeLayer(st.ligacoes); st.ligacoes = null; }
    const ehP = st.aba === 'pedidos';
    document.getElementById('emp-n-prop').textContent = `(${st.pedidos.filter(p => !p.empreitada_id).length})`;
    document.getElementById('emp-n-emp').textContent = `(${st.empreitadas.length})`;
    document.getElementById('emp-f-rede').style.display = ehP ? '' : 'none';
    document.getElementById('emp-f-modo').style.display = ehP ? 'none' : '';
    document.getElementById('emp-f-estado').style.display = ehP ? 'none' : '';
    legenda();
    const itens = filtrados();
    desenharLista(itens);
    desenharMapa(itens);
    desenharDetalhe();
  }

  function desenharLista(itens) {
    const el = document.getElementById('emp-lista');
    const ehP = st.aba === 'pedidos';
    if (!itens.length) {
      el.innerHTML = `<div class="emp-vazio">${ehP
        ? 'Nenhum pedido com estes filtros.'
        : 'Ainda não há empreitadas. Escolha um pedido e seleccione-o, ou desenhe uma nova no mapa.'}</div>`;
      return;
    }
    el.innerHTML = itens.map(x => {
      const sel = st.sel && st.sel.id === x.id && st.sel.tipo === (ehP ? 'pedido' : 'empreitada');
      const titulo = ehP ? nomePedido(x) : x.nome;
      const sub = ehP
        ? `${x.codpedido} · ${x.tiporede}${x.empreitada_codigo ? ' · → ' + x.empreitada_codigo : ''}`
        : `${x.codigo} · ${x.operacoes.map(o => o.operacao).join(', ')} · ${x.base || '—'}`;
      const dir = ehP ? medida(x).split(' · ')[0]
        : `<span class="emp-pill" style="color:${ESTADOS[x.estado].cor}">${ESTADOS[x.estado].nome}</span>`;
      return `<div class="emp-item${sel ? ' sel' : ''}${ehP && x.empreitada_id ? ' tomada' : ''}" data-id="${x.id}">
        <span class="emp-ponto" style="background:${corItem(x)}"></span>
        <div style="min-width:0"><div class="t">${esc(titulo)}</div><div class="s">${esc(sub)}</div></div>
        <div class="d">${dir}</div></div>`;
    }).join('');
    el.querySelectorAll('.emp-item').forEach(n => n.onclick = () =>
      seleccionar(ehP ? 'pedido' : 'empreitada', isNaN(n.dataset.id) ? n.dataset.id : +n.dataset.id, true));
  }

  function desenharMapa(itens) {
    st.camadas.clearLayers();
    st.porId.clear();
    const ehP = st.aba === 'pedidos';
    for (const x of itens) {
      const cor = corItem(x);
      const sel = st.sel && st.sel.id === x.id;
      const tomada = ehP && x.empreitada_id;
      const estilo = {
        color: cor, weight: sel ? 4 : (x.geom.type === 'LineString' ? 3 : 2),
        dashArray: ehP ? '6 5' : null, opacity: tomada ? .45 : .95,
        fillColor: cor, fillOpacity: ehP ? (tomada ? .06 : .18) : .32,
      };
      const camada = L.geoJSON(geomMapa(x), { style: () => estilo })
        .bindTooltip(`<b>${esc(ehP ? nomePedido(x) : x.nome)}</b><br>${esc(ehP ? x.codpedido : x.codigo)} · ${medida(x)}`, { sticky: true })
        .on('click', ev => { if (st.desenho || st.ter) return; L.DomEvent.stop(ev); seleccionar(ehP ? 'pedido' : 'empreitada', x.id, false); });
      camada.addTo(st.camadas);
      st.porId.set(x.id, camada);
    }
    // As geometrias pequenas desaparecem quando o mapa está afastado; um
    // marcador no centro mantém-nas visíveis à escala do país.
    for (const x of itens) {
      const b = st.porId.get(x.id).getBounds().getCenter();
      L.circleMarker(b, { radius: 3, stroke: false, fillColor: corItem(x), fillOpacity: .9 })
        .on('click', () => seleccionar(ehP ? 'pedido' : 'empreitada', x.id, true)).addTo(st.camadas);
    }
  }

  function seleccionar(tipo, id, centrar) {
    if (st.desenho || st.ter) return;
    st.sel = { tipo, id };
    st.meiosSel = null;
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
    if (st.ter) { painelTerreno(el); return; }
    if (!st.sel) {
      el.innerHTML = st.aba === 'pedidos'
        ? `<div class="emp-eyebrow">Pedidos à FSBF · serviço ESRI (simulado)</div>
           <h3>${st.pedidos.length} pedidos em vigor</h3>
           <p style="font-size:12px;color:var(--muted);margin:6px 0 0;line-height:1.5">
             Cada pedido é um polígono ou uma linha da aplicação de pedidos, com o tipo de rede de gestão de
             combustível. As linhas são faixas: têm largura, e mede-se a área. O pedido não diz que intervenção
             fazer: escolhe-se ao seleccioná-lo como empreitada. Se o que procura não está aqui, use
             «Nova empreitada» e desenhe-a.</p>`
        : `<div class="emp-eyebrow">Empreitadas</div>
           <h3>${st.empreitadas.length} empreitada${st.empreitadas.length === 1 ? '' : 's'}</h3>
           <p style="font-size:12px;color:var(--muted);margin:6px 0 0">Escolha uma para ver e editar.</p>`;
      return;
    }
    if (st.sel.tipo === 'pedido') detalhePedido(el, st.pedidos.find(p => p.id === st.sel.id));
    else detalheEmpreitada(el, st.empreitadas.find(e => e.id === st.sel.id));
  }

  function detalhePedido(el, p) {
    if (!p) { el.innerHTML = ''; return; }
    const dom = st.cat.dominios;
    const linha = (k, v) => v == null || v === '' ? '' : `<dt>${k}</dt><dd>${v}</dd>`;
    const cod = (v, d) => v ? `<code>${esc(v)}</code>${esc(d || '')}` : null;
    const faixa = p.camada === 'linhas';
    el.innerHTML = `
      <div class="emp-eyebrow">Pedido ${esc(p.codpedido)} · ${faixa ? 'linha' : 'polígono'} · submetido a ${dmy(p.datasub)}</div>
      <h3>${esc(nomePedido(p))}</h3>
      <span class="emp-pill" style="color:${corPedido(p)}">${esc(REDES[p.tiporede]?.nome || p.tiporede || '')}</span>
      <dl class="emp-attrs">
        ${linha('TipoRede', cod(p.tiporede, dom.tiporede[p.tiporede]))}
        ${linha('TipoEstrutura', p.tipoestrutura ? esc(p.tipoestrutura) : null)}
        ${linha(faixa ? 'Faixa' : 'Área', medida(p))}
        ${linha('Perímetro', p.perimetro_ ? `${fmt(p.perimetro_ / 1000, 2)} km` : null)}
        ${linha('Período pedido', p.datainicio ? `${dmy(p.datainicio)} a ${dmy(p.datafim)}` : null)}
        ${linha('DRCNF', cod(p.drcnf, dom.drcnf[p.drcnf]))}
        ${linha('NUTS III', esc(p.nuts3))}
        ${linha('Município', esc(p.municipio))}
        ${linha('MN / PF', p.mnpf ? esc(p.mnpf) : null)}
        ${linha('Local', esc(p.localtrab))}
        ${linha('Tipo de área', esc(p.tipoarea))}
        ${linha('Entidade', esc(p.entidade))}
        ${linha('Utilizador', `${esc(p.utilizador)} · ${esc(p.nome)}`)}
        ${linha('Observações', p.observa ? esc(p.observa) : null)}
        ${linha('Base próxima', esc(p.base_proxima))}
      </dl>
      <div class="emp-acoes">
        ${p.empreitada_id
          ? `<button class="btn btn-ghost btn-sm" id="emp-abrir">Abrir ${esc(p.empreitada_codigo)}</button>`
          : `<button class="btn btn-primary btn-sm" id="emp-escolher">Seleccionar como empreitada</button>`}
        <button class="btn btn-ghost btn-sm" id="emp-fechar">Fechar</button>
      </div>`;
    el.querySelector('#emp-fechar').onclick = () => { st.sel = null; desenharTudo(); };
    if (p.empreitada_id) el.querySelector('#emp-abrir').onclick = () => { mudarAba('empreitadas'); seleccionar('empreitada', p.empreitada_id, true); };
    else el.querySelector('#emp-escolher').onclick = () => abrirModalEmpreitada({ pedido: p });
  }

  // Linhas de operação editáveis. `geometria` restringe o catálogo: numa
  // linha (rede viária) só entram operações em km; num polígono ou numa
  // faixa, as em ha.
  function linhasOperacoes(ops, geometria) {
    const g = geometria === 'linha' ? 'linha' : 'poligono';
    const opcoes = st.cat.operacoes.filter(o => o.geometria === g);
    // Agrupadas como na listagem (Silvicultura, Formação, …), pela ordem dela.
    const grupos = [...new Set(opcoes.map(c => c.grupo || ''))];
    const linha = o => `<tr>
      <td><select class="form-select emp-op-cod">${grupos.map(g => `<optgroup label="${esc(g || 'Outras')}">${
        opcoes.filter(c => (c.grupo || '') === g).map(c =>
          `<option value="${c.codigo}"${c.codigo === o.operacao ? ' selected' : ''}>${c.codigo} — ${esc(c.designacao)}</option>`).join('')
      }</optgroup>`).join('')}</select></td>
      <td style="width:92px"><input class="form-input emp-op-q" type="number" min="0.01" step="0.01" value="${o.quantidade ?? ''}"/></td>
      <td style="width:26px;font-size:11px;color:var(--muted)">${g === 'linha' ? 'km' : 'ha'}</td>
      <td style="width:28px"><button class="btn btn-ghost btn-xs emp-op-rem" title="Retirar operação">✕</button></td></tr>`;
    return { html: ops.map(linha).join(''),
             nova: (q, cod) => linha({ operacao: cod && opcoes.some(o => o.codigo === cod) ? cod : opcoes[0].codigo, quantidade: q }) };
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

  // O responsável é um operacional FSBF; agrupados pela base.
  function opcoesResponsavel(sel) {
    const porBase = {};
    for (const o of st.cat.operacionais) (porBase[o.base || 'Sem base'] ||= []).push(o);
    return `<option value="">— por definir —</option>` + Object.keys(porBase).sort((a, b) => a.localeCompare(b, 'pt'))
      .map(b => `<optgroup label="${esc(b)}">${porBase[b].map(o =>
        `<option value="${o.id}"${o.id === sel ? ' selected' : ''}>${esc(o.nome)}${o.cargo ? ' · ' + esc(o.cargo) : ''}</option>`).join('')}</optgroup>`)
      .join('');
  }

  function detalheEmpreitada(el, e) {
    if (!e) { el.innerHTML = ''; return; }
    const ops = linhasOperacoes(e.operacoes, e.geometria);
    const qDefeito = e.area_ha ?? e.comprimento_km;
    el.innerHTML = `
      <div class="emp-eyebrow">${esc(e.codigo)} · ${e.origem === 'pedido' ? `do pedido ${esc(e.pedido_codigo || '')}` : 'criada de raiz'} · base ${esc(e.base || '—')}</div>
      <h3>${esc(e.nome)}</h3>
      <span class="emp-pill" style="color:${ESTADOS[e.estado].cor}">${ESTADOS[e.estado].nome}</span>
      <span style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--muted);margin-left:8px">${GEOM[e.geometria]} · ${medida(e)} · ${POV[e.tipo_pov]}</span>
      <div class="emp-campos">
        <div class="form-field span2"><label class="form-label">Nome</label><input class="form-input" id="emp-e-nome" value="${esc(e.nome)}"/></div>
        <div class="form-field"><label class="form-label">Estado</label><select class="form-select" id="emp-e-estado">${
          Object.entries(ESTADOS).map(([k, s]) => `<option value="${k}"${k === e.estado ? ' selected' : ''}>${s.nome}</option>`).join('')}</select></div>
        <div class="form-field"><label class="form-label">Povoamento</label><select class="form-select" id="emp-e-pov">${
          Object.entries(POV).map(([k, n]) => `<option value="${k}"${+k === e.tipo_pov ? ' selected' : ''}>${n}</option>`).join('')}</select></div>
        <div class="form-field span2"><label class="form-label">Responsável</label><select class="form-select" id="emp-e-resp">${opcoesResponsavel(e.responsavel_id)}</select></div>
        <div class="form-field"><label class="form-label">Início previsto</label><input class="form-input" type="date" id="emp-e-ini" value="${e.inicio_previsto || ''}"/></div>
        <div class="form-field"><label class="form-label">Fim previsto</label><input class="form-input" type="date" id="emp-e-fim" value="${e.fim_previsto || ''}"/></div>
      </div>
      <div class="form-label" style="margin-top:14px">Operações</div>
      <table class="emp-ops" id="emp-e-ops"><tbody>${ops.html}</tbody></table>
      <button class="btn btn-ghost btn-xs" id="emp-e-op-add" style="margin-top:4px">+ Operação</button>
      <div class="form-field" style="margin-top:12px"><label class="form-label">Observações</label>
        <textarea class="form-textarea" id="emp-e-obs" rows="2" style="font-size:12px;padding:6px 8px;resize:vertical">${esc(e.observacoes || '')}</textarea></div>
      <div class="emp-acoes">
        <button class="btn btn-primary btn-sm" id="emp-e-guardar">Guardar</button>
        <button class="btn btn-ghost btn-sm" id="emp-e-fechar">Fechar</button>
        <button class="btn btn-danger btn-sm" id="emp-e-apagar" style="margin-left:auto">Eliminar</button>
      </div>
      <div class="emp-sec">
        <div class="emp-sec-hdr"><span class="form-label">Meios afectos</span><b id="emp-meios-total"></b></div>
        <div id="emp-meios"><div class="emp-vazio" style="padding:12px">A carregar…</div></div>
        <div class="emp-acoes">
          <button class="btn btn-primary btn-sm" id="emp-e-rec">Recomendar meios</button>
          <button class="btn btn-ghost btn-sm" id="emp-e-af">+ Afectar meio</button>
        </div>
      </div>
      <div class="emp-sec" id="emp-ex-sec" style="display:none"></div>`;
    el.querySelector('#emp-e-rec').onclick = () => abrirRecomendacao(e);
    el.querySelector('#emp-e-af').onclick = () => abrirAfectar(e);
    carregarMeios(e);
    carregarExecucao(e);
    const tabela = el.querySelector('#emp-e-ops');
    el.querySelector('#emp-e-op-add').onclick = ligarOperacoes(tabela, () => ops.nova(qDefeito));
    el.querySelector('#emp-e-fechar').onclick = () => { st.sel = null; desenharTudo(); };
    el.querySelector('#emp-e-guardar').onclick = async () => {
      const corpo = {
        nome: el.querySelector('#emp-e-nome').value, estado: el.querySelector('#emp-e-estado').value,
        tipo_pov: +el.querySelector('#emp-e-pov').value, responsavel_id: el.querySelector('#emp-e-resp').value || null,
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
      const volta = e.origem === 'pedido' ? ' O pedido volta à lista.' : '';
      if (!confirm(`Eliminar ${e.codigo}?${volta}`)) return;
      const { error } = await apiFetch(`/api/demo/empreitadas/${e.id}`, { method: 'DELETE' });
      if (error) return toast(error.message, 'err');
      toast(`${e.codigo} eliminada.`);
      st.sel = null;
      await carregar();
      desenharTudo();
    };
  }

  // ── Meios afectos ──────────────────────────────────────────────
  const ICONE = { maquina: '▣', operacional: '●', transporte: '⇄', viatura: '▭' };
  const eur = x => x == null ? '—' : `${Math.round(Number(x)).toLocaleString('pt-PT')} €`;
  const diaCurto = t => t ? `${t.slice(8, 10)}/${t.slice(5, 7)}` : '';
  const CLASSES_LIGEIRAS = ['VLCI', 'VTTP', 'VCOT', 'VFCI'];
  const papelDe = m => m.operacional_id ? 'operacional' : m.classe === 'PM' ? 'transporte'
                     : CLASSES_LIGEIRAS.includes(m.classe) ? 'viatura' : 'maquina';

  async function carregarMeios(e) {
    const { data, error } = await apiFetch(`/api/demo/empreitadas/${e.id}/meios`);
    const el = document.getElementById('emp-meios');
    if (!el || st.sel?.id !== e.id) return;          // entretanto escolheu-se outra
    if (error) { el.innerHTML = `<div class="emp-vazio">${esc(error.message)}</div>`; return; }
    st.meiosSel = data;
    desenharLigacoes(e, data);
    const total = data.reduce((s, m) => s + Number(m.custo_previsto || 0), 0);
    document.getElementById('emp-meios-total').textContent = data.length ? `${eur(total)} previstos` : '';
    if (!data.length) {
      el.innerHTML = `<div class="emp-vazio" style="padding:12px">Ainda sem meios. «Recomendar meios» propõe três alternativas a partir das operações; também pode afectar um a um.</div>`;
      return;
    }
    const grupos = {};
    for (const m of data) (grupos[m.operacao || '—'] ||= []).push(m);
    el.innerHTML = Object.entries(grupos).map(([op, ms]) => {
      const o = e.operacoes.find(x => x.operacao === op);
      return `<div class="emp-grupo">${esc(op)}${o ? ` · ${fmt(o.quantidade, o.unidade === 'km' ? 2 : 1)} ${o.unidade}` : ''} · ${ms.length} meio${ms.length > 1 ? 's' : ''}</div>` +
        ms.map(m => {
          const papel = papelDe(m);
          const nome = m.operacional_id ? m.operacional_nome : `${m.viatura_cod}`;
          const det = m.operacional_id ? (m.cargo || 'Operacional') : (m.tipologia || m.classe);
          return `<div class="emp-meio">
            <span class="ic" title="${papel}">${ICONE[papel]}</span>
            <div class="r"><div>${esc(nome)}${m.origem === 'manual' ? '<span class="emp-tag">MANUAL</span>' : ''}</div>
              <div class="m">${esc(det)} · ${esc(m.base || '—')} · ${diaCurto(m.inicio)}→${diaCurto(m.fim)}</div></div>
            <div class="v">${m.horas_previstas != null ? fmt(m.horas_previstas) + ' h' : ''}<br><span style="color:var(--muted)">${eur(m.custo_previsto)}</span></div>
            <button class="btn btn-ghost btn-xs" data-rem="${m.id}" title="Retirar este meio">✕</button></div>`;
        }).join('');
    }).join('');
    el.querySelectorAll('[data-rem]').forEach(b => b.onclick = async () => {
      const { data, error } = await apiFetch(`/api/demo/empreitadas/${e.id}/meios/${b.dataset.rem}`, { method: 'DELETE' });
      if (error) return toast(error.message, 'err');
      if (data?.estado === 'seleccionada') toast('Sem meios afectos: a empreitada voltou a seleccionada.');
      await recarregarEmpreitada(e.id);
    });
  }

  // Linhas das bases de onde saem os meios até à obra, com quantos são.
  function desenharLigacoes(e, meios) {
    if (st.ligacoes) st.mapa.removeLayer(st.ligacoes);
    st.ligacoes = L.layerGroup().addTo(st.mapa);
    const c = st.porId.get(e.id)?.getBounds().getCenter();
    if (!c) return;
    const porBase = {};
    for (const m of meios) if (m.base) porBase[m.base] = (porBase[m.base] || 0) + 1;
    for (const [base, n] of Object.entries(porBase)) {
      const b = st.cat.bases.find(x => x.nome === base);
      if (!b) continue;
      L.polyline([[b.lat, b.lon], c], { color: tok('--accent3'), weight: 2, dashArray: '2 6', opacity: .9 })
        .bindTooltip(`${n} meio${n > 1 ? 's' : ''} de ${esc(base)}`, { sticky: true }).addTo(st.ligacoes);
    }
  }

  async function recarregarEmpreitada(id) {
    await carregar();
    desenharTudo();
    const c = st.porId.get(id);
    if (c && st.ligacoes) st.mapa.fitBounds(L.featureGroup([c, st.ligacoes]).getBounds(), { padding: [40, 40], maxZoom: 12 });
  }

  // ── Recomendação ───────────────────────────────────────────────
  async function abrirRecomendacao(e) {
    const corpo = document.getElementById('emp-rec-corpo');
    corpo.innerHTML = `
      <div class="emp-rec-topo">
        <span>${esc(e.codigo)} · ${e.operacoes.map(o => `${o.operacao} ${fmt(o.quantidade, o.unidade === 'km' ? 2 : 1)} ${o.unidade}`).join(' + ')} · ${POV[e.tipo_pov]}</span>
        <span style="margin-left:auto">Equilibrada a dar prioridade a</span>
        <span>custo</span><input type="range" id="emp-rec-peso" min="0" max="100" step="10" value="50"/><span>prazo</span>
      </div>
      <div id="emp-rec-res"><div class="emp-vazio">A calcular…</div></div>
      <p class="emp-nota">Só entram meios FSBF operacionais e livres no período. Rendimentos e custos são <b>simulados</b>
        (catálogo da demonstração). Distâncias: linha recta × 1,3. Dia de trabalho: 7 h efectivas. As operações correm em
        paralelo, cada uma com os seus meios.</p>`;
    openModal('emp-modal-rec');
    let t;
    corpo.querySelector('#emp-rec-peso').oninput = ev => { clearTimeout(t); t = setTimeout(() => calcularRec(e, ev.target.value), 250); };
    calcularRec(e, 50);
  }

  async function calcularRec(e, v) {
    const peso = 1 - v / 100;                       // peso do custo
    const res = document.getElementById('emp-rec-res');
    const { data, error } = await apiFetch(`/api/demo/empreitadas/${e.id}/recomendacao?peso=${peso}`);
    if (error) { res.innerHTML = `<div class="emp-vazio">${esc(error.message)}</div>`; return; }
    const alts = data.alternativas.filter(a => a.partes.length);
    const minC = Math.min(...alts.map(a => a.total)), minD = Math.min(...alts.map(a => a.dias));
    res.innerHTML = `<div style="font-size:11px;color:var(--muted);margin-bottom:8px">Início ${data.inicio.split('-').reverse().join('/')}
        — ${e.inicio_previsto ? 'o início previsto da empreitada' : 'o próximo dia útil (a empreitada não tem início previsto)'}.</div>
      <div class="emp-rec-grelha">${data.alternativas.map(a => `
      <div class="emp-alt${a.chave === 'equilibrada' ? ' melhor' : ''}">
        <h4>${a.nome}</h4>
        ${a.igual_a ? `<div class="igual">A mesma combinação que «${a.igual_a}».</div>` : ''}
        <div class="num">
          <div><b class="${a.total === minC ? 'ganha' : ''}">${eur(a.total)}</b><span>custo previsto</span></div>
          <div><b class="${a.dias === minD ? 'ganha' : ''}">${a.dias} dia${a.dias === 1 ? '' : 's'}</b><span>úteis</span></div>
          <div><b>${a.n_maquinas}</b><span>máquinas</span></div>
          <div><b>${a.n_operacionais}</b><span>operacionais</span></div>
        </div>
        ${a.partes.map(p => `<details>
          <summary><span><b>${p.operacao}</b> · ${p.tipo === 'OP' ? `equipa de ${p.k}` : `${p.k} × ${p.tipo}`}</span>
            <span class="q">${fmt(p.horas)} h · ${p.dias} d · ${eur(p.total)}</span></summary>
          <ul class="conta">${p.conta.map(c => `<li>${esc(c)}</li>`).join('')}</ul>
          <div class="lmeios">${p.meios.map(m => `<div><span>${ICONE[m.papel === 'equipa' || m.papel === 'operador' ? 'operacional' : m.papel]} ${esc(m.rotulo)}</span>
            <span class="m" style="color:var(--muted)">${esc(m.base)} · ${fmt(m.dist_km, 0)} km</span></div>`).join('')}</div>
        </details>`).join('')}
        ${a.faltas.map(f => `<div class="falta">⚠ ${esc(f)}</div>`).join('')}
        <button class="btn ${a.chave === 'equilibrada' ? 'btn-primary' : 'btn-ghost'} btn-sm" data-aceitar="${a.chave}"
          ${a.partes.length ? '' : 'disabled'} style="margin-top:auto">Aceitar «${a.nome.toLowerCase()}»</button>
      </div>`).join('')}</div>`;
    res.querySelectorAll('[data-aceitar]').forEach(b => b.onclick = async () => {
      const n = st.meiosSel?.length || 0;
      if (n && !confirm(`Substituir os ${n} meios afectos a ${e.codigo} pelos desta alternativa?`)) return;
      const r = await apiFetch(`/api/demo/empreitadas/${e.id}/recomendacao/aceitar`,
                               { method: 'POST', body: JSON.stringify({ chave: b.dataset.aceitar, peso }) });
      if (r.error) return toast(r.error.message, 'err');
      closeModal('emp-modal-rec');
      toast(`${e.codigo}: ${r.data.meios} afectações da alternativa «${r.data.alternativa.toLowerCase()}».`);
      await recarregarEmpreitada(e.id);
    });
  }

  // ── Afectar um meio à mão ──────────────────────────────────────
  async function abrirAfectar(e) {
    const corpo = document.getElementById('emp-af-corpo');
    corpo.innerHTML = '<div class="emp-vazio">A carregar…</div>';
    openModal('emp-modal-af');
    const { data, error } = await apiFetch(`/api/demo/empreitadas/${e.id}/meios-disponiveis`);
    if (error) { corpo.innerHTML = `<div class="emp-vazio">${esc(error.message)}</div>`; return; }
    const grupos = {
      maquinas:     data.viaturas.filter(v => !CLASSES_LIGEIRAS.includes(v.classe)),
      viaturas:     data.viaturas.filter(v => CLASSES_LIGEIRAS.includes(v.classe)),
      operacionais: data.operacionais,
    };
    corpo.innerHTML = `
      <div class="form-grid">
        <div class="form-field"><label class="form-label">Tipo de meio</label>
          <select class="form-select" id="emp-af-tipo"><option value="maquinas">Máquinas e porta-máquinas</option>
            <option value="viaturas">Viaturas ligeiras</option><option value="operacionais">Operacionais</option></select></div>
        <div class="form-field"><label class="form-label">Procurar</label><input class="form-input" id="emp-af-q" placeholder="Código, nome, base…"/></div>
        <div class="form-field"><label class="form-label">Operação</label><select class="form-select" id="emp-af-op">
          <option value="">— nenhuma em particular —</option>${e.operacoes.map(o => `<option>${o.operacao}</option>`).join('')}</select></div>
        <div class="form-field"></div>
        <div class="form-field"><label class="form-label">De</label><input class="form-input" type="date" id="emp-af-ini" value="${e.inicio_previsto || data.inicio}"/></div>
        <div class="form-field"><label class="form-label">Até</label><input class="form-input" type="date" id="emp-af-fim" value="${e.fim_previsto || data.inicio}"/></div>
      </div>
      <div class="emp-af-lista" id="emp-af-lista"></div>
      <p class="emp-nota">Ordenados pela distância à obra. A disponibilidade é vista para a janela ${data.inicio.split('-').reverse().join('/')}–${data.fim.split('-').reverse().join('/')}.</p>
      <div class="modal-actions" style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
        <button class="btn btn-ghost" onclick="closeModal('emp-modal-af')">Cancelar</button>
        <button class="btn btn-primary" id="emp-af-ok">Afectar</button></div>`;
    const lista = () => {
      const q = corpo.querySelector('#emp-af-q').value.trim().toLowerCase();
      const g = grupos[corpo.querySelector('#emp-af-tipo').value]
        .filter(x => !q || `${x.rotulo} ${x.detalhe || ''} ${x.base} ${x.classe || ''}`.toLowerCase().includes(q)).slice(0, 80);
      corpo.querySelector('#emp-af-lista').innerHTML = g.map(x => {
        const off = x.ocupado_em || x.inoperacional;
        return `<label class="${off ? 'off' : ''}"><input type="radio" name="emp-af" value="${x.id}" ${off ? 'disabled' : ''}/>
          <div><div>${esc(x.rotulo)}${x.classe ? ` <span class="m">${esc(x.classe)}</span>` : ''}</div>
            <div class="m">${esc(x.detalhe || '')}${x.ocupado_em ? ` · ocupado em ${esc(x.ocupado_em)}` : ''}${x.inoperacional ? ' · inoperacional' : ''}</div></div>
          <span class="m">${esc(x.base)} · ${x.dist_km} km</span></label>`;
      }).join('') || '<div class="emp-vazio">Nada encontrado.</div>';
    };
    corpo.querySelector('#emp-af-tipo').onchange = lista;
    corpo.querySelector('#emp-af-q').oninput = lista;
    lista();
    corpo.querySelector('#emp-af-ok').onclick = async () => {
      const id = corpo.querySelector('input[name=emp-af]:checked')?.value;
      if (!id) return toast('Escolha um meio da lista.', 'err');
      const ehPessoa = corpo.querySelector('#emp-af-tipo').value === 'operacionais';
      const b = { [ehPessoa ? 'operacional_id' : 'viatura_id']: id, operacao: corpo.querySelector('#emp-af-op').value || null,
                  inicio: corpo.querySelector('#emp-af-ini').value, fim: corpo.querySelector('#emp-af-fim').value };
      const r = await apiFetch(`/api/demo/empreitadas/${e.id}/meios`, { method: 'POST', body: JSON.stringify(b) });
      if (r.error) return toast(r.error.message, 'err');
      closeModal('emp-modal-af');
      toast(e.estado === 'seleccionada' && r.data?.estado === 'planeada'
        ? 'Meio afectado. A empreitada passou a planeada.' : 'Meio afectado.');
      await recarregarEmpreitada(e.id);
    };
  }

  // ── Execução: previsto contra real ─────────────────────────────
  const dm = d => d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '—';
  const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const horas = x => `${fmt(x)} h`;

  // Desvio do real em relação ao que devia estar feito. Até 5 % não se assinala.
  function desvio(real, ref) {
    if (!ref) return real ? '<span class="emp-desvio acima">não previsto</span>' : '';
    const p = (real - ref) / ref * 100;
    const cls = Math.abs(p) <= 5 ? 'ok' : p > 0 ? 'acima' : 'abaixo';
    return `<span class="emp-desvio ${cls}">${p > 0 ? '+' : ''}${fmt(p, 0)} %</span>`;
  }
  // A barra vai até ao total previsto; o traço marca onde devia estar hoje.
  function barra(real, ate, total) {
    const max = Math.max(total, real) || 1;
    return `<div class="emp-barra-p"><i class="${real > ate * 1.05 ? 'acima' : ''}" style="width:${Math.min(100, real / max * 100)}%"></i>${
      total ? `<b style="left:calc(${Math.min(100, ate / max * 100)}% - 1px)"></b>` : ''}</div>`;
  }

  async function carregarExecucao(e) {
    const sec = document.getElementById('emp-ex-sec');
    if (!sec || !['planeada', 'em_execucao', 'concluida'].includes(e.estado) || !e.n_meios) return;
    const { data, error } = await apiFetch(`/api/demo/empreitadas/${e.id}/execucao`);
    if (st.sel?.id !== e.id) return;
    sec.style.display = '';
    if (error) { sec.innerHTML = `<div class="emp-vazio">${esc(error.message)}</div>`; return; }
    const t = data.totais;
    const comecou = data.dias_decorridos > 0;
    const linha = (nome, x, f) => `<div class="emp-ex-l"><span class="n">${nome}</span>${barra(x.real, x.previsto_ate, x.previsto)}
      <span class="v">${f(x.real)} ${desvio(x.real, x.previsto_ate)}</span></div>`;
    sec.innerHTML = `
      <div class="emp-sec-hdr"><span class="form-label">Execução</span>
        <b>${data.estado === 'concluida' ? `${data.dias_uteis} dias úteis` : comecou ? `dia ${data.dias_decorridos} de ${data.dias_uteis}` : `começa a ${dm(data.inicio)}`}</b></div>
      ${comecou ? `<div class="emp-ex-linhas">
          ${linha('CUSTO', { real: t.real, previsto_ate: t.previsto_ate, previsto: t.previsto }, eur)}
          ${linha('H. MÁQUINA', t.horas_maquina, horas)}
          ${linha('H. PESSOAS', t.horas_pessoas, horas)}
          ${linha(data.area.unidade === 'km' ? 'KM FEITOS' : 'ÁREA FEITA', data.area, x => `${fmt(x, data.area.unidade === 'km' ? 2 : 1)} ${data.area.unidade}`)}
        </div>
        ${data.area.declarado ? `<div class="emp-nota" style="margin-top:6px">Na área feita, ${fmt(data.area.declarado, 2)} ${data.area.unidade}
          vêm de registos declarados, sem geometria.</div>` : ''}
        <div class="emp-nota" style="margin-top:8px">Real até ${dm(data.corte)} contra o previsto até esse dia (o traço).</div>
        ${t.anomalias ? `<div class="emp-alerta">⚠ ${t.anomalias} registo${t.anomalias > 1 ? 's' : ''} com anomalia, fora das contas.</div>` : ''}
        ${t.dias_sem_registo ? `<div class="emp-alerta" style="color:var(--muted)">${t.dias_sem_registo} dia${t.dias_sem_registo > 1 ? 's' : ''}-meio afectos sem registo.</div>` : ''}`
      : `<div class="emp-vazio" style="padding:10px">Ainda não começou. Os registos da frota e das máquinas entram aqui a partir do primeiro dia.</div>`}
      <div class="emp-acoes">
        <button class="btn btn-primary btn-sm" id="emp-ex-ver" ${comecou ? '' : 'disabled'}>Ver execução</button>
        <button class="btn btn-ghost btn-sm" id="emp-ex-fh" ${data.inicio && data.inicio <= data.hoje ? '' : 'disabled'}>Folha de horas</button>
        <button class="btn btn-ghost btn-sm" id="emp-ex-ter" title="Registar no mapa o que ficou feito">Execução no terreno</button>
      </div>`;
    sec.querySelector('#emp-ex-ter').onclick = () => abrirTerreno(e);
    sec.querySelector('#emp-ex-ver').onclick = () => abrirExecucao(e);
    sec.querySelector('#emp-ex-fh').onclick = () => abrirFolha(e);
  }

  const GRUPOS_EX = [
    ['maquina',     'Máquinas', 'horas do conta-horas, registo das máquinas', 'h'],
    ['transporte',  'Porta-máquinas', 'km, registo da frota', 'km'],
    ['viatura',     'Viaturas ligeiras', 'km, registo da frota', 'km'],
    ['operacional', 'Operacionais', 'horas da folha diária, registadas aqui', 'h'],
  ];

  async function abrirExecucao(e) {
    const corpo = document.getElementById('emp-ex-corpo');
    corpo.innerHTML = '<div class="emp-vazio">A carregar…</div>';
    openModal('emp-modal-ex');
    const { data, error } = await apiFetch(`/api/demo/empreitadas/${e.id}/execucao`);
    if (error) { corpo.innerHTML = `<div class="emp-vazio">${esc(error.message)}</div>`; return; }
    const t = data.totais, ate = dm(data.corte);
    const tile = (titulo, grande, x, f) => `<div class="emp-ex-tile"><span class="t">${titulo}</span>
      <span class="g">${grande}</span>${barra(x.real, x.previsto_ate, x.previsto)}
      <span class="s"><span>previsto até ${ate}: ${f(x.previsto_ate)}</span>${desvio(x.real, x.previsto_ate)}</span>
      <span class="s"><span>total previsto: ${f(x.previsto)}</span></span></div>`;
    const anomalias = data.meios.flatMap(m => m.registos.filter(r => r.anomalia).map(r => ({ m, r })));
    const unid = m => (m.papel === 'transporte' || m.papel === 'viatura') ? 'km' : 'h';
    const val = (m, k) => unid(m) === 'km' ? `${fmt(m[k].km ?? 0, 0)} km` : horas(m[k].horas);

    corpo.innerHTML = `
      <div class="emp-ex-topo">${esc(data.codigo)} · ${esc(e.nome)} · ${dm(data.inicio)} a ${dm(data.fim)}, ${data.dias_uteis} dias úteis ·
        ${data.estado === 'concluida' ? 'concluída: compara-se com tudo o previsto' : `comparado até ${ate} (ontem), dia ${data.dias_decorridos} de ${data.dias_uteis}`}</div>
      <div class="emp-ex-tiles">
        ${tile('Custo', eur(t.real), { real: t.real, previsto_ate: t.previsto_ate, previsto: t.previsto }, eur)}
        ${tile('Horas de máquina', horas(t.horas_maquina.real), t.horas_maquina, horas)}
        ${tile('Horas de operacionais', horas(t.horas_pessoas.real), t.horas_pessoas, horas)}
        <div class="emp-ex-tile"><span class="t">Por resolver</span>
          <span class="g" style="${t.anomalias ? 'color:var(--warn)' : ''}">${t.anomalias}</span>
          <span class="s">registo${t.anomalias === 1 ? '' : 's'} com anomalia, fora das contas</span>
          <span class="s">${t.dias_sem_registo} dia${t.dias_sem_registo === 1 ? '' : 's'}-meio afectos sem registo · ${fmt(t.km, 0)} km na frota</span></div>
      </div>
      ${anomalias.length ? `<div class="emp-ex-anom"><div style="display:block;font-weight:600;margin-bottom:4px">Anomalias nos registos externos</div>${
        anomalias.map(({ m, r }) => `<div><span>${esc(m.rotulo)}</span><span class="m">n.º ${r.id} · ${dm(r.ini.slice(0, 10))}</span><span>${esc(r.anomalia)}</span></div>`).join('')}</div>` : ''}
      <div class="emp-ex-tab-wrap"><table class="emp-ex-tab">
        <thead><tr><th>Meio</th><th>Operação</th><th>Previsto</th><th>Até ${ate}</th><th>Real</th><th>Desvio</th>
          <th>Custo prev.</th><th>Custo real</th><th>Registos</th></tr></thead>
        <tbody>${GRUPOS_EX.map(([papel, nome, fonte]) => {
          const ms = data.meios.filter(m => m.papel === papel);
          if (!ms.length) return '';
          return `<tr class="grupo"><td colspan="9">${nome} · ${fonte}</td></tr>` + ms.map(m => `
            <tr class="meio" data-chave="${m.chave}" tabindex="0">
              <td>${esc(m.rotulo)}<div class="sub">${esc(m.detalhe || '')} · ${esc(m.base || '—')}</div></td>
              <td>${esc(m.operacoes.join(', '))}</td>
              <td>${val(m, 'previsto')}</td><td>${val(m, 'previsto_ate')}</td><td>${val(m, 'real')}</td>
              <td>${unid(m) === 'km' ? desvio(m.real.km, m.previsto_ate.km) : desvio(m.real.horas, m.previsto_ate.horas)}</td>
              <td>${eur(m.previsto.custo)}</td><td>${eur(m.real.custo)}</td>
              <td>${m.real.registos}${m.anomalias ? ` <span style="color:var(--warn)">+${m.anomalias} ⚠</span>` : ''}${
                m.dias_sem_registo.length ? `<div class="sub" title="${m.dias_sem_registo.map(dm).join(', ')}">${m.dias_sem_registo.length} dia${m.dias_sem_registo.length > 1 ? 's' : ''} sem registo</div>` : ''}</td>
            </tr>
            <tr class="regs" data-de="${m.chave}" hidden><td colspan="9">${tabelaRegistos(m)}</td></tr>`).join('');
        }).join('')}</tbody></table></div>
      <p class="emp-nota">Os registos externos não dizem a que empreitada servem: conta para esta o que cai nos dias em que o meio
        lhe está afecto. Um registo com anomalia mostra-se mas fica fora das contas, até ser corrigido na origem. Custo real das máquinas:
        horas do conta-horas × €/h, mais a parte fixa prevista (mobilização, deslocação). Viaturas: km × €/km. Operacionais: horas da folha × €/h.
        Custos e rendimentos <b>simulados</b>. Clique num meio para ver os registos.</p>`;
    corpo.querySelectorAll('tr.meio').forEach(tr => {
      const abrir = () => { const s = corpo.querySelector(`tr.regs[data-de="${tr.dataset.chave}"]`); s.hidden = !s.hidden; };
      tr.onclick = abrir;
      tr.onkeydown = ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); abrir(); } };
    });
  }

  function tabelaRegistos(m) {
    if (!m.registos.length) return '<span class="sub">Sem registos nos dias afectos.</span>';
    const linhas = m.registos.map(r => {
      const nota = r.anomalia || r.aviso || r.obs || '';
      const cls = r.anomalia ? 'mau' : '';
      if (r.fonte === 'folha')
        return `<tr><td>${dm(r.ini.slice(0, 10))}</td><td>${r.ini.slice(11)}–${r.fim.slice(11)}</td><td>${horas(r.horas)}</td>
          <td>${esc(r.operacao || '')}</td><td>${esc(nota)}</td></tr>`;
      const fim = r.fim ? (r.fim.slice(0, 10) === r.ini.slice(0, 10) ? r.fim.slice(11) : `${dm(r.fim.slice(0, 10))} ${r.fim.slice(11)}`) : '—';
      const medida = r.fonte === 'maquinas' ? (r.horas == null ? '—' : horas(r.horas)) : (r.km == null ? '—' : `${r.km} km`);
      return `<tr class="${cls}"><td>n.º ${r.id}</td><td>${dm(r.ini.slice(0, 10))} ${r.ini.slice(11)}–${fim}</td><td>${medida}</td>
        <td>${esc(r.origem || '')} → ${esc(r.destino || '')}</td><td>${esc(r.pessoa || '')}</td><td>${r.anomalia ? '⚠ ' : ''}${esc(nota)}</td></tr>`;
    }).join('');
    return `<table class="r"><tbody>${linhas}</tbody></table>`;
  }

  // ── Folha de horas dos operacionais ────────────────────────────
  const minutosDe = h => { const [a, b] = (h || '0:0').split(':').map(Number); return a * 60 + b; };

  async function abrirFolha(e, data) {
    const corpo = document.getElementById('emp-fh-corpo');
    if (!document.getElementById('emp-modal-fh').classList.contains('open')) {
      corpo.innerHTML = '<div class="emp-vazio">A carregar…</div>';
      openModal('emp-modal-fh');
    }
    const { data: f, error } = await apiFetch(`/api/demo/empreitadas/${e.id}/horas${data ? `?data=${data}` : ''}`);
    if (error) { corpo.innerHTML = `<div class="emp-vazio">${esc(error.message)}</div>`; return; }
    // Dia por registar (menos de metade com horas): quem ainda não tem horas
    // vem marcado como presente, e desmarcam-se as faltas.
    const comHoras = f.linhas.filter(l => l.registos.length).length;
    const diaVazio = comHoras * 2 < f.linhas.length;
    const opcoes = sel => ['', ...f.operacoes].map(o => `<option value="${o}"${o === (sel || '') ? ' selected' : ''}>${o || '—'}</option>`).join('');
    const linhas = f.linhas.flatMap(l => (l.registos.length ? l.registos : [null]).map(r => {
      const pres = !!r || diaVazio;
      return `<tr data-op="${l.operacional_id}" class="${pres ? '' : 'ausente'}">
        <td><input type="checkbox" class="pres" ${pres ? 'checked' : ''} aria-label="Presente: ${esc(l.nome)}"/></td>
        <td><div>${esc(l.nome)}${l.fora_do_periodo ? '<span class="emp-tag">FORA DO PERÍODO</span>' : ''}</div>
          <div style="font-size:10px;color:var(--muted)">${esc(l.cargo || '')} · ${esc(l.base || '')}</div></td>
        <td><select class="form-select op">${opcoes(r?.operacao || l.operacao)}</select></td>
        <td><input type="time" class="form-input ini" value="${r?.hora_inicio || '08:00'}" step="900"/></td>
        <td><input type="time" class="form-input fim" value="${r?.hora_fim || '16:00'}" step="900"/></td>
        <td><input type="number" class="form-input pausa" min="0" max="180" step="15" value="${r?.pausa_min ?? 60}"/></td>
        <td class="h"></td>
        <td><input class="form-input obs" value="${esc(r?.observacoes || '')}" placeholder="—"/></td></tr>`;
    })).join('');
    const sem = d => SEMANA[new Date(`${d}T12:00:00Z`).getUTCDay()];
    corpo.innerHTML = `
      <div class="emp-fh-dias" role="tablist" aria-label="Dias da empreitada">${f.dias.map(d => {
        const cls = d.registados >= d.afectos ? 'completo' : d.registados ? 'parcial' : '';
        return `<button type="button" class="emp-fh-dia ${cls}${d.data === f.data ? ' sel' : ''}" data-dia="${d.data}" role="tab"
          aria-selected="${d.data === f.data}">${sem(d.data)} ${dm(d.data)}<small>${d.registados}/${d.afectos}</small></button>`;
      }).join('')}</div>
      <div style="display:flex;gap:10px;align-items:baseline;margin-top:12px;flex-wrap:wrap">
        <b style="font-family:'Barlow Condensed',sans-serif;font-size:18px;letter-spacing:.03em">${sem(f.data)}, ${f.data.split('-').reverse().join('/')}</b>
        <span style="font-size:12px;color:var(--muted)">${f.linhas.length} operaciona${f.linhas.length === 1 ? 'l afecto' : 'is afectos'} neste dia${
          diaVazio ? ' · dia por registar: quem não tem horas vem marcado como presente, desmarque as faltas' : ''}</span>
        <span style="margin-left:auto;font-family:'IBM Plex Mono',monospace;font-size:12px" id="emp-fh-total"></span>
      </div>
      <div style="overflow-x:auto"><table class="emp-fh-tab">
        <thead><tr><th></th><th>Operacional</th><th>Operação</th><th>Início</th><th>Fim</th><th>Pausa min</th><th style="text-align:right">Horas</th><th>Observações</th></tr></thead>
        <tbody>${linhas || '<tr><td colspan="8"><div class="emp-vazio">Ninguém afecto neste dia.</div></td></tr>'}</tbody></table></div>
      <div class="modal-actions" style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;flex-wrap:wrap">
        <button class="btn btn-ghost" id="emp-fh-todos" style="margin-right:auto">Todos 08:00–16:00</button>
        <button class="btn btn-ghost" onclick="closeModal('emp-modal-fh')">Fechar</button>
        <button class="btn btn-primary" id="emp-fh-gravar">Guardar ${dm(f.data)}</button></div>`;

    const recontar = () => {
      let total = 0, n = 0;
      corpo.querySelectorAll('tbody tr[data-op]').forEach(tr => {
        const pres = tr.querySelector('.pres').checked;
        tr.classList.toggle('ausente', !pres);
        const h = (minutosDe(tr.querySelector('.fim').value) - minutosDe(tr.querySelector('.ini').value) - (+tr.querySelector('.pausa').value || 0)) / 60;
        tr.querySelector('.h').textContent = h > 0 ? horas(h) : '—';
        if (pres && h > 0) { total += h; n++; }
      });
      corpo.querySelector('#emp-fh-total').textContent = `${n} presente${n === 1 ? '' : 's'} · ${horas(total)}`;
    };
    corpo.querySelectorAll('tbody input, tbody select').forEach(x => x.addEventListener('input', recontar));
    recontar();
    corpo.querySelectorAll('[data-dia]').forEach(b => b.onclick = () => abrirFolha(e, b.dataset.dia));
    corpo.querySelector('.emp-fh-dia.sel')?.scrollIntoView({ block: 'nearest', inline: 'center' });
    corpo.querySelector('#emp-fh-todos').onclick = () => {
      corpo.querySelectorAll('tbody tr[data-op]').forEach(tr => {
        tr.querySelector('.pres').checked = true;
        tr.querySelector('.ini').value = '08:00'; tr.querySelector('.fim').value = '16:00'; tr.querySelector('.pausa').value = 60;
      });
      recontar();
    };
    corpo.querySelector('#emp-fh-gravar').onclick = async () => {
      const registos = [...corpo.querySelectorAll('tbody tr[data-op]')].filter(tr => tr.querySelector('.pres').checked).map(tr => ({
        operacional_id: tr.dataset.op, operacao: tr.querySelector('.op').value || null,
        hora_inicio: tr.querySelector('.ini').value, hora_fim: tr.querySelector('.fim').value,
        pausa_min: +tr.querySelector('.pausa').value, observacoes: tr.querySelector('.obs').value || null,
      }));
      const r = await apiFetch(`/api/demo/empreitadas/${e.id}/horas`, { method: 'PUT', body: JSON.stringify({ data: f.data, registos }) });
      if (r.error) return toast(r.error.message, 'err');
      toast(`${dm(f.data)}: ${r.data.registos} registo${r.data.registos === 1 ? '' : 's'} de horas guardado${r.data.registos === 1 ? '' : 's'}.`);
      await abrirFolha(e, f.data);
      await carregar();
      desenharTudo();
    };
  }

  // ── Execução no terreno: registar o que ficou feito ────────────
  //
  // Por cima do mapa, as parcelas da empreitada pintadas pelo que já está
  // feito na operação escolhida. Regista-se tocando nas parcelas, desenhando
  // (um polígono, ou o início e o fim de um troço do eixo) ou declarando
  // uma quantidade sem geometria. As contas são do servidor.
  const ORIGENS = { parcelas: 'Parcelas', desenho: 'Desenhado', declarado: 'Declarado' };
  const hojeISO = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Lisbon' });

  async function abrirTerreno(e) {
    const { data, error } = await apiFetch(`/api/demo/empreitadas/${e.id}/terreno`);
    if (error) return toast(error.message, 'err');
    cancelarDesenho();
    const op = data.operacoes.find(o => o.pct < 100)?.operacao || data.operacoes[0]?.operacao;
    st.ter = { e, d: data, op, modo: 'parcelas', sel: new Set(), pts: [], partes: [], cortes: [],
               dia: hojeISO(), layer: L.layerGroup().addTo(st.mapa) };
    st.mapa.doubleClickZoom.disable();
    desenharTerreno();
    desenharDetalhe();
    const c = st.porId.get(e.id);
    if (c) st.mapa.fitBounds(c.getBounds(), { padding: [50, 50], maxZoom: 17 });
  }

  async function recarregarTerreno() {
    const { data, error } = await apiFetch(`/api/demo/empreitadas/${st.ter.e.id}/terreno`);
    if (error) return toast(error.message, 'err');
    st.ter.d = data;
    st.ter.sel.clear(); st.ter.pts = [];
    desenharTerreno();
    desenharDetalhe();
  }

  async function fecharTerreno() {
    if (!st.ter) return;
    st.mapa.removeLayer(st.ter.layer);
    st.mapa.doubleClickZoom.enable();
    document.getElementById('emp-ter-barra').style.display = 'none';
    document.getElementById('emp-mapa').style.cursor = '';
    const id = st.ter.e.id;
    st.ter = null;
    await carregar();
    desenharTudo();
    seleccionar('empreitada', id, false);
  }

  const linear = () => st.ter.d.geometria !== 'poligono';
  const unTer = () => st.ter.d.unidade;
  const fmtQ = q => `${fmt(q, 2)} ${unTer()}`;
  const corOp = () => MODOS[st.ter.d.operacoes.find(o => o.operacao === st.ter.op)?.modo]?.cor || tok('--accent3');
  // Uma parcela ou registo do eixo: na faixa, desenha-se com a largura.
  const geomTer = g => (st.ter.d.geometria === 'faixa' && g.type === 'LineString'
    ? faixaPoligono(g.coordinates, st.ter.d.largura_m) : g);

  function desenharTerreno() {
    const t = st.ter, d = t.d, cor = corOp(), acc = tok('--accent3'), txt = tok('--text');
    t.layer.clearLayers();
    const divisao = t.modo === 'divisao';
    const clicavel = t.modo === 'parcelas';
    document.getElementById('emp-mapa').style.cursor = ['desenho', 'divisao'].includes(t.modo) ? 'crosshair' : '';
    // As parcelas, pelo que já está feito na operação escolhida.
    for (const p of divisao && t.previa ? [] : d.parcelas) {
      const f = p.feito[t.op] || 0, sel = t.sel.has(p.id);
      const estilo = {
        color: sel ? acc : txt, weight: sel ? 3 : 1, opacity: sel ? 1 : .55,
        fillColor: sel ? acc : cor, fillOpacity: sel ? .45 : f >= .95 ? .6 : f > .05 ? .3 : .04,
      };
      L.geoJSON(geomTer(p.geom), { style: () => estilo, interactive: clicavel })
        .bindTooltip(`Parcela ${p.n} · ${fmtQ(p.quantidade)} · ${fmt(f * 100, 0)} % feito em ${t.op}`, { sticky: true })
        .on('click', ev => { if (!clicavel) return; L.DomEvent.stop(ev); t.sel.has(p.id) ? t.sel.delete(p.id) : t.sel.add(p.id); desenharTerreno(); })
        .addTo(t.layer);
    }
    // O executado da operação (união dos registos): mostra também o que foi desenhado só em parte.
    const ex = d.operacoes.find(o => o.operacao === t.op)?.geom;
    if (ex && !divisao) {
      const g = ex.type === 'MultiLineString' && d.geometria === 'faixa'
        ? ex.coordinates.map(c => faixaPoligono(c, d.largura_m)) : ex;
      L.geoJSON(g, { interactive: false, style: () => ({ color: cor, weight: d.geometria === 'linha' ? 6 : 1.5,
        fillColor: cor, fillOpacity: .35, opacity: .9 }) }).addTo(t.layer);
    }
    // Desenho em curso: vértices do polígono, ou pontos no eixo.
    const lls = t.pts.map(([lon, lat]) => [lat, lon]);
    if (lls.length) {
      if (!linear() && lls.length >= 3) L.polygon(lls, { color: acc, weight: 2, fillOpacity: .25, interactive: false }).addTo(t.layer);
      else if (!linear()) L.polyline(lls, { color: acc, weight: 2, interactive: false }).addTo(t.layer);
      lls.forEach(ll => L.circleMarker(ll, { radius: 5, color: acc, fillColor: '#fff', fillOpacity: 1, weight: 2, interactive: false }).addTo(t.layer));
    }
    // Divisão à mão: as partes já fechadas, ou os cortes no eixo.
    if (divisao) {
      t.partes.forEach((g, i) => L.geoJSON(g, { interactive: false, style: () => ({ color: acc, weight: 2, fillOpacity: .15 }) })
        .bindTooltip(`Parte ${i + 1}`, { permanent: false }).addTo(t.layer));
      t.cortes.forEach(([lon, lat]) => L.circleMarker([lat, lon], { radius: 6, color: acc, fillColor: acc, fillOpacity: 1, interactive: false }).addTo(t.layer));
      if (t.previa) L.geoJSON(t.previa, { interactive: false, style: () => ({ color: txt, weight: 1, fillOpacity: .05, dashArray: '3 4' }) }).addTo(t.layer);
    }
    barraTerreno();
  }

  function barraTerreno() {
    const t = st.ter, d = t.d, el = document.getElementById('emp-ter-barra');
    el.style.display = 'flex';
    if (t.modo === 'divisao') { barraDivisao(el); return; }
    const seg = Object.entries(ORIGENS).map(([k, n]) => `<button data-m="${k}" class="${t.modo === k ? 'on' : ''}">${n}</button>`).join('');
    let info = '', extra = '';
    if (t.modo === 'parcelas') {
      const ps = d.parcelas.filter(p => t.sel.has(p.id));
      info = ps.length ? `<b>${ps.length}</b> parcela${ps.length > 1 ? 's' : ''} · <b>${fmtQ(ps.reduce((s, p) => s + p.quantidade, 0))}</b>`
                       : 'Toque nas parcelas feitas nesse dia.';
    } else if (t.modo === 'desenho') {
      info = linear() ? `Marque no eixo o início e o fim do troço feito (${t.pts.length}/2).`
        : t.pts.length < 3 ? `Clique no mapa os vértices do que ficou feito (${t.pts.length}/3).`
        : `<b>${t.pts.length}</b> vértices · duplo clique ou Guardar`;
    } else {
      extra = `<input class="form-input" id="emp-t-q" type="number" min="0.01" step="0.01" placeholder="${unTer()}" style="width:80px" value="${t.qDecl ?? ''}"/>
        <input class="form-input" id="emp-t-obs" placeholder="Onde foi feito (obrigatório)" style="width:200px" value="${esc(t.obsDecl || '')}"/>`;
      info = 'Sem geometria: fica assinalado.';
    }
    el.innerHTML = `
      <select class="form-select" id="emp-t-op">${d.operacoes.map(o => `<option value="${o.operacao}"${o.operacao === t.op ? ' selected' : ''}>${o.operacao}</option>`).join('')}</select>
      <input class="form-input" type="date" id="emp-t-dia" value="${t.dia}" max="${hojeISO()}" style="width:132px"/>
      <span class="emp-seg">${seg}</span>
      ${extra}
      <span class="info">${info}</span>
      ${t.modo === 'desenho' ? `<button class="btn btn-ghost btn-xs" id="emp-t-desf"${t.pts.length ? '' : ' disabled'}>Desfazer</button>` : ''}
      <button class="btn btn-primary btn-xs" id="emp-t-ok">Guardar</button>
      <button class="btn btn-ghost btn-xs" id="emp-t-div" title="Grelha automática ou divisão à mão">Divisão…</button>
      <button class="btn btn-ghost btn-xs" id="emp-t-sair">Sair</button>`;
    el.querySelector('#emp-t-op').onchange = ev => { t.op = ev.target.value; desenharTerreno(); desenharDetalhe(); };
    el.querySelector('#emp-t-dia').onchange = ev => { t.dia = ev.target.value; };
    el.querySelectorAll('.emp-seg button').forEach(b => b.onclick = () => { t.modo = b.dataset.m; t.sel.clear(); t.pts = []; desenharTerreno(); });
    const q = el.querySelector('#emp-t-q'), o = el.querySelector('#emp-t-obs');
    if (q) q.oninput = () => { t.qDecl = q.value; };
    if (o) o.oninput = () => { t.obsDecl = o.value; };
    el.querySelector('#emp-t-desf')?.addEventListener('click', () => { t.pts.pop(); desenharTerreno(); });
    el.querySelector('#emp-t-ok').onclick = guardarRegisto;
    el.querySelector('#emp-t-div').onclick = () => { t.modo = 'divisao'; t.sub = d.divisao.modo === 'manual' ? 'manual' : 'grelha';
      t.pts = []; t.partes = []; t.cortes = []; t.previa = null; desenharTerreno(); };
    el.querySelector('#emp-t-sair').onclick = fecharTerreno;
  }

  function terrenoClique(ll) {
    const t = st.ter, p = [+ll.lng.toFixed(6), +ll.lat.toFixed(6)];
    if (t.modo === 'desenho') {
      if (linear() && t.pts.length >= 2) t.pts = [];
      t.pts.push(p);
    } else if (t.modo === 'divisao' && t.sub === 'manual') {
      if (linear()) t.cortes.push(p); else t.pts.push(p);
    } else return;
    desenharTerreno();
  }
  function terrenoDuploClique() {
    const t = st.ter;
    if (t.modo === 'desenho' && !linear() && t.pts.length >= 3) guardarRegisto();
    else if (t.modo === 'divisao' && t.sub === 'manual' && !linear()) fecharParte();
  }

  async function guardarRegisto() {
    const t = st.ter;
    const b = { operacao: t.op, data: t.dia, origem: t.modo };
    if (t.modo === 'parcelas') {
      if (!t.sel.size) return toast('Toque nas parcelas que ficaram feitas.', 'err');
      b.parcelas = [...t.sel];
    } else if (t.modo === 'desenho') {
      if (linear()) { if (t.pts.length !== 2) return toast('Marque o início e o fim do troço.', 'err'); b.pontos = t.pts; }
      else { if (t.pts.length < 3) return toast('O polígono precisa de três vértices.', 'err'); b.geom = { type: 'Polygon', coordinates: [[...t.pts, t.pts[0]]] }; }
    } else {
      b.quantidade = Number(t.qDecl); b.observacoes = t.obsDecl;
    }
    const { data, error } = await apiFetch(`/api/demo/empreitadas/${t.e.id}/registos`, { method: 'POST', body: JSON.stringify(b) });
    if (error) return toast(error.message, 'err');
    toast(`${t.op} em ${dm(t.dia)}: +${fmtQ(data.novo)} novos (total ${fmtQ(data.total)}, ${fmt(data.pct, 0)} %).` +
          (data.estado === 'em_execucao' && t.e.estado === 'planeada' ? ' A empreitada passou a em execução.' : ''));
    if (data.estado !== t.e.estado) t.e = { ...t.e, estado: data.estado };
    t.qDecl = ''; t.obsDecl = '';
    await recarregarTerreno();
  }

  // ── Divisão da empreitada em parcelas
  function barraDivisao(el) {
    const t = st.ter, d = t.d, lin = linear();
    const unid = lin ? 'm' : 'ha';
    const tam = d.divisao.modo === 'grelha' ? d.divisao.tamanho : d.padrao;
    el.innerHTML = `
      <span class="emp-seg"><button data-s="grelha" class="${t.sub === 'grelha' ? 'on' : ''}">Grelha</button><button data-s="manual" class="${t.sub === 'manual' ? 'on' : ''}">À mão</button></span>
      ${t.sub === 'grelha'
        ? `<span class="info">${lin ? 'Troços de' : 'Células de'}</span>
           <input class="form-input" id="emp-t-tam" type="number" min="${d.limites[0]}" max="${d.limites[1]}" step="${lin ? 10 : 0.1}" value="${tam}" style="width:72px"/>
           <span class="info">${unid}</span>
           <button class="btn btn-primary btn-xs" id="emp-t-gerar">Gerar grelha</button>`
        : lin
          ? `<span class="info">Clique no eixo onde quer cortar: <b>${t.cortes.length}</b> corte${t.cortes.length === 1 ? '' : 's'}.</span>
             <button class="btn btn-ghost btn-xs" id="emp-t-desf"${t.cortes.length ? '' : ' disabled'}>Desfazer</button>
             <button class="btn btn-primary btn-xs" id="emp-t-gman"${t.cortes.length ? '' : ' disabled'}>Guardar divisão</button>`
          : `<span class="info">Parte ${t.partes.length + 1}: ${t.pts.length} vértices · duplo clique fecha a parte.
               ${t.partes.length ? `<b>${t.partes.length}</b> fechada${t.partes.length > 1 ? 's' : ''}; o resto fica numa parcela.` : ''}</span>
             <button class="btn btn-ghost btn-xs" id="emp-t-desf"${t.pts.length || t.partes.length ? '' : ' disabled'}>Desfazer</button>
             <button class="btn btn-ghost btn-xs" id="emp-t-fparte"${t.pts.length >= 3 ? '' : ' disabled'}>Fechar parte</button>
             <button class="btn btn-primary btn-xs" id="emp-t-gman"${t.partes.length ? '' : ' disabled'}>Guardar divisão</button>`}
      <button class="btn btn-ghost btn-xs" id="emp-t-volta">Voltar</button>`;
    el.querySelectorAll('[data-s]').forEach(b => b.onclick = () => { t.sub = b.dataset.s; t.pts = []; t.partes = []; t.cortes = []; desenharTerreno(); });
    el.querySelector('#emp-t-volta').onclick = () => { t.modo = 'parcelas'; t.pts = []; t.partes = []; t.cortes = []; desenharTerreno(); };
    el.querySelector('#emp-t-gerar')?.addEventListener('click', () =>
      guardarDivisao({ modo: 'grelha', tamanho: Number(el.querySelector('#emp-t-tam').value) }));
    el.querySelector('#emp-t-desf')?.addEventListener('click', () => {
      if (lin) t.cortes.pop(); else if (t.pts.length) t.pts.pop(); else t.partes.pop();
      desenharTerreno();
    });
    el.querySelector('#emp-t-fparte')?.addEventListener('click', fecharParte);
    el.querySelector('#emp-t-gman')?.addEventListener('click', () =>
      guardarDivisao(lin ? { modo: 'manual', cortes: t.cortes } : { modo: 'manual', partes: t.partes }));
  }
  function fecharParte() {
    const t = st.ter;
    if (t.pts.length < 3) return;
    t.partes.push({ type: 'Polygon', coordinates: [[...t.pts, t.pts[0]]] });
    t.pts = [];
    desenharTerreno();
  }
  async function guardarDivisao(b) {
    const t = st.ter;
    if (!confirm('Substituir a divisão actual?\n\nOs registos já feitos não mudam: guardam a própria geometria.')) return;
    const { data, error } = await apiFetch(`/api/demo/empreitadas/${t.e.id}/divisao`, { method: 'PUT', body: JSON.stringify(b) });
    if (error) return toast(error.message, 'err');
    toast(`Divisão guardada: ${data.parcelas.length} parcelas.`);
    t.d = data; t.modo = 'parcelas'; t.pts = []; t.partes = []; t.cortes = []; t.sel.clear();
    desenharTerreno();
    desenharDetalhe();
  }

  // ── Painel lateral: progresso por operação e registos
  function painelTerreno(el) {
    const t = st.ter, d = t.d;
    const div = d.divisao.modo === 'grelha'
      ? `grelha de ${d.geometria === 'poligono' ? `${fmt(d.divisao.tamanho)} ha` : `${fmt(d.divisao.tamanho, 0)} m`}`
      : 'divisão à mão';
    const ops = d.operacoes.map(o => `
      <span class="c" style="color:${MODOS[o.modo]?.cor || 'inherit'}">${o.operacao}</span>
      ${barra(o.total, o.planeado, o.planeado)}
      <span class="v">${fmt(o.pct, 0)} %</span>
      <span class="d">${fmtQ(o.total)} de ${fmtQ(o.planeado)}${o.declarado ? ` · dos quais ${fmtQ(o.declarado)} declarados` : ''}</span>`).join('');
    const regs = d.registos.map(r => `
      <div class="emp-ter-reg${r.anulado ? ' anulado' : ''}">
        <span class="dt">${dm(r.data)}</span>
        <span><b>${r.operacao}</b> <span class="emp-tag${r.origem === 'declarado' ? ' decl' : ''}">${r.origem === 'declarado' ? 'DECLARADO · SEM GEOMETRIA' : ORIGENS[r.origem].toUpperCase()}</span></span>
        <span class="q">${fmtQ(r.quantidade)}</span>
        <span class="m">${esc(r.autor || 'Cenário da demonstração')} · ${dm(r.criado.slice(0, 10))} ${r.criado.slice(11)}${r.observacoes ? ` · ${esc(r.observacoes)}` : ''}
          ${r.anulado ? ` · anulado por ${esc(r.anulado_por || '—')}` : r.pode_anular ? ` · <a href="#" data-anular="${r.id}">anular</a>` : ''}</span>
      </div>`).join('');
    el.innerHTML = `
      <div class="emp-eyebrow">${esc(d.codigo)} · execução no terreno · ${d.parcelas.length} parcelas, ${div}</div>
      <h3>${esc(t.e.nome)}</h3>
      <div class="emp-ter-op">${ops}</div>
      <div class="emp-nota">O feito é a união dos registos, recortada pela área: o que se marca duas vezes conta uma.
        ${d.geometria === 'faixa' ? `Na faixa, mede-se ao longo do eixo × ${fmt(d.largura_m, 0)} m.` : ''}</div>
      <div class="emp-sec">
        <div class="emp-sec-hdr"><span class="form-label">Registos</span><b>${d.registos.filter(r => !r.anulado).length}</b></div>
        ${regs || '<div class="emp-vazio" style="padding:12px">Ainda nada registado.</div>'}
      </div>
      <div class="emp-acoes"><button class="btn btn-ghost btn-sm" id="emp-t-fechar">Sair da execução no terreno</button></div>`;
    el.querySelector('#emp-t-fechar').onclick = fecharTerreno;
    el.querySelectorAll('[data-anular]').forEach(a => a.onclick = async ev => {
      ev.preventDefault();
      if (!confirm('Anular este registo? Fica no histórico, riscado, e deixa de contar.')) return;
      const { error } = await apiFetch(`/api/demo/empreitadas/${t.e.id}/registos/${a.dataset.anular}`, { method: 'DELETE' });
      if (error) return toast(error.message, 'err');
      toast('Registo anulado.');
      await recarregarTerreno();
    });
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
        <option value="faixa"${d.tipo === 'faixa' ? ' selected' : ''}>Faixa (linha com largura)</option>
        <option value="linha"${d.tipo === 'linha' ? ' selected' : ''}>Linha (rede viária)</option></select>
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
    if (d.pts.length < 2) return null;     // linha ou faixa: o comprimento
    let s = 0;
    for (let i = 1; i < d.pts.length; i++)
      s += Math.hypot((d.pts[i][0] - d.pts[i - 1][0]) * mLon(d.pts[i][1]), (d.pts[i][1] - d.pts[i - 1][1]) * mLat);
    return s / 1000;
  }
  function medirDesenho() {
    const v = valorDesenho();
    return v == null ? '' : st.desenho.tipo === 'poligono' ? `${fmt(v)} ha` : `${fmt(v, 2)} km`;  // faixa: a largura vem a seguir
  }

  function concluirDesenho() {
    const d = st.desenho;
    if (!d || d.pts.length < (d.tipo === 'poligono' ? 3 : 2)) return;
    abrirModalEmpreitada({ geom: geomDesenho(), tipo: d.tipo, medida: +valorDesenho().toFixed(3) });
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
          <div class="modal-title" id="emp-m-titulo">Nova empreitada</div>
          <div id="emp-m-corpo"></div>
        </div>
      </div>
      <div class="modal-overlay" id="emp-modal-rec">
        <div class="modal">
          <button class="modal-close" onclick="closeModal('emp-modal-rec')">✕</button>
          <div class="modal-title">Recomendar meios</div>
          <div id="emp-rec-corpo"></div>
        </div>
      </div>
      <div class="modal-overlay" id="emp-modal-af">
        <div class="modal">
          <button class="modal-close" onclick="closeModal('emp-modal-af')">✕</button>
          <div class="modal-title">Afectar meio</div>
          <div id="emp-af-corpo"></div>
        </div>
      </div>
      <div class="modal-overlay" id="emp-modal-ex">
        <div class="modal">
          <button class="modal-close" onclick="closeModal('emp-modal-ex')">✕</button>
          <div class="modal-title">Execução — previsto e real</div>
          <div id="emp-ex-corpo"></div>
        </div>
      </div>
      <div class="modal-overlay" id="emp-modal-fh">
        <div class="modal">
          <button class="modal-close" onclick="closeModal('emp-modal-fh')">✕</button>
          <div class="modal-title">Folha de horas dos operacionais</div>
          <div id="emp-fh-corpo"></div>
        </div>
      </div>`);
  }

  // Nova empreitada: a partir de um pedido ({ pedido }) ou de um desenho
  // ({ geom, tipo, medida } — medida em ha no polígono, em km na linha e na
  // faixa). O pedido não traz intervenção nem povoamento: escolhem-se aqui,
  // com a operação sugerida pelo tipo de rede.
  function abrirModalEmpreitada(o) {
    const p = o.pedido;
    const tipo = p ? (p.camada === 'linhas' ? 'faixa' : 'poligono') : o.tipo;
    const kmFaixa = p ? p.comprim_m / 1000 : o.medida;
    let largura = p ? Number(p.largura_m) : 10;
    const area = () => tipo === 'faixa' ? +(kmFaixa * largura / 10).toFixed(2) : p ? Number(p.area_ha) : o.medida;
    const ops = linhasOperacoes([], tipo);
    const sugerida = p ? st.cat.sugestao_rede[p.tiporede] : null;
    const corpo = document.getElementById('emp-m-corpo');
    document.getElementById('emp-m-titulo').textContent = p ? `Seleccionar o pedido ${p.codpedido}` : 'Nova empreitada';
    const intro = p
      ? `${GEOM[tipo]} do pedido, com ${medida(p)}. ${REDES[p.tiporede]?.nome || ''} (${esc(p.tiporede)}).
         O pedido não diz que intervenção fazer: confirme as operações${sugerida ? ` (sugerida: ${sugerida})` : ''} e o povoamento.`
      : `${GEOM[tipo]} desenhad${tipo === 'faixa' ? 'a' : 'o'} com ${tipo === 'poligono' ? `${fmt(o.medida)} ha` : `${fmt(o.medida, 2)} km`}.
         Não está em nenhum pedido: fica registada como criada de raiz.`;
    corpo.innerHTML = `
      <p style="font-size:12px;color:var(--muted);margin:0 0 14px;line-height:1.5">${intro}</p>
      <div class="form-grid">
        <div class="form-field span2"><label class="form-label">Nome</label><input class="form-input" id="emp-m-nome"
          value="${p ? esc(`${p.localtrab} — ${p.codpedido}`) : ''}" placeholder="Ex.: Faixa de gestão — Serra de …"/></div>
        <div class="form-field"><label class="form-label">Povoamento</label><select class="form-select" id="emp-m-pov">${
          Object.entries(POV).map(([k, n]) => `<option value="${k}"${k === '4' ? ' selected' : ''}>${n}</option>`).join('')}</select></div>
        <div class="form-field">${tipo === 'faixa' && !p
          ? `<label class="form-label">Largura da faixa (m)</label><input class="form-input" type="number" min="1" max="500" step="1" id="emp-m-larg" value="${largura}"/>`
          : ''}</div>
        <div class="form-field span2"><label class="form-label">Responsável</label><select class="form-select" id="emp-m-resp">${opcoesResponsavel(null)}</select></div>
        <div class="form-field"><label class="form-label">Início previsto</label><input class="form-input" type="date" id="emp-m-ini" value="${p?.datainicio || ''}"/></div>
        <div class="form-field"><label class="form-label">Fim previsto</label><input class="form-input" type="date" id="emp-m-fim" value="${p?.datafim || ''}"/></div>
      </div>
      <div class="form-label" style="margin-top:16px">Operações</div>
      <table class="emp-ops" id="emp-m-ops"><tbody>${ops.nova(area(), sugerida)}</tbody></table>
      <button class="btn btn-ghost btn-xs" id="emp-m-op-add" style="margin-top:4px">+ Operação</button>
      <div class="form-field" style="margin-top:14px"><label class="form-label">Observações</label>
        <textarea class="form-textarea" id="emp-m-obs" rows="2">${p?.observa ? esc(p.observa) : ''}</textarea></div>
      <div class="modal-actions" style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px">
        <button class="btn btn-ghost" onclick="closeModal('emp-modal')">${p ? 'Cancelar' : 'Voltar ao desenho'}</button>
        <button class="btn btn-primary" id="emp-m-criar">Criar empreitada</button>
      </div>`;
    const tabela = corpo.querySelector('#emp-m-ops');
    corpo.querySelector('#emp-m-op-add').onclick = ligarOperacoes(tabela, () => ops.nova(area()));
    const larg = corpo.querySelector('#emp-m-larg');
    // Mudar a largura muda a área: acompanham as quantidades ainda iguais à área antiga.
    if (larg) larg.oninput = () => {
      const antes = area();
      largura = Number(larg.value) || largura;
      tabela.querySelectorAll('.emp-op-q').forEach(i => { if (Number(i.value) === antes) i.value = area(); });
    };
    corpo.querySelector('#emp-m-criar').onclick = async () => {
      const b = {
        nome: corpo.querySelector('#emp-m-nome').value, tipo_pov: +corpo.querySelector('#emp-m-pov').value,
        responsavel_id: corpo.querySelector('#emp-m-resp').value || null,
        inicio_previsto: corpo.querySelector('#emp-m-ini').value || null, fim_previsto: corpo.querySelector('#emp-m-fim').value || null,
        observacoes: corpo.querySelector('#emp-m-obs').value || null, operacoes: lerOperacoes(tabela),
        ...(p ? { pedido_id: p.id } : { geom: o.geom, ...(tipo === 'faixa' ? { largura_m: largura } : {}) }),
      };
      const { data, error } = await apiFetch('/api/demo/empreitadas', { method: 'POST', body: JSON.stringify(b) });
      if (error) return toast(error.message, 'err');
      closeModal('emp-modal');
      if (!p) cancelarDesenho();
      toast(p ? `Empreitada ${data.codigo} criada a partir do pedido ${p.codpedido}.` : `Empreitada ${data.codigo} criada.`);
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
