/**
 * PROSPERKT CRM — planilhaLeadsService.js
 * Importação de leads via Google Sheets CSV (polling ou endpoint manual).
 *
 * REGRAS FIXAS:
 *   - Funil destino: "Tráfego Pago" (busca por nome no Supabase)
 *   - Etapa destino: "Lead Recebido"
 *   - Status: ABERTO
 *   - produto_interesse → salvo em observacoes (não é produto de venda)
 *   - Deduplicação por telefone → email → ignorar
 */

const crypto  = require('crypto');
const https   = require('https');
const http    = require('http');
const { getProvider } = require('../database/dbProvider');

// ── Configuração da planilha ──────────────────────────────────────────────────
const SPREADSHEET_ID = '1n4SmQfpV6qu0boPH3Tlaexlhp4KgZ7W9g8kBX0n45s4';
const GID            = '0';
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv&gid=${GID}`;
const FONTE_NOME     = 'planilha_teste';
const POLLING_MS     = 60_000; // 60 segundos

// Colunas aceitas (na ordem esperada; ignora extras)
const COLUNAS = ['data_entrada','nome','telefone','email','empresa','funil','produto_interesse','status'];

// ── Helper: normaliza telefone ────────────────────────────────────────────────
function normTel(tel) {
  return (tel || '').replace(/\D/g, '');
}

// ── Helper: hash de linha para idempotência ───────────────────────────────────
function hashLinha(obj) {
  const str = JSON.stringify([obj.telefone, obj.email, obj.nome, obj.data_entrada].map(v => (v||'').trim().toLowerCase()));
  return crypto.createHash('sha256').update(str).digest('hex');
}

// ── Helper: fetch HTTP/HTTPS retorna string ────────────────────────────────────
function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} ao buscar planilha`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    }).on('error', reject);
  });
}

// ── Parser CSV simples (sem dependência externa) ──────────────────────────────
function parseCSV(csvText) {
  const linhas = csvText.split(/\r?\n/).filter(l => l.trim());
  if (linhas.length < 2) return [];

  // Header (primeira linha)
  const header = linhas[0].split(',').map(h => h.replace(/^"|"$/g, '').trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove acentos
    .replace(/\s+/g, '_'));

  const rows = [];
  for (let i = 1; i < linhas.length; i++) {
    const vals = splitCSVLine(linhas[i]);
    if (!vals.length || vals.every(v => !v.trim())) continue;
    const obj = {};
    header.forEach((h, idx) => {
      if (COLUNAS.includes(h)) obj[h] = (vals[idx] || '').replace(/^"|"$/g, '').trim();
    });
    obj._linha = i + 1; // número real na planilha (1=header)
    rows.push(obj);
  }
  return rows;
}

function splitCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuotes = !inQuotes; }
    else if (ch === ',' && !inQuotes) { result.push(current); current = ''; }
    else { current += ch; }
  }
  result.push(current);
  return result;
}

// ── Busca funil Tráfego Pago + pipeline + etapa Lead Recebido ─────────────────
let _cacheDestino = null;
let _cacheTTL     = 0;

async function resolverDestino() {
  const agora = Date.now();
  if (_cacheDestino && agora < _cacheTTL) return _cacheDestino;

  const { sb } = getProvider();

  // 1. Busca funil cujo nome contém "Tráfego" (case-insensitive)
  const { data: funis } = await sb.from('funis').select('id,nome').eq('ativo', 1);
  const funil = (funis || []).find(f =>
    /tr[aá]fego/i.test(f.nome) || /trafego/i.test(f.nome.normalize('NFD').replace(/[\u0300-\u036f]/g,''))
  );

  if (!funil) throw new Error('Funil "Tráfego Pago" não encontrado no Supabase. Crie-o antes de importar.');

  // 2. Busca pipeline vinculada ao funil
  const { data: pips } = await sb.from('pipelines').select('id,funil_id').eq('funil_id', funil.id).limit(1);
  const pipeline = pips?.[0];
  if (!pipeline) throw new Error(`Nenhuma pipeline encontrada para o funil "${funil.nome}".`);

  // 3. Busca etapa "Lead Recebido" dentro dessa pipeline
  const { data: etapas } = await sb.from('etapas').select('id,nome,ordem')
    .eq('pipeline_id', pipeline.id).order('ordem');
  const etapa = (etapas || []).find(e =>
    /recebido/i.test(e.nome) || /lead recebido/i.test(e.nome)
  ) || etapas?.[0]; // fallback: primeira etapa da pipeline

  if (!etapa) throw new Error(`Nenhuma etapa encontrada na pipeline do funil "${funil.nome}".`);

  _cacheDestino = { funil, pipeline, etapa };
  _cacheTTL     = Date.now() + 5 * 60_000; // cache por 5 min
  return _cacheDestino;
}

