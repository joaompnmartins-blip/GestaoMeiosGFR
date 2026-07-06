'use strict';
// ETL — importa Meios_v1, Viaturas_v1, Radios_v1 para o catálogo MEGFR.
// Uso: node scripts/sync_catalogo.js [caminho/para/pasta/csvs]
// Pasta por omissão: new_db_tables/ (relativa à raiz do projecto)

const fs   = require('fs');
const path = require('path');
const { Pool }  = require('pg');
const { parse } = require('csv-parse/sync');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'false' ? false
     : (process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false),
});

const CSV_DIR     = path.resolve(process.argv[2] || path.join(__dirname, '..', 'new_db_tables'));
const ESCALAS_DIR = path.resolve(process.argv[3] || path.join(__dirname, '..', 'escalas'));

// ── Utilitários ───────────────────────────────────────────────────────────────

function readCsv(filename) {
  const filePath = path.join(CSV_DIR, filename);
  const content  = fs.readFileSync(filePath, 'utf8');
  return parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,   // a coluna C não tem cabeçalho
  });
}

function readEscalaCsv(filename) {
  const filePath = path.join(ESCALAS_DIR, filename);
  const content  = fs.readFileSync(filePath, 'utf8');
  return parse(content, { columns: true, skip_empty_lines: true, trim: true });
}

// Coordenadas do xlsx usam vírgula como separador decimal (pt-PT)
function parseCoord(val) {
  if (!val || val === 'NULL' || val === '') return null;
  const n = parseFloat(String(val).replace(',', '.'));
  return isNaN(n) ? null : n;
}

function nullify(val) {
  if (val === undefined || val === null || val === 'NULL' || val.trim() === '') return null;
  return val.trim();
}

function md5(obj) {
  return require('crypto').createHash('md5').update(JSON.stringify(obj)).digest('hex');
}

// ── Fase 1 — Recursos (Meios_v1) ─────────────────────────────────────────────

