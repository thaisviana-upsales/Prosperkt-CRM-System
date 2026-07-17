/**
 * PROSPEKT CRM — Etapa Histórico Service
 * Registra passagem de leads por etapas para o Funil de Conversão correto.
 *
 * Regra central: UNIQUE(lead_id, etapa_id) — cada lead conta no máximo
 * 1 vez por etapa, independente de quantas vezes passar.
 *
 * Fonte de verdade para o Funil de Conversão do Dashboard.
 */

const { MODE, getProvider } = require('../database/dbProvider');
const crypto = require('crypto');

// ── Supabase: garante que a tabela existe (idempotente) ──────────────────────
let _supaTableEnsured = false;

async function ensureSupabaseTable(sb) {
  if (_supaTableEnsured) return;
  try {
    // Tenta inserir e ignorar — se a tabela não existir, criamos via SQL
    // Usa o endpoint de RPC se disponível, senão assume que a tabela já existe
    await sb.from('lead_etapa_historico').select('id').limit(1);
    _supaTableEnsured = true;
  } catch (e) {
    // Silencioso — tabela pode não existir ainda no Supabase
    // A criação deve ser feita via migration no painel do Supabase
    console.warn('[EtapaHistorico] Tabela lead_etapa_historico não encontrada no Supabase. Execute a migration.');
    _supaTableEnsured = true; // não tenta de novo
  }
}

/**
 * Registra que um lead entrou em uma etapa.
 * Idempotente: usa INSERT OR IGNORE (SQLite) / upsert sem atualizar (Supabase).
 *
 * @param {object} params
 * @param {string} params.leadId
 * @param {string} params.etapaId
 * @param {string|null} params.funilId
 * @param {string|null} params.responsavelId
 * @param {string} params.origem - 'manual' | 'migration' | 'automacao'
 * @param {Date|string|null} params.entrou_em - timestamp da entrada (default: agora)
 */
