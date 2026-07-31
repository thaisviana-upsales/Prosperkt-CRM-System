/**
 * PROSPEKT CRM — SDR Service
 * Resolve o SDR ativo que receberá leads automáticos.
 *
 * Regras:
 *  1. Busca SDR com sdr_padrao=true e ativo=true → usa esse
 *  2. Se não houver padrão, busca único SDR ativo → usa esse
 *  3. Se múltiplos SDRs ativos sem padrão → loga erro e retorna null
 *  4. Se nenhum SDR ativo → loga aviso e retorna null
 */

const { getProvider } = require('../database/dbProvider');

/**
 * Retorna o ID do SDR que deve receber o próximo lead automático.
 * @returns {Promise<string|null>}
 */
async function resolverSdrAtivo() {
  const { sb, isSupa } = getProvider();

  try {
    if (isSupa) {
      // 1. Tenta SDR padrão
      const { data: sdrPadrao } = await sb.from('usuarios')
        .select('id, nome')
        .eq('role', 'SDR')
        .eq('ativo', true)
        .eq('sdr_padrao', true)
        .limit(1)
        .maybeSingle();

      if (sdrPadrao) {
        console.log('[SDR_SERVICE] SDR padrão encontrado:', sdrPadrao.nome, '| id:', sdrPadrao.id);
        return sdrPadrao.id;
      }

      // 2. Sem padrão: busca todos os SDRs ativos
      const { data: sdrsAtivos } = await sb.from('usuarios')
        .select('id, nome')
        .eq('role', 'SDR')
        .eq('ativo', true)
        .order('nome');

      if (!sdrsAtivos || sdrsAtivos.length === 0) {
        console.warn('[SDR_SERVICE] ⚠️ Nenhum SDR ativo configurado para receber leads automáticos.');
        return null;
      }

      if (sdrsAtivos.length === 1) {
        console.log('[SDR_SERVICE] Único SDR ativo:', sdrsAtivos[0].nome, '| id:', sdrsAtivos[0].id);
        return sdrsAtivos[0].id;
      }

      // 3. Múltiplos SDRs sem padrão → erro administrativo
      console.error(
        '[SDR_SERVICE] ❌ ERRO: Múltiplos SDRs ativos sem sdr_padrao=true. ' +
        'Marque um SDR como padrão. SDRs encontrados: ' +
        sdrsAtivos.map(s => s.nome).join(', ')
      );
      return null;

    } else {
      // SQLite
      const { getDb } = require('../database/db');
      const db = getDb();

      // 1. SDR padrão
      const sdrPadrao = db.prepare(
        `SELECT id, nome FROM usuarios WHERE role='SDR' AND ativo=1 AND sdr_padrao=1 LIMIT 1`
      ).get();
      if (sdrPadrao) {
        console.log('[SDR_SERVICE] SDR padrão (SQLite):', sdrPadrao.nome);
        return sdrPadrao.id;
      }

      // 2. Único SDR ativo
      const sdrs = db.prepare(
        `SELECT id, nome FROM usuarios WHERE role='SDR' AND ativo=1 ORDER BY nome`
      ).all();
      if (!sdrs || sdrs.length === 0) {
        console.warn('[SDR_SERVICE] ⚠️ Nenhum SDR ativo (SQLite).');
        return null;
      }
      if (sdrs.length === 1) return sdrs[0].id;

      console.error('[SDR_SERVICE] ❌ Múltiplos SDRs sem padrão (SQLite):', sdrs.map(s => s.nome).join(', '));
      return null;
    }
  } catch (e) {
    console.error('[SDR_SERVICE] Erro ao resolver SDR ativo:', e.message);
    return null;
  }
}

module.exports = { resolverSdrAtivo };