async function syncRecursos(report) {
  console.log('\n── Fase 1: Recursos (Meios_v1) ─────────────────────────────');
  const rows = readCsv('Meios_v1.csv');

  // Obter nomes reais das colunas (a 3.ª coluna não tem cabeçalho)
  const sample    = rows[0];
  const allKeys   = Object.keys(sample);
  const regimeKey = allKeys[2]; // coluna C: '' ou nome real

  let inserted = 0, updated = 0, skipped = 0, warnings = [];

  const codigos = new Map(); // codigo → tipo (para soft-deactivate)

  for (const row of rows) {
    const tipo = nullify(row['Tipo']);
    if (!tipo) continue;

    // Avisar se aparecer EGFR (devia ter sido corrigido na fonte)
    if (tipo === 'EGFR') {
      warnings.push(`Linha ${row['id']}: Tipo=EGFR — devia ser TGFR. Ignorada.`);
      continue;
    }

    const codigo = nullify(row['Meio']);
    if (!codigo) { warnings.push(`Linha ${row['id']}: sem campo Meio — ignorada.`); continue; }

    codigos.set(codigo, tipo);

    const regime        = nullify(row[regimeKey]);   // CNT ou PRP
    const numElementos  = parseInt(row['Num_elementos']) || 1;
    const brigada       = nullify(row['Brigada_format']);
    const viatCod       = nullify(row['Viatura_COD']);
    const ddiPortatil   = nullify(row['DDI_Portatil']);
    const ddiViatura    = nullify(row['DDI_Viatura']);

    const rec = {
      codigo, tipo, regime,
      num_elementos:  numElementos,
      entidade:       nullify(row['UO_DRCNF']),
      local_base:     nullify(row['LOCAL']),
      lat_base:       parseCoord(row['Lat_Base']),
      long_base:      parseCoord(row['Long_Base']),
      contacto:       nullify(row['CONTACTO']),
      email:          nullify(row['EMAIL']),
      concelho:       nullify(row['Concelho']),
      subregiao:      nullify(row['NUTSIII']),
      agfr:           nullify(row['AGFR']),
      ddi_portatil:   ddiPortatil,
      ddi_viatura:    ddiViatura,
      viatura_cod:    viatCod,
      brigada_codigo: brigada,
      external_id:    nullify(row['id']),
    };

    const hash = md5(rec);

    const { rows: existing } = await pool.query(
      'SELECT id, sync_hash FROM recursos WHERE codigo = $1', [codigo]
    );

    if (existing.length === 0) {
      await pool.query(`
        INSERT INTO recursos
          (codigo, tipo, regime, num_elementos, entidade, local_base,
           lat_base, long_base, contacto, email, concelho, subregiao, agfr,
           ddi_portatil, ddi_viatura, viatura_cod, brigada_codigo,
           external_id, sync_hash, synced_at, ativo)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,now(),true)
      `, [rec.codigo, rec.tipo, rec.regime, rec.num_elementos, rec.entidade,
          rec.local_base, rec.lat_base, rec.long_base, rec.contacto, rec.email,
          rec.concelho, rec.subregiao, rec.agfr, rec.ddi_portatil, rec.ddi_viatura,
          rec.viatura_cod, rec.brigada_codigo, rec.external_id, hash]);
      inserted++;
    } else if (existing[0].sync_hash !== hash) {
      // Nunca actualizar campos de prontidão
      await pool.query(`
        UPDATE recursos SET
          tipo=$2, regime=$3, num_elementos=$4, entidade=$5, local_base=$6,
          lat_base=$7, long_base=$8, contacto=$9, email=$10, concelho=$11,
          subregiao=$12, agfr=$13, ddi_portatil=$14, ddi_viatura=$15,
          viatura_cod=$16, brigada_codigo=$17, external_id=$18,
          sync_hash=$19, synced_at=now(), ativo=true, updated_at=now()
        WHERE codigo=$1
      `, [rec.codigo, rec.tipo, rec.regime, rec.num_elementos, rec.entidade,
          rec.local_base, rec.lat_base, rec.long_base, rec.contacto, rec.email,
          rec.concelho, rec.subregiao, rec.agfr, rec.ddi_portatil, rec.ddi_viatura,
          rec.viatura_cod, rec.brigada_codigo, rec.external_id, hash]);
      updated++;
    } else {
      skipped++;
    }
  }

  // Soft-deactivate: recursos que desapareceram da fonte
  // (apenas tipos geridos por este ficheiro)
  const tiposSource = ['ESF','ECNAF','EVN','EFSBF','TGFR','DIR','OLN','TFSBF','EMR'];
  const { rowCount: deactivated } = await pool.query(`
    UPDATE recursos SET ativo=false, updated_at=now()
    WHERE tipo = ANY($1) AND ativo=true AND codigo <> ALL($2)
  `, [tiposSource, Array.from(codigos.keys())]);

  report.recursos = { inserted, updated, skipped, deactivated, warnings };
  console.log(`  Inseridos: ${inserted}  Actualizados: ${updated}  Sem alteração: ${skipped}  Desactivados: ${deactivated}`);
  if (warnings.length) warnings.forEach(w => console.warn('  ⚠', w));
}

// ── Fase 2 — Viaturas (Viaturas_v1) ──────────────────────────────────────────