async function registrarPassagem({ leadId, etapaId, funilId = null, responsavelId = null, origem = 'manual', entrou_em = null }) {
  if (!leadId || !etapaId) return;

  const agora = new Date().toISOString();
  const entradaTs = entrou_em ? (typeof entrou_em === 'string' ? entrou_em : entrou_em.toISOString()) : agora;

  try {
    if (MODE === 'supabase') {
      const { sb } = getProvider();
      if (!sb) return;
      await ensureSupabaseTable(sb);

      // Upsert: onConflict='lead_id,etapa_id' → ignora se já existe (não atualiza)
      await sb.from('lead_etapa_historico').upsert(
        {
          id:             crypto.randomBytes(16).toString('hex'),
          lead_id:        leadId,
          etapa_id:       etapaId,
          funil_id:       funilId,
          responsavel_id: responsavelId,
          entrou_em:      entradaTs,
          criado_em:      agora,
          origem,
        },
        { onConflict: 'lead_id,etapa_id', ignoreDuplicates: true }
      );
    } else {
      const { getDb } = require('../database/db');
      const db = getDb();
      const stmt = db.prepare(`
        INSERT OR IGNORE INTO lead_etapa_historico
          (id, lead_id, etapa_id, funil_id, responsavel_id, entrou_em, criado_em, origem)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const result = stmt.run(
        crypto.randomBytes(16).toString('hex'),
        leadId, etapaId, funilId || null, responsavelId || null,
        entradaTs, agora, origem
      );
      if (result.changes === 0) {
        console.log('[FUNIL_CONVERSAO_HISTORICO_DUPLICADO_IGNORADO] lead:', leadId, '+ etapa:', etapaId, '— já existe, ignorado.');
        return; // não loga duplicata como novo registro
      }
    }
    console.log('[FUNIL_HISTORICO_REGISTRO] lead:', leadId, '→ etapa:', etapaId, '| origem:', origem);
    return true; // registrou com sucesso
  } catch (e) {
    // Não propaga erro — registro de histórico não pode quebrar fluxo principal
    console.error('[EtapaHistorico] Erro ao registrar passagem:', e.message);
    return false;
  }
}


/**
 * Garante que um lead tem registro na PRIMEIRA etapa da pipeline do seu funil.
 * Chame após criar ou mover um lead para o funil.
 *
 * Resolve: lead criado com etapa_id diferente da primeira ou sem pipeline_id
 * que ficaria "fora" do Lead Recebido no Funil de Conversão.
 */
async function registrarPrimeiraEtapa({ leadId, funilId, pipelineId, responsavelId, criadoEm }) {
  if (!leadId || (!funilId && !pipelineId)) return;

  try {
    if (MODE === 'supabase') {
      const { sb } = getProvider();
      if (!sb) return;

      // Encontra a pipeline do funil
      let pipeId = pipelineId;
      if (!pipeId && funilId) {
        const { data: pipes } = await sb.from('pipelines')
          .select('id').eq('funil_id', funilId)
          .order('criado_em', { ascending: true }).limit(1);
        pipeId = pipes?.[0]?.id || null;
      }
      if (!pipeId) return;

      // Primeira etapa (menor ordem)
      const { data: primeiraEtapas } = await sb.from('etapas')
        .select('id').eq('pipeline_id', pipeId)
        .order('ordem', { ascending: true }).limit(1);
      const primeiraEtapaId = primeiraEtapas?.[0]?.id;
      if (!primeiraEtapaId) return;

      // Verifica se já existe (idempotente)
      const { data: existe } = await sb.from('lead_etapa_historico')
        .select('id').eq('lead_id', leadId).eq('etapa_id', primeiraEtapaId).limit(1);
      if ((existe || []).length > 0) {
        console.log('[FUNIL_HISTORICO_PRIMEIRA_ETAPA] lead:', leadId, '| já registrado em etapa:', primeiraEtapaId);
        return;
      }

      const entradaTs = criadoEm
        ? (typeof criadoEm === 'string' ? criadoEm : criadoEm.toISOString())
        : new Date().toISOString();

      await sb.from('lead_etapa_historico').insert({
        id:             crypto.randomBytes(16).toString('hex'),
        lead_id:        leadId,
        etapa_id:       primeiraEtapaId,
        funil_id:       funilId || null,
        pipeline_id:    pipeId,
        responsavel_id: responsavelId || null,
        entrou_em:      entradaTs,
        criado_em:      new Date().toISOString(),
        origem:         'auto_primeira_etapa',
      });
      console.log('[FUNIL_HISTORICO_PRIMEIRA_ETAPA] lead:', leadId, '→ primeira etapa:', primeiraEtapaId, '| pipeline:', pipeId);

    } else {
      const { getDb } = require('../database/db');
      const db = getDb();
      let pipeId = pipelineId;
      if (!pipeId && funilId) {
        const pipe = db.prepare('SELECT id FROM pipelines WHERE funil_id=? ORDER BY ordem ASC LIMIT 1').get(funilId);
        pipeId = pipe?.id || null;
      }
      if (!pipeId) return;
      const primeiraEtapa = db.prepare('SELECT id FROM etapas WHERE pipeline_id=? ORDER BY ordem ASC LIMIT 1').get(pipeId);
      if (!primeiraEtapa) return;
      const entradaTs = criadoEm
        ? (typeof criadoEm === 'string' ? criadoEm : criadoEm.toISOString())
        : new Date().toISOString();
      const result = db.prepare(`
        INSERT OR IGNORE INTO lead_etapa_historico
          (id, lead_id, etapa_id, funil_id, responsavel_id, entrou_em, criado_em, origem)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        crypto.randomBytes(16).toString('hex'),
        leadId, primeiraEtapa.id, funilId || null, responsavelId || null,
        entradaTs, new Date().toISOString(), 'auto_primeira_etapa'
      );
      if (result.changes > 0) {
        console.log('[FUNIL_HISTORICO_PRIMEIRA_ETAPA] lead:', leadId, '→ primeira etapa:', primeiraEtapa.id);
      }
    }
  } catch (e) {
    console.error('[EtapaHistorico] Erro ao registrar primeira etapa:', e.message);
  }
}

/**
 * Faz migration de dados existentes:
 * - Para cada lead ativo, registra a etapa atual como "etapa alcançada"
 * - Não sobrescreve registros existentes (idempotente)
 * - Usa criado_em do lead como timestamp de entrada para leads na primeira etapa
 *
 * Chame esta função na inicialização do servidor (uma vez por ambiente).
 */
