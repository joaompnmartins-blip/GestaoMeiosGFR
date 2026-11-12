'use strict';

// Dados da demonstração de empreitadas FSBF (só no beta3).
//
// Os catálogos — operações do guia SISF, tipos de meio, rendimentos, bases —
// são reescritos a cada arranque, para uma correcção aqui chegar à base sem
// mais nada. As fontes externas simuladas (propostas, registos da frota e das
// máquinas) só se geram quando estão vazias, ou quando se pede para repor.
//
// TUDO O QUE AQUI SE GERA É SINTÉTICO. O repositório é público: nenhum nome,
// matrícula ou registo real entra neste ficheiro. Os condutores são
// «Condutor 07», as máquinas e viaturas vêm do catálogo que já está na base,
// e os registos imitam a estrutura e o ritmo da exportação da frota sem
// copiar nenhuma linha dela.
//
// O gerador é determinístico: a mesma semente e a mesma data de referência
// dão os mesmos dados. A data de referência é hoje, e os registos ficam nos
// 90 dias anteriores — é aí que a demonstração vai buscar as horas reais.
// No fim, cenarios.js junta empreitadas já com história (ver lá).
//
//   node demo/dados_demo.js            repõe tudo (pede DATABASE_URL)

// ── Catálogos ─────────────────────────────────────────────────────

// O catálogo das intervenções e a tabela de rendimentos vêm dos CSV em
// demo/catalogo/ (ver o README de lá). São a fonte: para mudar uma
// designação, um modo ou um rendimento, muda-se o CSV e reinicia-se.
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