async function syncViaturas(report) {
  console.log('\n── Fase 2: Viaturas (Viaturas_v1) ──────────────────────────');
  const rows = readCsv('Viaturas_v1.csv');

  let inserted = 0, updated = 0, skipped = 0;
  let ligadas = 0, naoLigadas = 0, warnings = [];

  for (const row of rows) {
    const viatCod = nullify(row['Viatura_COD']);
    if (!viatCod) continue;

    const classe = viatCod.split(' ')[0]; // primeiro token: VLCI, VCOT, MR, PM, TR…

    const viat = {
      viatura_cod:         viatCod,
      megfr:               nullify(row['MEGFR']),
      tipo_decir:          nullify(row['TIPO_DECIR']),
      classe,
      codigo_icnf:         nullify(row['CODIGO_ICNF']),
      tipologia:           nullify(row['TIPOLOGIA']),
      marca:               nullify(row['MARCA']),
      modelo:              nullify(row['MODELO']),
      chassis:             nullify(row['CHASSIS']),
      matricula:           nullify(row['MATRICULA']),
      entidade:            nullify(row['UO_DRCNF']),
      base:                nullify(row['BASE']),
      estado:              nullify(row['ESTADO']),
      agfr:                nullify(row['AGFR']),
      lat_base:            parseCoord(row['LAT_BASE']),
      long_base:           parseCoord(row['LONG_BASE']),
      ddi_viatura:         nullify(row['DDI_VIATURA']),
      external_cod_equipa: nullify(row['COD_EQUIPA']) || nullify(row['ELEMENTO']),
    };

    // Resolver recurso_id (apenas quando manual_override=false)
    let recursoId = null;
    // 1.º: Meios_v1.Viatura_COD → recursos.viatura_cod
    const { rows: byViatCod } = await pool.query(
      `SELECT id FROM recursos WHERE viatura_cod = $1 AND ativo LIMIT 1`, [viatCod]
    );
    if (byViatCod.length) {
      recursoId = byViatCod[0].id;
    } else if (viat.external_cod_equipa) {
      // 2.º: COD_EQUIPA/ELEMENTO → recursos.codigo
      const { rows: byCodEquipa } = await pool.query(
        `SELECT id FROM recursos WHERE codigo = $1 AND ativo LIMIT 1`,
        [viat.external_cod_equipa.trim()]
      );
      if (byCodEquipa.length) recursoId = byCodEquipa[0].id;
    }

    if (recursoId) ligadas++; else naoLigadas++;

    const hash = md5({ ...viat, recursoId });

    const { rows: existing } = await pool.query(
      `SELECT id, sync_hash, manual_override FROM viaturas WHERE viatura_cod = $1`, [viatCod]
    );

    if (existing.length === 0) {
      await pool.query(`
        INSERT INTO viaturas
          (viatura_cod, recurso_id, megfr, tipo_decir, classe, codigo_icnf,
           tipologia, marca, modelo, chassis, matricula,
           entidade, base, estado, agfr, lat_base, long_base, ddi_viatura,
           external_cod_equipa, sync_hash, synced_at, ativo)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,now(),true)
      `, [viat.viatura_cod, recursoId, viat.megfr, viat.tipo_decir, viat.classe,
          viat.codigo_icnf, viat.tipologia, viat.marca, viat.modelo, viat.chassis,
          viat.matricula, viat.entidade, viat.base, viat.estado, viat.agfr,
          viat.lat_base, viat.long_base, viat.ddi_viatura, viat.external_cod_equipa, hash]);
      inserted++;
    } else if (existing[0].sync_hash !== hash) {
      const skipRecursoId = existing[0].manual_override;
      await pool.query(`
        UPDATE viaturas SET
          ${skipRecursoId ? '' : 'recurso_id=$2,'}
          megfr=$3, tipo_decir=$4, classe=$5, codigo_icnf=$6,
          tipologia=$7, marca=$8, modelo=$9, chassis=$10, matricula=$11,
          entidade=$12, base=$13, estado=$14, agfr=$15,
          lat_base=$16, long_base=$17, ddi_viatura=$18,
          external_cod_equipa=$19, sync_hash=$20, synced_at=now(),
          ativo=true, updated_at=now()
        WHERE viatura_cod=$1
      `.replace(/,\s*,/g, ','), // limpar vírgula dupla se skipRecursoId
      [viat.viatura_cod, recursoId, viat.megfr, viat.tipo_decir, viat.classe,
       viat.codigo_icnf, viat.tipologia, viat.marca, viat.modelo, viat.chassis,
       viat.matricula, viat.entidade, viat.base, viat.estado, viat.agfr,
       viat.lat_base, viat.long_base, viat.ddi_viatura, viat.external_cod_equipa, hash]);
      updated++;
    } else {
      skipped++;
    }
  }

  report.viaturas = { total: rows.length, inserted, updated, skipped, ligadas, naoLigadas, warnings };
  console.log(`  Total: ${rows.length}  Inseridas: ${inserted}  Actualizadas: ${updated}  Sem alteração: ${skipped}`);
  console.log(`  Ligadas a recurso: ${ligadas}  Não ligadas: ${naoLigadas}`);
  if (naoLigadas > 0) console.log(`  (esperado ~66 não ligadas)`);
}

// ── Fase 3 — Rádios (Radios_v1) ──────────────────────────────────────────────