async function migrarDadosExistentes() {
  console.log('[FUNIL_HISTORICO_MIGRATION_START] Iniciando migration de passagens existentes...');

  try {
    if (MODE === 'supabase') {
      const { sb } = getProvider();
      if (!sb) return;
      await ensureSupabaseTable(sb);

      // Busca todos os leads com etapa_id definida
      const { data: leads, error } = await sb
        .from('leads')
        .select('id, etapa_id, funil_id, responsavel_id, criado_em, etapa_atualizada_em')
        .not('etapa_id', 'is', null);

      if (error) {
        console.error('[FUNIL_HISTORICO_MIGRATION] Erro ao buscar leads:', error.message);
        return;
      }

      console.log('[FUNIL_HISTORICO_MIGRATION] Leads encontrados para migration:', (leads||[]).length);

      let registrados = 0, ignorados = 0;
      for (const lead of (leads || [])) {
        // Verifica se já existe registro para este lead+etapa
        const { data: existe } = await sb
          .from('lead_etapa_historico')
          .select('id')
          .eq('lead_id', lead.id)
          .eq('etapa_id', lead.etapa_id)
          .limit(1);

        if ((existe || []).length > 0) {
          ignorados++;
          continue; // já existe — idempotente
        }

        // Usa etapa_atualizada_em ou criado_em como timestamp de entrada
        const entradaTs = lead.etapa_atualizada_em || lead.criado_em || new Date().toISOString();

        try {
          await sb.from('lead_etapa_historico').insert({
            id:             crypto.randomBytes(16).toString('hex'),
            lead_id:        lead.id,
            etapa_id:       lead.etapa_id,
            funil_id:       lead.funil_id || null,
            responsavel_id: lead.responsavel_id || null,
            entrou_em:      entradaTs,
            criado_em:      new Date().toISOString(),
            origem:         'migration',
          });
          registrados++;
        } catch (_eDup) { /* ignora duplicata */ }
      }

      console.log('[FUNIL_HISTORICO_MIGRATION_DONE] Supabase | registrados:', registrados, '| ignorados (já existiam):', ignorados);

      // Backfill: Registra a PRIMEIRA etapa da pipeline para cada lead (Supabase)
      // Garante que a 1ª etapa apareça no Funil de Conversão mesmo que o lead tenha avançado
      try {
        const { data: leadsComPipeline } = await sb
          .from('leads')
          .select('id, pipeline_id, funil_id, responsavel_id, criado_em')
          .not('pipeline_id', 'is', null);

        if (leadsComPipeline?.length) {
          // Busca a primeira etapa de cada pipeline (menor ordem)
          const pipelineIds = [...new Set(leadsComPipeline.map(l => l.pipeline_id))];
          const { data: primeiraEtapas } = await sb
            .from('etapas')
            .select('id, pipeline_id, ordem')
            .in('pipeline_id', pipelineIds)
            .order('ordem', { ascending: true });

          // Mapa: pipeline_id -> etapa de menor ordem
          const primeiraEtapaMap = {};
          for (const e of (primeiraEtapas || [])) {
            if (!primeiraEtapaMap[e.pipeline_id]) primeiraEtapaMap[e.pipeline_id] = e;
          }

          let backfillCount = 0;
          for (const lead of leadsComPipeline) {
            const primeiraEtapa = primeiraEtapaMap[lead.pipeline_id];
            if (!primeiraEtapa) continue;

            // Verifica se já existe registro para este lead + primeira etapa
            const { data: existePrimeira } = await sb
              .from('lead_etapa_historico')
              .select('id')
              .eq('lead_id', lead.id)
              .eq('etapa_id', primeiraEtapa.id)
              .limit(1);

            if ((existePrimeira || []).length > 0) continue; // já existe

            try {
              await sb.from('lead_etapa_historico').insert({
                id:             crypto.randomBytes(16).toString('hex'),
                lead_id:        lead.id,
                etapa_id:       primeiraEtapa.id,
                funil_id:       lead.funil_id || null,
                responsavel_id: lead.responsavel_id || null,
                entrou_em:      lead.criado_em || new Date().toISOString(),
                criado_em:      new Date().toISOString(),
                origem:         'migration_backfill_primeira_etapa',
              });
              backfillCount++;
            } catch (_eDup2) { /* ignora duplicata */ }
          }
          console.log('[FUNIL_HISTORICO_MIGRATION_DONE] Supabase | primeira etapa backfill:', backfillCount);
        }
      } catch (eBf) {
        console.warn('[FUNIL_HISTORICO_MIGRATION] Backfill primeira etapa (Supabase):', eBf.message);
      }


    } else {
      // SQLite
      const { getDb } = require('../database/db');
      const db = getDb();

      const result = db.prepare(`
        INSERT OR IGNORE INTO lead_etapa_historico
          (id, lead_id, etapa_id, funil_id, responsavel_id, entrou_em, criado_em, origem)
        SELECT
          lower(hex(randomblob(16))),
          l.id,
          l.etapa_id,
          p.funil_id,
          l.responsavel_id,
          COALESCE(l.atualizado_em, l.criado_em, datetime('now')),
          datetime('now'),
          'migration'
        FROM leads l
        LEFT JOIN pipelines p ON l.pipeline_id = p.id
        WHERE l.etapa_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM lead_etapa_historico h
            WHERE h.lead_id = l.id AND h.etapa_id = l.etapa_id
          )
      `).run();

      console.log('[FUNIL_HISTORICO_MIGRATION_DONE] SQLite | etapa atual registrada:', result.changes);

      // Backfill: Registra a PRIMEIRA etapa da pipeline para cada lead que não tem registro nela
      // Garante que Lead Recebido aparecer no funil mesmo que o lead já tenha avançado
      const backfillResult = db.prepare(`
        INSERT OR IGNORE INTO lead_etapa_historico
          (id, lead_id, etapa_id, funil_id, responsavel_id, entrou_em, criado_em, origem)
        SELECT
          lower(hex(randomblob(16))),
          l.id,
          e_first.id,
          p.funil_id,
          l.responsavel_id,
          COALESCE(l.criado_em, datetime('now')),
          datetime('now'),
          'migration_backfill_primeira_etapa'
        FROM leads l
        JOIN pipelines p ON l.pipeline_id = p.id
        JOIN (
          SELECT e.pipeline_id, e.id, e.ordem
          FROM etapas e
          WHERE e.ordem = (
            SELECT MIN(e2.ordem) FROM etapas e2 WHERE e2.pipeline_id = e.pipeline_id
          )
        ) e_first ON e_first.pipeline_id = p.id
        WHERE l.pipeline_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM lead_etapa_historico h
            WHERE h.lead_id = l.id AND h.etapa_id = e_first.id
          )
      `).run();

      console.log('[FUNIL_HISTORICO_MIGRATION_DONE] SQLite | primeira etapa backfill:', backfillResult.changes);
    }
  } catch (e) {
    console.error('[FUNIL_HISTORICO_MIGRATION] Erro:', e.message);
  }
}