// O Excel português tanto grava em UTF-8 como em Windows-1252: aceitam-se os dois.
function lerCsv(nome) {
  const bytes = fs.readFileSync(path.join(__dirname, 'catalogo', nome));
  let texto;
  try { texto = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { texto = new TextDecoder('windows-1252').decode(bytes); }
  return parse(texto, { bom: true, columns: true, delimiter: ';', trim: true, skip_empty_lines: true });
}
const decimal = v => (v === '' || v == null ? null : Number(String(v).replace(',', '.')));

// O grupo Incêndios Rurais é actividade da equipa, não obra: fica de fora.
const GRUPOS_EXCLUIDOS = ['Incêndios Rurais'];
const MODOS = ['moto-manual', 'mecanico', 'rede-viaria', 'fogo', 'quimico', 'manual'];

// { codigo, designacao, grupo, ordem, geometria, unidade, modo }
const OPERACOES = lerCsv('intervencoes.csv')
  .filter(l => !GRUPOS_EXCLUIDOS.includes(l.GrupoIntervencao))
  .map(l => {
    const o = {
      codigo: l.COD, ordem: Number(l.ID), grupo: l.GrupoIntervencao,
      // O texto do ficheiro traz o código à frente: «CDO - Gestão …».
      designacao: l.INTERVENCAO.replace(new RegExp(`^${l.COD}\\s*-\\s*`), ''),
      geometria: l.GEOMETRIA, unidade: l.UNIDADE, modo: l.MODO,
    };
    if (!['poligono', 'linha'].includes(o.geometria) || o.unidade !== (o.geometria === 'linha' ? 'km' : 'ha') ||
        !MODOS.includes(o.modo))
      throw new Error(`intervencoes.csv: ${o.codigo} com geometria, unidade ou modo inválidos.`);
    return o;
  });
const OP = Object.fromEntries(OPERACOES.map(o => [o.codigo, o]));
const CODIGOS = OPERACOES.map(o => o.codigo);

// Gestão de combustíveis: só estas propostas podem ser faixas (TIPO_FGC).
const COMBUSTIVEIS = ['CDO', 'CDR', 'CAO', 'MDO', 'MDR', 'MAO', 'QQQ', 'PQQ', 'DDD', 'RRR', 'DRO',
                      'AAA', 'GFI', 'GAG', 'GSI'];

// Custos SIMULADOS. O código é a classe da viatura no catálogo da GOGFR,
// excepto OP, que é um operacional. Máquinas de rastos não andam na estrada:
// vão em porta-máquinas (PM), e isso entra no custo de as levar ao sítio.
// A mobilização é o custo fixo de pôr uma máquina a trabalhar na obra.
// [código, designação, €/h, €/km, operadores, precisa transporte, mobilização €]
const TIPOS_MEIO = [
  ['OP',   'Operacional (sapador bombeiro florestal)', 15.00, null, 1, false,   0],
  ['TB',   'Trator de rodas com destroçador',          38.00, null, 1, false, 150],
  ['TR',   'Trator de rastos',                         48.00, null, 1, true,  220],
  ['DR',   'Destroçador frontal de rastos',            80.00, null, 1, true,  300],
  ['MR',   'Máquina de rastos',                        95.00, null, 1, true,  350],
  ['GR',   'Máquina giratória de rastos',              75.00, null, 1, true,  300],
  ['PM',   'Porta-máquinas',                           null,  2.20, 1, false,   0],
  ['VLCI', 'Viatura ligeira (transporte de equipa)',   null,  0.45, 0, false,   0],
];

// Rendimentos SIMULADOS, em unidades da operação por hora (ha/h ou km/h),
// para matos/incultos. Nos povoamentos rende-se menos: multiplica-se pelo
// factor do tipo de povoamento (povoamentos.csv). Na rede viária o
// povoamento não conta. OP é por operacional: uma equipa de 6 rende seis
// vezes isto. Célula vazia: esse meio não faz essa operação.
const TIPOS_RENDIMENTO = ['OP', 'TB', 'TR', 'DR', 'MR', 'GR'];
const RENDIMENTO_BASE = {};
for (const l of lerCsv('rendimentos.csv')) {
  if (!OP[l.COD]) throw new Error(`rendimentos.csv: ${l.COD} não está no catálogo das intervenções.`);
  for (const t of TIPOS_RENDIMENTO) {
    const v = decimal(l[t]);
    if (v == null) continue;
    if (!(v > 0)) throw new Error(`rendimentos.csv: ${l.COD}/${t} tem de ser positivo.`);
    (RENDIMENTO_BASE[t] ||= {})[l.COD] = v;
  }
}
const FACTOR_POV = Object.fromEntries(lerCsv('povoamentos.csv').map(l => [Number(l.TIPO_POV), decimal(l.FACTOR)]));

// As bases FSBF (as de operacionais_fsbf), no centro da localidade.
// `rumos` é para onde há terra: a Marinha Grande tem o mar a poente, Olhão
// a sul. As propostas só se desenham dentro desse leque.
const BASES = [
  // nome, companhia, lat, lon, sigla, rumos [de, até] em graus desde norte
  ['Cabeceiras de Basto',  'Norte',  41.5143, -7.9893, 'CBT', [0, 360]],
  ['Macedo de Cavaleiros', 'Norte',  41.5383, -6.9606, 'MCV', [0, 360]],
  ['Vila Pouca de Aguiar', 'Norte',  41.4992, -7.6448, 'VPA', [0, 360]],
  ['Arganil',              'Centro', 40.2183, -8.0539, 'AGN', [0, 360]],
  ['Guarda',               'Centro', 40.5373, -7.2675, 'GRD', [150, 330]],
  ['Marinha Grande',       'Centro', 39.7475, -8.9318, 'MGR', [10, 170]],
  ['Proença-a-Nova',       'Centro', 39.7509, -7.9254, 'PNV', [0, 360]],
  ['Viseu',                'Centro', 40.6566, -7.9125, 'VIS', [0, 360]],
  ['Olhão',                'Sul',    37.0260, -7.8411, 'OLH', [290, 430]],
  ['Portalegre',           'Sul',    39.2938, -7.4312, 'PTG', [150, 330]],
  ['Santarém',             'Sul',    39.2362, -8.6859, 'STR', [0, 360]],
];

// Destinos para os registos de deslocação: concelhos vizinhos de cada base.
const DESTINOS = {
  'Cabeceiras de Basto':  ['Celorico de Basto', 'Mondim de Basto', 'Vieira do Minho', 'Fafe', 'Ribeira de Pena', 'Boticas'],
  'Macedo de Cavaleiros': ['Mirandela', 'Bragança', 'Vinhais', 'Alfândega da Fé', 'Mogadouro', 'Vimioso'],
  'Vila Pouca de Aguiar': ['Vila Real', 'Chaves', 'Murça', 'Ribeira de Pena', 'Valpaços', 'Sabrosa'],
  'Arganil':              ['Góis', 'Tábua', 'Oliveira do Hospital', 'Pampilhosa da Serra', 'Lousã', 'Penacova'],
  'Guarda':               ['Sabugal', 'Pinhel', 'Celorico da Beira', 'Manteigas', 'Trancoso', 'Belmonte'],
  'Marinha Grande':       ['Leiria', 'Pombal', 'Alcobaça', 'Porto de Mós', 'Batalha', 'Nazaré'],
  'Proença-a-Nova':       ['Oleiros', 'Sertã', 'Mação', 'Vila de Rei', 'Castelo Branco', 'Vila Velha de Ródão'],
  'Viseu':                ['Tondela', 'São Pedro do Sul', 'Mangualde', 'Vouzela', 'Castro Daire', 'Sátão'],
  'Olhão':                ['Tavira', 'São Brás de Alportel', 'Loulé', 'Faro', 'Alcoutim', 'Castro Marim'],
  'Portalegre':           ['Marvão', 'Castelo de Vide', 'Nisa', 'Crato', 'Arronches', 'Alter do Chão'],
  'Santarém':             ['Rio Maior', 'Almeirim', 'Alpiarça', 'Chamusca', 'Torres Novas', 'Coruche'],
};

// As máquinas mais pesadas só ficam em bases com porta-máquinas.
const CLASSES_MAQUINA = ['TB', 'TR', 'DR', 'MR', 'GR'];
const CLASSES_FROTA   = ['VLCI', 'VTTP', 'VCOT', 'VFCI', 'MU', 'PM'];

// ── Utilitários ───────────────────────────────────────────────────

// mulberry32: pequeno, rápido e reprodutível.
function prng(semente) {
  let a = semente >>> 0;
  const r = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.entre   = (a, b) => a + (b - a) * r();
  r.inteiro = (a, b) => Math.floor(r.entre(a, b + 1));
  r.um      = lista => lista[Math.floor(r() * lista.length)];
  r.pesado  = pesos => {               // { valor: peso, ... }
    const total = Object.values(pesos).reduce((s, p) => s + p, 0);
    let x = r() * total;
    for (const [v, p] of Object.entries(pesos)) if ((x -= p) < 0) return v;
    return Object.keys(pesos).pop();
  };
  return r;
}

const M_POR_GRAU_LAT = 110540;
const mPorGrauLon = lat => 111320 * Math.cos(lat * Math.PI / 180);

// Desloca um ponto `m` metros no rumo `graus` (aproximação plana, que a
// estas distâncias erra por centímetros).
function deslocar([lon, lat], m, graus) {
  const a = graus * Math.PI / 180;
  return [lon + m * Math.sin(a) / mPorGrauLon(lat), lat + m * Math.cos(a) / M_POR_GRAU_LAT];
}

// Área de um polígono GeoJSON, em hectares.
function areaHa(geom) {
  const anel = geom.coordinates[0];
  const lat0 = anel[0][1];
  const xy = anel.map(([lon, lat]) => [lon * mPorGrauLon(lat0), lat * M_POR_GRAU_LAT]);
  let s = 0;
  for (let i = 0; i < xy.length - 1; i++) s += xy[i][0] * xy[i + 1][1] - xy[i + 1][0] * xy[i][1];
  return Math.abs(s) / 2 / 10000;
}

// Comprimento de uma linha GeoJSON, em quilómetros.
function comprimentoKm(geom) {
  let s = 0;
  const c = geom.coordinates;
  for (let i = 1; i < c.length; i++) {
    const dx = (c[i][0] - c[i - 1][0]) * mPorGrauLon(c[i][1]);
    const dy = (c[i][1] - c[i - 1][1]) * M_POR_GRAU_LAT;
    s += Math.hypot(dx, dy);
  }
  return s / 1000;
}

// Distância entre dois pontos [lon, lat], em quilómetros (haversine).
function distanciaKm([lon1, lat1], [lon2, lat2]) {
  const R = 6371, r = Math.PI / 180;
  const a = Math.sin((lat2 - lat1) * r / 2) ** 2 +
            Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin((lon2 - lon1) * r / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const arred = (x, casas = 6) => +x.toFixed(casas);

// Polígono irregular com cerca de `ha` hectares à volta de `centro`.
// `alongado` dá as faixas de gestão de combustível: compridas e estreitas.
function poligono(r, centro, ha, alongado) {
  const n = r.inteiro(8, 12);
  const raio = Math.sqrt(ha * 10000 / Math.PI);
  const esticar = alongado ? r.entre(4, 7) : r.entre(1, 1.6);
  const rumo = r.entre(0, 180);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * 2 * Math.PI + r.entre(-0.15, 0.15);
    const rr = raio * r.entre(0.75, 1.2);
    // elipse esticada ao longo de `rumo`
    const ax = Math.cos(ang) * rr * Math.sqrt(esticar);
    const ay = Math.sin(ang) * rr / Math.sqrt(esticar);
    const dist = Math.hypot(ax, ay);
    const graus = rumo + Math.atan2(ax, ay) * 180 / Math.PI;
    pts.push(deslocar(centro, dist, graus).map(v => arred(v)));
  }
  pts.push(pts[0]);
  return { type: 'Polygon', coordinates: [pts] };
}

// Linha sinuosa de cerca de `km` quilómetros a partir de `inicio`.
function linha(r, inicio, km) {
  const n = r.inteiro(8, 18);
  const passo = km * 1000 / n;
  let rumo = r.entre(0, 360);
  const pts = [inicio.map(v => arred(v))];
  let p = inicio;
  for (let i = 0; i < n; i++) {
    rumo += r.entre(-35, 35);
    p = deslocar(p, passo * r.entre(0.8, 1.2), rumo);
    pts.push(p.map(v => arred(v)));
  }
  return { type: 'LineString', coordinates: pts };
}

// Datas sem fuso: o registo da frota guarda hora local, sem zona.
const doisDig = n => String(n).padStart(2, '0');
function carimbo(dia, minutos) {          // dia: Date UTC à meia-noite
  const d = new Date(dia.getTime() + minutos * 60000);
  return `${d.getUTCFullYear()}-${doisDig(d.getUTCMonth() + 1)}-${doisDig(d.getUTCDate())} ` +
         `${doisDig(d.getUTCHours())}:${doisDig(d.getUTCMinutes())}:00`;
}
function diasUteis(referencia, quantos) {
  const fim = Date.UTC(referencia.getFullYear(), referencia.getMonth(), referencia.getDate());
  const dias = [];
  for (let i = quantos; i >= 1; i--) {
    const d = new Date(fim - i * 86400000);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) dias.push(d);
  }
  return dias;
}

// ── Geradores ─────────────────────────────────────────────────────

function gerarRendimentos() {
  const linhas = [];
  for (const [meio, ops] of Object.entries(RENDIMENTO_BASE))
    for (const [op, base] of Object.entries(ops))
      for (const pov of [1, 2, 3, 4]) {
        const f = OP[op].modo === 'rede-viaria' ? 1 : FACTOR_POV[pov];
        linhas.push({ operacao: op, tipo_meio: meio, tipo_pov: pov, por_hora: arred(base * f, 4) });
      }
  return linhas;
}

const PESOS_POLIGONO = { MAO: 12, MDO: 10, CAO: 10, CDO: 6, RES: 6, QQQ: 4, MDR: 3, CDR: 3,
                         RQU: 3, CIM: 3, AAA: 3, LLA: 3, PQQ: 2, DDD: 2, APF: 2, RAA: 2,
                         BRD: 2, GFI: 1, CIQ: 1, MPC: 1, EEM: 1, GAG: 1, SEM: 1, ERR: 1,
                         ARD: 1, CPA: 1, MPA: 1 };
const PESOS_LINHA    = { MRV: 10, MBR: 3, MRR: 3, CRV: 2, CBR: 1, CRR: 1, CIR: 1, MIR: 1 };
// Pontos de água: polígonos pequenos, de umas centenas a 3000 m².
const PONTOS_AGUA    = ['CPA', 'MPA'];

function gerarPropostas(r, referencia) {
  // O plano de actividades entrega-se até 31 de Outubro para o ano seguinte.
  const ano = referencia.getMonth() >= 9 ? referencia.getFullYear() + 1 : referencia.getFullYear();
  const propostas = [];
  let n = 0;
  for (const [base, , lat, lon, sigla, [rumoDe, rumoAte]] of BASES) {
    const quantas = r.inteiro(3, 4);
    for (let i = 0; i < quantas; i++) {
      n++;
      const centro = deslocar([lon, lat], r.entre(4000, 25000), r.entre(rumoDe, rumoAte) % 360);
      const eLinha = r() < 0.25;
      const interv = r.pesado(eLinha ? PESOS_LINHA : PESOS_POLIGONO);
      const tipoPov = +r.pesado({ 4: 40, 1: 30, 3: 15, 2: 15 });
      let geom, area = null, comp = null, tipoFgc = null, nome;
      if (eLinha) {
        geom = linha(r, centro, r.entre(0.8, 6));
        comp = arred(comprimentoKm(geom), 2);
        nome = `Caminho florestal ${doisDig(n)} — ${base}`;
      } else {
        const pontoAgua = PONTOS_AGUA.includes(interv);
        tipoFgc = COMBUSTIVEIS.includes(interv) && r() < 0.5 ? r.um(['FIC', 'FRC']) : null;
        const ha = pontoAgua ? r.entre(0.03, 0.3) : tipoFgc ? r.entre(3, 15)
                 : interv === 'LLA' ? r.entre(1, 6) : r.entre(2, 40);
        geom = poligono(r, centro, ha, !!tipoFgc || interv === 'LLA');
        area = arred(areaHa(geom), 2);
        nome = `${pontoAgua ? 'Ponto de água' : interv === 'LLA' ? 'Linha de água'
                : tipoFgc ? `Faixa ${tipoFgc}` : 'Talhão'} ${doisDig(n)} — ${base}`;
      }
      // Ritmo de referência para o N_DIAS da proposta: 1,5 ha ou 0,8 km por dia.
      const nDias = Math.max(1, Math.min(60, Math.round(area ? area / 1.5 : comp / 0.8)));
      propostas.push({
        cod_equipa: `FSBF-${sigla}`, ano, fase: 'PA',
        trim: r.pesado({ '1T': 30, '2T': 35, '3T': 10, '4T': 25 }),
        n_dias: nDias, tipo_pov: tipoPov, nome, tipo_interv: null,
        interv, tipo_fgc: tipoFgc, tipo_elem: eLinha ? 'RVF' : null,
        fin: r() < 0.85 ? 'SP' : 'SN', observ: null,
        geometria: eLinha ? 'linha' : 'poligono', geom,
        area_ha: area, comprimento_km: comp, base_proxima: base,
        recebida_em: new Date(referencia.getTime() - r.inteiro(1, 30) * 86400000).toISOString(),
      });
    }
  }
  return propostas;
}

// Os registos de deslocação da frota: ida de manhã, volta à tarde, num dia
// útil sim, noutro talvez. De vez em quando um registo que vale um mês
// inteiro — a exportação real tem disso — e um ou outro em duplicado, para
// a demonstração ter anomalias a assinalar.
function gerarFrota(r, frota, referencia) {
  const dias = diasUteis(referencia, 90);
  const linhas = [];
  let id = 1;
  for (const v of frota) {
    let km = r.inteiro(15000, 160000);
    let desdeAbastecer = 0;
    const condutores = Array.from({ length: 4 }, () => `Condutor ${doisDig(r.inteiro(1, 60))}`);
    for (const dia of dias) {
      if (r() > 0.6) continue;
      const destino = r.um(DESTINOS[v.base]);
      const condutor = r.um(condutores);
      const kmIda = r.inteiro(15, 90);
      const saida = r.inteiro(7 * 60 + 30, 9 * 60 + 30);
      const ida = Math.round(kmIda * r.entre(1.1, 1.6));       // minutos
      const volta = r.inteiro(15 * 60 + 30, 18 * 60);
      for (const [orig, dest, ini, fim] of [
        [v.base, destino, saida, saida + ida],
        [destino, v.base, volta, volta + ida],
      ]) {
        const reg = {
          id: id++, veiculo_id: v.id_externo, motorista_id: null,
          data_hora_saida: carimbo(dia, ini), data_hora_chegada: carimbo(dia, fim),
          origem: orig, destino: dest, km_inicial: km, km_final: km + kmIda,
          utilizador_registo_id: r.inteiro(1, 46),
          servico_afetacao: r() < 0.97 ? 'FSBF' : null, nome_condutor: condutor,
          abastecimento_lts: null, abastecimento_eur: null, portagens_eur: null,
          adblue_lts: null, observacoes_fim: null,
        };
        km += kmIda;
        desdeAbastecer += kmIda;
        if (desdeAbastecer > r.entre(350, 550)) {
          reg.abastecimento_lts = arred(r.entre(40, 75), 2);
          if (r() < 0.15) reg.abastecimento_eur = arred(reg.abastecimento_lts * r.entre(1.62, 1.84), 2);
          if (r() < 0.2) reg.adblue_lts = r.um([1, 5, 10]);
          desdeAbastecer = 0;
        }
        if (r() < 0.01) reg.observacoes_fim = r.um(['Luz de presença fundida', 'Pneu com desgaste', 'Vidro com fissura', 'Ruído nos travões']);
        linhas.push(reg);
        if (r() < 0.004) linhas.push({ ...reg, id: id++,                // registo em duplicado
          data_hora_saida: carimbo(dia, ini + 20), data_hora_chegada: carimbo(dia, fim + 20) });
      }
    }
    if (r() < 0.15) {                                                   // registo de um mês inteiro
      const d0 = dias[r.inteiro(0, Math.max(0, dias.length - 25))];
      linhas.push({ id: id++, veiculo_id: v.id_externo, motorista_id: null,
        data_hora_saida: carimbo(d0, 0), data_hora_chegada: carimbo(d0, 29 * 24 * 60),
        origem: 'Base', destino: 'Vários', km_inicial: km, km_final: km + r.inteiro(2000, 7000),
        utilizador_registo_id: r.inteiro(1, 46), servico_afetacao: null, nome_condutor: null });
    }
  }
  return linhas;
}

// As máquinas trabalham por blocos: uns dias seguidos no mesmo sítio, depois
// paradas. Um dia de trabalho conta 5 a 9 horas no conta-horas.
function gerarMaquinas(r, maquinas, referencia) {
  const dias = diasUteis(referencia, 90);
  const linhas = [];
  let id = 1;
  for (const m of maquinas) {
    let horas = arred(r.entre(1500, 9000), 1);
    const operadores = Array.from({ length: 2 }, () => `Operador ${doisDig(r.inteiro(1, 40))}`);
    const blocos = r() < 0.55 ? r.inteiro(1, 3) : 0;
    const ocupados = new Set();
    for (let b = 0; b < blocos; b++) {
      const ini = r.inteiro(0, dias.length - 3);
      const destino = r.um(DESTINOS[m.base]);
      const operador = r.um(operadores);
      let desdeAbastecer = 0;
      for (let k = ini; k < Math.min(dias.length, ini + r.inteiro(3, 12)); k++) {
        if (ocupados.has(k)) continue;
        ocupados.add(k);
        const comeco = r.inteiro(8 * 60, 8 * 60 + 40);
        const trabalho = r.entre(5, 9);
        const reg = {
          id: id++, maquina_id: m.id_externo, operador_id: null,
          data_hora_inicio: carimbo(dias[k], comeco),
          data_hora_fim: carimbo(dias[k], comeco + Math.round(trabalho * 60) + 60),  // +1 h de almoço
          origem: k === ini ? m.base : destino, destino,
          horas_inicial: horas, horas_final: arred(horas + trabalho, 1),
          utilizador_registo_id: r.inteiro(1, 46),
          servico_afetacao: 'FSBF', nome_operador: operador,
          abastecimento_lts: null, abastecimento_eur: null, adblue_lts: null,
          acessorio_id: null, observacoes_fim: null,
        };
        horas = reg.horas_final;
        if (++desdeAbastecer >= r.inteiro(2, 3)) {
          reg.abastecimento_lts = arred(r.entre(80, 220), 2);
          desdeAbastecer = 0;
        }
        linhas.push(reg);
      }
    }
  }
  return linhas.sort((a, b) => a.data_hora_inicio.localeCompare(b.data_hora_inicio))
               .map((l, i) => ({ ...l, id: i + 1 }));
}

// ── Escrita na base ───────────────────────────────────────────────

// Uma tabela inteira num só parâmetro: o JSON entra como array e o
// json_populate_recordset faz a correspondência pelos nomes das colunas.
async function inserir(c, tabela, linhas) {
  for (let i = 0; i < linhas.length; i += 2000) {
    await c.query(`INSERT INTO ${tabela} SELECT * FROM json_populate_recordset(null::${tabela}, $1)`,
                  [JSON.stringify(linhas.slice(i, i + 2000))]);
  }
}

async function escreverCatalogos(c) {
  await c.query(`INSERT INTO demo.operacoes (codigo, designacao, grupo, ordem, geometria, unidade, modo)
                 SELECT * FROM json_to_recordset($1) AS x(codigo text, designacao text, grupo text,
                        ordem smallint, geometria text, unidade text, modo text)
                 ON CONFLICT (codigo) DO UPDATE SET designacao = EXCLUDED.designacao,
                        grupo = EXCLUDED.grupo, ordem = EXCLUDED.ordem,
                        geometria = EXCLUDED.geometria, unidade = EXCLUDED.unidade, modo = EXCLUDED.modo`,
    [JSON.stringify(OPERACOES)]);

  await c.query(`INSERT INTO demo.tipos_meio (codigo, designacao, custo_hora_eur, custo_km_eur, operadores,
                                             precisa_transporte, mobilizacao_eur)
                 SELECT * FROM json_to_recordset($1) AS x(codigo text, designacao text, custo_hora_eur numeric,
                        custo_km_eur numeric, operadores smallint, precisa_transporte boolean, mobilizacao_eur numeric)
                 ON CONFLICT (codigo) DO UPDATE SET designacao = EXCLUDED.designacao,
                        custo_hora_eur = EXCLUDED.custo_hora_eur, custo_km_eur = EXCLUDED.custo_km_eur,
                        operadores = EXCLUDED.operadores, precisa_transporte = EXCLUDED.precisa_transporte,
                        mobilizacao_eur = EXCLUDED.mobilizacao_eur`,
    [JSON.stringify(TIPOS_MEIO.map(([codigo, designacao, custo_hora_eur, custo_km_eur, operadores, precisa_transporte, mobilizacao_eur]) =>
      ({ codigo, designacao, custo_hora_eur, custo_km_eur, operadores, precisa_transporte, mobilizacao_eur })))]);

  // Os rendimentos substituem-se por inteiro: um par que saia da tabela
  // acima tem de sair também da base.
  await c.query('DELETE FROM demo.rendimentos WHERE simulado');
  await inserir(c, 'demo.rendimentos', gerarRendimentos().map(x => ({ ...x, simulado: true })));

  // Códigos que saíram do catálogo: apagam-se os que já ninguém usa. Os
  // que ainda estão em empreitadas ficam até se repor (ver garantirDadosDemo).
  await c.query(`DELETE FROM demo.rendimentos WHERE NOT (operacao = ANY($1))`, [CODIGOS]);
  await c.query(`DELETE FROM demo.operacoes o WHERE NOT (codigo = ANY($1))
                   AND NOT EXISTS (SELECT 1 FROM demo.empreitada_operacoes x WHERE x.operacao = o.codigo)
                   AND NOT EXISTS (SELECT 1 FROM demo.empreitada_meios x WHERE x.operacao = o.codigo)
                   AND NOT EXISTS (SELECT 1 FROM demo.horas_operacionais x WHERE x.operacao = o.codigo)`, [CODIGOS]);

  await c.query(`INSERT INTO demo.bases (nome, companhia, lat, lon)
                 SELECT * FROM json_to_recordset($1) AS x(nome text, companhia text, lat float8, lon float8)
                 ON CONFLICT (nome) DO UPDATE SET companhia = EXCLUDED.companhia, lat = EXCLUDED.lat, lon = EXCLUDED.lon`,
    [JSON.stringify(BASES.map(([nome, companhia, lat, lon]) => ({ nome, companhia, lat, lon })))]);
}

// Base de cada meio FSBF e número externo de cada um. Quem já tem base
// conhecida fica com ela; os restantes são distribuídos — as máquinas de
// rastos só por bases com porta-máquinas, que é como chegam ao terreno.
async function atribuirMeios(c, r) {
  const { rows: meios } = await c.query(
    `SELECT id, classe, base FROM viaturas
      WHERE megfr = 'FSBF' AND COALESCE(ativo, true) AND classe = ANY($1)
      ORDER BY classe, viatura_cod`, [[...CLASSES_MAQUINA, ...CLASSES_FROTA]]);
  const nomesBase = BASES.map(b => b[0]);
  const comPM = [...new Set(meios.filter(m => m.classe === 'PM' && nomesBase.includes(m.base)).map(m => m.base))];
  const rastos = new Set(['TR', 'DR', 'MR', 'GR']);

  const viaturaBase = meios.map(m => ({
    viatura_id: m.id,
    base: nomesBase.includes(m.base) ? m.base : r.um(rastos.has(m.classe) && comPM.length ? comPM : nomesBase),
  }));
  await c.query('DELETE FROM demo.viatura_base');
  await inserir(c, 'demo.viatura_base', viaturaBase);
  const baseDe = Object.fromEntries(viaturaBase.map(v => [v.viatura_id, v.base]));

  // Números externos como os da aplicação da frota: pequenos e salteados.
  const frota = meios.filter(m => CLASSES_FROTA.includes(m.classe));
  const maquinas = meios.filter(m => CLASSES_MAQUINA.includes(m.classe));
  const salteados = (n, de) => {
    const s = new Set();
    while (s.size < n) s.add(r.inteiro(de, de + n * 3));
    return [...s].sort((a, b) => a - b);
  };
  const idsF = salteados(frota.length, 10), idsM = salteados(maquinas.length, 1);
  const corr = [
    ...frota.map((m, i) => ({ origem: 'frota', id_externo: idsF[i], viatura_id: m.id })),
    ...maquinas.map((m, i) => ({ origem: 'maquinas', id_externo: idsM[i], viatura_id: m.id })),
  ];
  await c.query('DELETE FROM demo.correspondencia_veiculos');
  await inserir(c, 'demo.correspondencia_veiculos', corr);

  return {
    frota: frota.map((m, i) => ({ id_externo: idsF[i], base: baseDe[m.id] })),
    maquinas: maquinas.map((m, i) => ({ id_externo: idsM[i], base: baseDe[m.id] })),
  };
}

// Repõe a demonstração: apaga as empreitadas e tudo o que foi registado,
// volta a gerar as fontes externas. A semente fixa dá sempre os mesmos dados
// para a mesma data.
async function reporDadosDemo(pool, { referencia = new Date(), semente = 2027 } = {}) {
  const r = prng(semente);
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(`TRUNCATE demo.horas_operacionais, demo.empreitada_meios, demo.empreitada_operacoes,
                            demo.empreitadas, ext.propostas_empreitada, ext.fsbf_frota_utilizacao,
                            ext.fsbf_maquinas_utilizacao RESTART IDENTITY`);
    await escreverCatalogos(c);
    const { frota, maquinas } = await atribuirMeios(c, r);
    const propostas = gerarPropostas(r, referencia);
    await inserir(c, 'ext.propostas_empreitada', propostas.map((p, i) => ({ id: i + 1, ...p })));
    await c.query(`SELECT setval(pg_get_serial_sequence('ext.propostas_empreitada','id'), $1)`, [propostas.length]);
    const regFrota = gerarFrota(r, frota, referencia);
    await inserir(c, 'ext.fsbf_frota_utilizacao', regFrota);
    const regMaq = gerarMaquinas(r, maquinas, referencia);
    await inserir(c, 'ext.fsbf_maquinas_utilizacao', regMaq);
    // Aqui e não no topo: cenarios.js precisa deste módulo já carregado.
    const cenarios = await require('./cenarios').criarCenarios(c, r, referencia);
    await c.query('COMMIT');
    return { propostas: propostas.length, frota: frota.length, registos_frota: regFrota.length,
             maquinas: maquinas.length, registos_maquinas: regMaq.length, cenarios };
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

// A cada arranque: catálogos sempre; fontes externas só se estiverem vazias
// ou se usarem intervenções que já não estão no catálogo (o catálogo mudou
// e há códigos que saíram ou mudaram de sentido — repõe-se tudo).
async function garantirDadosDemo(pool) {
  const { rows } = await pool.query(
    `SELECT (SELECT count(*) FROM ext.propostas_empreitada)::int AS n,
            (SELECT count(*) FROM ext.propostas_empreitada WHERE NOT (interv = ANY($1)))
          + (SELECT count(*) FROM demo.empreitada_operacoes WHERE NOT (operacao = ANY($1))) AS fora`, [CODIGOS]);
  if (rows[0].n === 0 || Number(rows[0].fora) > 0) {
    const r = await reporDadosDemo(pool);
    console.log(`Demonstração: ${r.propostas} propostas, ${r.registos_frota} registos de ${r.frota} viaturas, ` +
                `${r.registos_maquinas} de ${r.maquinas} máquinas; cenários ${r.cenarios.join(', ')}.`);
  } else {
    const c = await pool.connect();
    try { await escreverCatalogos(c); } finally { c.release(); }
  }
}

module.exports = {
  garantirDadosDemo, reporDadosDemo,
  areaHa, comprimentoKm, distanciaKm, FACTOR_POV,
};

if (require.main === module) {
  const { Pool } = require('pg');
  if (!process.env.DATABASE_URL) { console.error('Falta a DATABASE_URL.'); process.exit(1); }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  reporDadosDemo(pool)
    .then(r => { console.log('Reposto:', r); return pool.end(); })
    .catch(e => { console.error('ERRO:', e.message); process.exit(1); });
}