async function syncRadios(report) {
  console.log('\n── Fase 3: Rádios (Radios_v1) ───────────────────────────────');
  const rows = readCsv('Radios_v1.csv');

  let inserted = 0, updated = 0, skipped = 0;
  let ligadosDDI = 0, ligadosCodEquipa = 0, naoLigados = 0;

  for (const row of rows) {
    const ddi = nullify(row['DDI']);
    if (!ddi) continue;

    const tipo = nullify(row['TipoTerminal']); // 'Portatil' ou 'Viatura'
    if (!tipo || !['Portatil','Viatura'].includes(tipo)) continue;

    const radio = {
      ddi,
      tipo,
      megfr:               nullify(row['MEGFR']),
      entidade:            nullify(row['UnidadeFuncional']) || nullify(row['Entidade']),
      alias:               nullify(row['RadioUserAlias']),
      indicativo:          nullify(row['Indicativo_Operacional_Radio']),
      estado:              nullify(row['Estado']),
      subregiao:           nullify(row['NUTSIII']),
      external_cod_equipa: nullify(row['COD_EQUIPA']),
    };

    let recursoId = null, viaturaId = null;

    // 1.º: DDI portátil → recursos.ddi_portatil
    if (tipo === 'Portatil') {
      const { rows: r } = await pool.query(
        `SELECT id FROM recursos WHERE ddi_portatil = $1 AND ativo LIMIT 1`, [ddi]
      );
      if (r.length) { recursoId = r[0].id; ligadosDDI++; }
    }

    // 2.º: DDI viatura → recursos.ddi_viatura OU viaturas.ddi_viatura
    if (!recursoId && !viaturaId) {
      const { rows: rv } = await pool.query(
        `SELECT id FROM recursos WHERE ddi_viatura = $1 AND ativo LIMIT 1`, [ddi]
      );
      if (rv.length) { recursoId = rv[0].id; ligadosDDI++; }
      else {
        const { rows: vv } = await pool.query(
          `SELECT id FROM viaturas WHERE ddi_viatura = $1 AND ativo LIMIT 1`, [ddi]
        );
        if (vv.length) { viaturaId = vv[0].id; ligadosDDI++; }
      }
    }

    // 3.º: COD_EQUIPA → recursos.codigo
    if (!recursoId && !viaturaId && radio.external_cod_equipa) {
      const { rows: rc } = await pool.query(
        `SELECT id FROM recursos WHERE codigo = $1 AND ativo LIMIT 1`,
        [radio.external_cod_equipa.trim()]
      );
      if (rc.length) { recursoId = rc[0].id; ligadosCodEquipa++; }
    }

    if (!recursoId && !viaturaId) naoLigados++;

    const hash = md5({ ...radio, recursoId, viaturaId });

    const { rows: existing } = await pool.query(
      `SELECT id, sync_hash, manual_override FROM radios WHERE ddi = $1`, [ddi]
    );

    if (existing.length === 0) {
      await pool.query(`
        INSERT INTO radios
          (ddi, tipo, recurso_id, viatura_id, megfr, entidade, alias,
           indicativo, estado, subregiao, external_cod_equipa, sync_hash, synced_at, ativo)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now(),true)
      `, [radio.ddi, radio.tipo, recursoId, viaturaId, radio.megfr, radio.entidade,
          radio.alias, radio.indicativo, radio.estado, radio.subregiao,
          radio.external_cod_equipa, hash]);
      inserted++;
    } else if (existing[0].sync_hash !== hash) {
      const skipOwner = existing[0].manual_override;
      if (skipOwner) {
        // Só actualizar campos não-ligação
        await pool.query(`
          UPDATE radios SET
            megfr=$2, entidade=$3, alias=$4, indicativo=$5, estado=$6, subregiao=$7,
            external_cod_equipa=$8, sync_hash=$9, synced_at=now(), ativo=true, updated_at=now()
          WHERE ddi=$1
        `, [radio.ddi, radio.megfr, radio.entidade, radio.alias, radio.indicativo,
            radio.estado, radio.subregiao, radio.external_cod_equipa, hash]);
      } else {
        await pool.query(`
          UPDATE radios SET
            tipo=$2, recurso_id=$3, viatura_id=$4, megfr=$5, entidade=$6, alias=$7,
            indicativo=$8, estado=$9, subregiao=$10, external_cod_equipa=$11,
            sync_hash=$12, synced_at=now(), ativo=true, updated_at=now()
          WHERE ddi=$1
        `, [radio.ddi, radio.tipo, recursoId, viaturaId, radio.megfr, radio.entidade,
            radio.alias, radio.indicativo, radio.estado, radio.subregiao,
            radio.external_cod_equipa, hash]);
      }
      updated++;
    } else {
      skipped++;
    }
  }

  report.radios = { total: rows.length, inserted, updated, skipped, ligadosDDI, ligadosCodEquipa, naoLigados };
  console.log(`  Total: ${rows.length}  Inseridos: ${inserted}  Actualizados: ${updated}  Sem alteração: ${skipped}`);
  console.log(`  Ligados por DDI: ${ligadosDDI}  Por COD_EQUIPA: ${ligadosCodEquipa}  Não ligados: ${naoLigados}`);
  if (naoLigados > 0) console.log(`  (esperado ~196 não ligados)`);
}