/**
 * Busca passagens por etapa para o Funil de Conversão do Dashboard.
 * Retorna: { etapa_id → Set(lead_ids_que_passaram) }
 *
 * @param {object} filtros
 * @param {string[]} filtros.etapaIds - IDs das etapas a buscar
 * @param {string[]} filtros.leadIds  - IDs dos leads no escopo (filtro de funil/vendedor)
 * @param {string|null} filtros.dataIni - '2026-01-01' (filtro por entrou_em)
 * @param {string|null} filtros.dataFim - '2026-12-31'
 */
async function buscarPassagensPorEtapa({ etapaIds = [], leadIds = [], dataIni = null, dataFim = null }) {
  const passagemMap = {}; // etapa_id → Set(lead_ids)

  if (!etapaIds.length) return passagemMap;

  const leadIdsSet = new Set(leadIds);

  try {
    if (MODE === 'supabase') {
      const { sb } = getProvider();
      if (!sb) return passagemMap;

      let q = sb
        .from('lead_etapa_historico')
        .select('lead_id, etapa_id')
        .in('etapa_id', etapaIds);

      // Filtra por data de entrada na etapa
      if (dataIni) q = q.gte('entrou_em', dataIni + 'T00:00:00');
      if (dataFim) q = q.lte('entrou_em', dataFim + 'T23:59:59');

      const { data, error } = await q;
      if (error) {
        console.warn('[EtapaHistorico] buscarPassagens error:', error.message);
        return passagemMap;
      }

      for (const row of (data || [])) {
        // Filtra apenas leads do escopo (funil/vendedor)
        if (leadIdsSet.size > 0 && !leadIdsSet.has(row.lead_id)) continue;
        if (!passagemMap[row.etapa_id]) passagemMap[row.etapa_id] = new Set();
        passagemMap[row.etapa_id].add(row.lead_id);
      }
    } else {
      const { getDb } = require('../database/db');
      const db = getDb();
      const ph = etapaIds.map(() => '?').join(',');
      let sql = `SELECT lead_id, etapa_id FROM lead_etapa_historico WHERE etapa_id IN (${ph})`;
      const params = [...etapaIds];
      if (dataIni) { sql += ' AND entrou_em >= ?'; params.push(dataIni + 'T00:00:00'); }
      if (dataFim) { sql += ' AND entrou_em <= ?'; params.push(dataFim + 'T23:59:59'); }

      const rows = db.prepare(sql).all(...params);
      for (const row of rows) {
        if (leadIdsSet.size > 0 && !leadIdsSet.has(row.lead_id)) continue;
        if (!passagemMap[row.etapa_id]) passagemMap[row.etapa_id] = new Set();
        passagemMap[row.etapa_id].add(row.lead_id);
      }
    }
  } catch (e) {
    console.error('[EtapaHistorico] buscarPassagensPorEtapa:', e.message);
  }

  return passagemMap;
}

module.exports = { registrarPassagem, registrarPrimeiraEtapa, migrarDadosExistentes, buscarPassagensPorEtapa };