// ── Verifica duplicata ────────────────────────────────────────────────────────
async function verificarDuplicata(tel, email) {
  const { sb } = getProvider();
  if (tel) {
    const { data } = await sb.from('leads').select('id,telefone,email,nome')
      .eq('telefone', tel).limit(1);
    if (data?.[0]) return { duplicado: true, leadExistente: data[0] };
  }
  if (email) {
    const { data } = await sb.from('leads').select('id,telefone,email,nome')
      .ilike('email', email).limit(1);
    if (data?.[0]) return { duplicado: true, leadExistente: data[0] };
  }
  return { duplicado: false };
}

// ── Verifica se hash já importado (controle de reimportação) ──────────────────
async function hashJaImportado(hash) {
  const { sb } = getProvider();
  try {
    const { data } = await sb.from('planilha_importacoes').select('id,status_importacao')
      .eq('hash_linha', hash).limit(1);
    return !!data?.[0];
  } catch { return false; } // tabela pode não existir ainda
}

// ── Registra resultado da importação ─────────────────────────────────────────
async function registrarImportacao(info) {
  const { sb } = getProvider();
  try {
    await sb.from('planilha_importacoes').insert({
      id:               crypto.randomBytes(8).toString('hex'),
      fonte:            info.fonte            || FONTE_NOME,
      linha_origem:     info.linha            || null,
      telefone:         info.telefone         || null,
      email:            info.email            || null,
      nome:             info.nome             || null,
      lead_id:          info.lead_id          || null,
      status_importacao:info.status,
      erro:             info.erro             || null,
      hash_linha:       info.hash             || null,
      criado_em:        new Date().toISOString(),
    });
  } catch(e) {
    console.warn('[Planilha] Não foi possível registrar em planilha_importacoes:', e.message);
  }
}

// ── Importa um único lead ─────────────────────────────────────────────────────
async function importarUmLead(row, linha, opts = {}) {
  const { sb } = getProvider();
  const { fonte = FONTE_NOME, superAdminId = null } = opts;

  const tel   = normTel(row.telefone);
  const email = (row.email || '').trim().toLowerCase();
  const nome  = (row.nome || '').trim();

  // Validação mínima
  if (!tel && !email) {
    await registrarImportacao({ linha, telefone: null, email: null, nome, status: 'ignorado', erro: 'Telefone e e-mail ausentes', hash: null, fonte });
    return { ok: false, status: 'ignorado', motivo: 'sem_contato' };
  }

  const hash = hashLinha(row);

  // Idempotência: mesmo hash já importado?
  if (await hashJaImportado(hash)) {
    return { ok: false, status: 'ignorado', motivo: 'ja_importado' };
  }

  // Deduplicação por telefone/email
  const { duplicado, leadExistente } = await verificarDuplicata(tel || null, email || null);
  if (duplicado) {
    // Opcionalmente atualiza campos vazios no lead existente
    if (leadExistente) {
      const upd = {};
      if (!leadExistente.email && email)  upd.email   = email;
      if (!leadExistente.telefone && tel) upd.telefone = tel;
      if (Object.keys(upd).length) {
        upd.atualizado_em = new Date().toISOString();
        await sb.from('leads').update(upd).eq('id', leadExistente.id);
      }
    }
    await registrarImportacao({ linha, telefone: tel, email, nome, lead_id: leadExistente?.id, status: 'duplicado', hash, fonte });
    return { ok: false, status: 'duplicado', lead_id: leadExistente?.id };
  }

  // Resolve funil/pipeline/etapa destino
  let destino;
  try { destino = await resolverDestino(); }
  catch(e) {
    await registrarImportacao({ linha, telefone: tel, email, nome, status: 'erro', erro: e.message, hash, fonte });
    return { ok: false, status: 'erro', motivo: e.message };
  }

  // Monta dados extras
  const produtoInteresse = (row.produto_interesse || '').trim();
  const observacoes = produtoInteresse
    ? `Interesse: ${produtoInteresse}`
    : undefined;

  const data_entrada = row.data_entrada ? new Date(row.data_entrada).toISOString() : new Date().toISOString();

  const leadId = crypto.randomBytes(16).toString('hex');
  const agora  = new Date().toISOString();

  const payload = {
    id:            leadId,
    nome:          nome || `Lead ${tel || email}`,
    telefone:      tel  || null,
    email:         email || null,
    empresa:       (row.empresa || '').trim() || null,
    funil_id:      destino.funil.id,
    pipeline_id:   destino.pipeline.id,
    etapa_id:      destino.etapa.id,
    status:        'ABERTO',
    observacoes:   observacoes || null,
    dados_extras:  JSON.stringify({
      produto_interesse: produtoInteresse || null,
      fonte:             fonte,
      origem:            'planilha',
      planilha_id:       SPREADSHEET_ID,
    }),
    criado_em:     data_entrada || agora,
    atualizado_em: agora,
  };

  const { data, error } = await sb.from('leads').insert(payload).select().single();
  if (error) {
    await registrarImportacao({ linha, telefone: tel, email, nome, status: 'erro', erro: error.message, hash, fonte });
    return { ok: false, status: 'erro', motivo: error.message };
  }

  await registrarImportacao({ linha, telefone: tel, email, nome, lead_id: leadId, status: 'criado', hash, fonte });
  return { ok: true, status: 'criado', lead_id: leadId, lead: data };
}

