#!/usr/bin/env node
/**
 * PROSPEKT CRM — B19: corrige importações de planilha presas em status não-final.
 *
 * Uso:
 *   node scripts/corrigir-importacoes-presas.js            → DRY-RUN (só mostra)
 *   node scripts/corrigir-importacoes-presas.js --aplicar  → grava as correções
 *   ... --aplicar --expirar-dias=7  → também cancela "Aguardando" COM linhas
 *                                     válidas, abandonadas há mais de N dias
 *
 * Regras (somente UPDATE em importacoes_leads — nunca cria/apaga leads):
 *   1. aguardando_confirmacao + total_validas = 0      → com_erros
 *   2. importando há > 1h (processo morreu)            → status recalculado pelas
 *      linhas reais (importado x total) via calcularStatusFinal
 *   3. concluido com total_importados < total_linhas   → concluido_com_erros / com_erros
 *   4. (opcional) aguardando_confirmacao com válidas, > N dias → cancelado
 *
 * Se o patch SQL B19 (CHECK) não estiver aplicado, os novos status caem no
 * fallback 'concluido' e o histórico deriva o rótulo pelos contadores.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { createClient } = require('@supabase/supabase-js');
const {
  STATUS_IMPORTACAO: S, calcularStatusFinal, gravarStatusImportacao,
} = require('../src/controllers/importacaoExcelController');

const APLICAR = process.argv.includes('--aplicar');
const argExp  = process.argv.find(a => a.startsWith('--expirar-dias='));
const EXPIRAR_DIAS = argExp ? Number(argExp.split('=')[1]) : null;
const UMA_HORA = 60 * 60 * 1000;

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function contarLinhas(importacaoId) {
  const { data, error } = await sb.from('importacao_lead_linhas')
    .select('status').eq('importacao_id', importacaoId);
  if (error) throw new Error(error.message);
  const c = { importado: 0, erro: 0 };
  (data || []).forEach(l => { if (c[l.status] !== undefined) c[l.status]++; });
  return c;
}

(async () => {
  console.log(`\n=== B19 — corrigir importações presas (${APLICAR ? 'APLICAR' : 'DRY-RUN'}) ===\n`);

  const { data: imps, error } = await sb.from('importacoes_leads')
    .select('id,nome_arquivo,status,total_linhas,total_validas,total_erros,total_importados,criado_em,finalizado_em')
    .in('status', [S.AGUARDANDO, S.IMPORTANDO, S.CONCLUIDO])
    .order('criado_em', { ascending: true });
  if (error) { console.error('Erro ao ler importações:', error.message); process.exit(1); }

  const agora = Date.now();
  const plano = [];

  for (const imp of imps || []) {
    const linhas     = Number(imp.total_linhas) || 0;
    const validas    = Number(imp.total_validas) || 0;
    const importados = Number(imp.total_importados) || 0;
    const idade      = agora - new Date(imp.criado_em).getTime();

    if (imp.status === S.AGUARDANDO && validas === 0) {
      plano.push({ imp, campos: { status: S.COM_ERROS, finalizado_em: imp.finalizado_em || imp.criado_em }, motivo: '0 linhas válidas' });
    } else if (imp.status === S.AGUARDANDO && EXPIRAR_DIAS && idade > EXPIRAR_DIAS * 86400000) {
      plano.push({ imp, campos: { status: S.CANCELADO, finalizado_em: new Date().toISOString() }, motivo: `abandonada > ${EXPIRAR_DIAS} dias` });
    } else if (imp.status === S.IMPORTANDO && idade > UMA_HORA) {
      const c = await contarLinhas(imp.id);
      plano.push({
        imp,
        campos: {
          status: calcularStatusFinal({ importados: c.importado, falhas: Math.max(0, linhas - c.importado) }),
          total_importados: c.importado,
          finalizado_em: new Date().toISOString(),
        },
        motivo: `importando travado (${c.importado} importados nas linhas)`,
      });
    } else if (imp.status === S.CONCLUIDO && linhas > importados) {
      plano.push({ imp, campos: { status: calcularStatusFinal({ importados, falhas: linhas - importados }) }, motivo: `${importados}/${linhas} importados` });
    }
  }

  if (!plano.length) { console.log('Nenhuma importação para corrigir. ✅'); return; }

  for (const p of plano) {
    const { imp, campos, motivo } = p;
    let resultado = '(dry-run)';
    if (APLICAR) {
      const gravado = await gravarStatusImportacao(sb, imp.id, campos);
      resultado = gravado ? `→ gravado "${gravado}"` : '✖ FALHOU';
    }
    console.log(`${imp.criado_em.slice(0, 16)}  ${imp.status.padEnd(22)} → ${campos.status.padEnd(20)} ${motivo.padEnd(38)} ${imp.nome_arquivo}  ${resultado}`);
  }
  console.log(`\nTotal: ${plano.length} importação(ões).${APLICAR ? '' : ' Rode com --aplicar para gravar.'}\n`);
})().catch(e => { console.error(e); process.exit(1); });