// ── Fase 4 — Composições BSF ──────────────────────────────────────────────────

async function seedBSF(report) {
  console.log('\n── Fase 4: Seed composições BSF ─────────────────────────────');

  const { rows: brigadas } = await pool.query(`
    SELECT brigada_codigo, array_agg(id ORDER BY codigo) AS recurso_ids,
           mode() WITHIN GROUP (ORDER BY subregiao) AS subregiao
    FROM recursos
    WHERE brigada_codigo IS NOT NULL AND tipo = 'ESF' AND ativo
    GROUP BY brigada_codigo
    HAVING count(*) = 3
  `);

  let inserted = 0, skipped = 0, warnings = [];

  for (const brig of brigadas) {
    const codigo = brig.brigada_codigo;

    const { rows: existing } = await pool.query(
      `SELECT id FROM composicoes WHERE codigo = $1`, [codigo]
    );

    if (existing.length === 0) {
      const { rows: [comp] } = await pool.query(`
        INSERT INTO composicoes (codigo, tipo, subregiao, predefinida)
        VALUES ($1, 'BSF', $2, true) RETURNING id
      `, [codigo, brig.subregiao]);

      for (let i = 0; i < brig.recurso_ids.length; i++) {
        await pool.query(`
          INSERT INTO composicao_membros (composicao_id, recurso_id, papel, ordem)
          VALUES ($1, $2, 'esf', $3)
        `, [comp.id, brig.recurso_ids[i], i]);
      }
      inserted++;
    } else {
      skipped++;
    }
  }

  // Avisar brigadas com ≠3 ESF
  const { rows: incompletas } = await pool.query(`
    SELECT brigada_codigo, count(*) AS n
    FROM recursos WHERE brigada_codigo IS NOT NULL AND tipo = 'ESF' AND ativo
    GROUP BY brigada_codigo HAVING count(*) <> 3
  `);
  for (const b of incompletas) {
    warnings.push(`Brigada ${b.brigada_codigo} tem ${b.n} ESF (esperado 3) — não seedada`);
  }

  report.bsf = { brigadas: brigadas.length, inserted, skipped, warnings };
  console.log(`  Brigadas com 3 ESF: ${brigadas.length}  Criadas: ${inserted}  Já existiam: ${skipped}`);
  if (warnings.length) warnings.forEach(w => console.warn('  ⚠', w));
}

// ── Fase 5 — OLN Escala ───────────────────────────────────────────────────────

async function syncOlnEscala(report) {
  console.log('\n── Fase 5: OLN Escala (escala_oflig_ccon_2026.csv) ──────────');
  const rows = readEscalaCsv('escala_oflig_ccon_2026.csv');

  // nome → recurso_id (case-insensitive)
  const { rows: recursos } = await pool.query(
    `SELECT id, nome FROM recursos WHERE tipo = 'OLN' AND ativo = true`
  );
  const nameMap = {};
  for (const r of recursos) nameMap[r.nome.toLowerCase()] = r.id;

  // Apagar entradas existentes para o intervalo do CSV
  const dates = rows.map(r => r.data).sort();
  if (dates.length) {
    await pool.query(
      `DELETE FROM oln_escala WHERE inicio::date >= $1 AND inicio::date <= $2`,
      [dates[0], dates[dates.length - 1]]
    );
  }

  let inserted = 0, skipped = 0, warnings = [];
  for (const row of rows) {
    const recursoId = nameMap[row.nome.toLowerCase()];
    if (!recursoId) {
      warnings.push(`Nome não encontrado em recursos (OLN): '${row.nome}'`);
      skipped++;
      continue;
    }
    // Intervalo: [dia 00:00, dia+1 00:00) — exclusivo no fim, sem sobreposição
    await pool.query(
      `INSERT INTO oln_escala (recurso_id, inicio, fim, notas)
       VALUES ($1, $2::date::timestamptz, $2::date::timestamptz + interval '1 day', $3)`,
      [recursoId, row.data, nullify(row.uo)]
    );
    inserted++;
  }

  report.oln = { total: rows.length, inserted, skipped, warnings };
  console.log(`  Inseridos: ${inserted}  Ignorados: ${skipped}`);
  if (warnings.length) warnings.forEach(w => console.warn('  ⚠', w));
}