// ── Importar lote (array de rows) ─────────────────────────────────────────────
async function importarLote(rows, opts = {}) {
  const resultados = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const linha = row._linha || (i + 2);
    try {
      const r = await importarUmLead(row, linha, opts);
      resultados.push({ linha, nome: row.nome, telefone: row.telefone, ...r });
    } catch(e) {
      resultados.push({ linha, nome: row.nome, telefone: row.telefone, ok: false, status: 'erro', motivo: e.message });
    }
  }
  return resultados;
}

// ── Sincroniza com a planilha Google Sheets ───────────────────────────────────
async function sincronizarPlanilha() {
  console.log('[Planilha] Iniciando sincronização...');
  try {
    const csv  = await fetchUrl(CSV_URL);
    const rows = parseCSV(csv);
    if (!rows.length) { console.log('[Planilha] Nenhuma linha encontrada.'); return; }
    const resultados = await importarLote(rows, { fonte: FONTE_NOME });
    const criados    = resultados.filter(r => r.status === 'criado').length;
    const duplicados = resultados.filter(r => r.status === 'duplicado').length;
    const erros      = resultados.filter(r => r.status === 'erro').length;
    console.log(`[Planilha] Sync concluída: ${criados} criados, ${duplicados} duplicados, ${erros} erros de ${rows.length} linhas.`);
    return resultados;
  } catch(e) {
    console.error('[Planilha] Erro na sincronização:', e.message);
  }
}

// ── Agendador de polling ──────────────────────────────────────────────────────
let _pollingTimer = null;

function iniciarPolling() {
  if (_pollingTimer) return; // já iniciado
  // Primeira sync após 15s de estabilização do servidor
  setTimeout(() => sincronizarPlanilha().catch(e => console.error('[Planilha]', e.message)), 15_000);
  // Polling a cada 60s
  _pollingTimer = setInterval(() => {
    sincronizarPlanilha().catch(e => console.error('[Planilha]', e.message));
  }, POLLING_MS);
  console.log(`[Planilha] Polling iniciado — intervalo: ${POLLING_MS / 1000}s`);
}

function pararPolling() {
  if (_pollingTimer) { clearInterval(_pollingTimer); _pollingTimer = null; }
}

module.exports = {
  importarUmLead,
  importarLote,
  parseCSV,
  fetchUrl,
  sincronizarPlanilha,
  iniciarPolling,
  pararPolling,
  normTel,
  CSV_URL,
  COLUNAS,
};