// ── Fase 6 — EGFR Escala ──────────────────────────────────────────────────────

async function syncEgfrEscala(report) {
  console.log('\n── Fase 6: EGFR Escala (escala_egfr_2026_elementos.csv) ─────');
  const rows = readEscalaCsv('escala_egfr_2026_elementos.csv');

  let upserted = 0;
  for (const row of rows) {
    await pool.query(
      `INSERT INTO egfr_escala
         (data, semana_ano, semana_escala, turno, equipa, posicao, nome, capacidade_supressao)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (data, equipa, posicao) DO UPDATE SET
         nome                 = EXCLUDED.nome,
         turno                = EXCLUDED.turno,
         semana_ano           = EXCLUDED.semana_ano,
         semana_escala        = EXCLUDED.semana_escala,
         capacidade_supressao = EXCLUDED.capacidade_supressao`,
      [
        row.data,
        parseInt(row.semana_ano)    || null,
        parseInt(row.semana_escala) || null,
        row.turno,
        row.equipa,
        row.posicao,
        row.nome,
        row.capacidade_supressao?.toLowerCase() === 'sim',
      ]
    );
    upserted++;
  }

  report.egfr = { total: rows.length, upserted };
  console.log(`  Registos: ${upserted}`);
}

// ── Relatório final ───────────────────────────────────────────────────────────

function printReport(report) {
  console.log('\n════════════════════════════════════════════════════════════');
  console.log('RELATÓRIO DE SINCRONIZAÇÃO');
  console.log('════════════════════════════════════════════════════════════');

  const r = report.recursos;
  console.log(`\nRecursos (Meios_v1):`);
  console.log(`  Inseridos: ${r.inserted}  Actualizados: ${r.updated}  Sem alteração: ${r.skipped}  Desactivados: ${r.deactivated}`);

  const v = report.viaturas;
  console.log(`\nViaturas (Viaturas_v1): ${v.total} total`);
  console.log(`  Ligadas a recurso: ${v.ligadas}  Não ligadas: ${v.naoLigadas}`);
  console.log(`  (referência: 702 ligadas / 66 não ligadas)`);
  const vDiff = v.ligadas - 702;
  if (vDiff !== 0) console.log(`  ⚠ Diferença vs referência: ${vDiff > 0 ? '+' : ''}${vDiff}`);

  const rd = report.radios;
  console.log(`\nRádios (Radios_v1): ${rd.total} total`);
  console.log(`  Por DDI: ${rd.ligadosDDI}  Por COD_EQUIPA: ${rd.ligadosCodEquipa}  Não ligados: ${rd.naoLigados}`);
  console.log(`  (referência: 814 por DDI / 258 por COD_EQUIPA / 196 não ligados)`);

  const b = report.bsf;
  console.log(`\nComposições BSF: ${b.brigadas} brigadas  Criadas: ${b.inserted}  Já existiam: ${b.skipped}`);
  if (b.warnings.length) b.warnings.forEach(w => console.warn('  ⚠', w));

  const o = report.oln;
  console.log(`\nOLN Escala: ${o.total} dias  Inseridos: ${o.inserted}  Ignorados: ${o.skipped}`);
  if (o.warnings.length) o.warnings.forEach(w => console.warn('  ⚠', w));

  const e = report.egfr;
  console.log(`\nEGFR Escala: ${e.total} registos  Upserted: ${e.upserted}`);

  console.log('\n════════════════════════════════════════════════════════════\n');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`CSV_DIR: ${CSV_DIR}`);
  const report = {};
  try {
    await syncRecursos(report);
    await syncViaturas(report);
    await syncRadios(report);
    await seedBSF(report);
    await syncOlnEscala(report);
    await syncEgfrEscala(report);
    printReport(report);
  } finally {
    await pool.end();
  }
}

main().catch(err => { console.error('Erro fatal:', err); process.exit(1); });
