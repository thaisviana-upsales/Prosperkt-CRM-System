/**
 * PROSPEKT CRM — Admin Controller
 *
 * Rota administrativa protegida.
 * Somente SUPER_ADMIN pode executar.
 *
 * POST /api/admin/reset-dados-teste
 *   Zera todos os dados operacionais de teste:
 *     - leads (soft delete: deleted_at + status=arquivado)
 *     - adm_vendas (soft cancel: status=cancelado)
 *     - adm_vendas_historico (hard delete)
 *     - conta_azul_emails_enviados (hard delete)
 *     - comissoes (hard delete)
 *     - atividades (hard delete)
 *     - importacoes_leads / importacao_lead_linhas (hard delete)
 *
 *   NÃO toca em:
 *     - funis, etapas, pipelines
 *     - produtos
 *     - usuarios
 *     - comissao_regras
 *     - metas
 *     - mensagens_padrao / mensagens
 *     - config_email_conta_azul
 *     - motivos_perda
 *     - conversas_whatsapp / mensagens_whatsapp / whatsapp_conversa_aliases
 *     - logs / audit_logs
 *
 *   Cria backup JSON em data/backups/ antes de limpar.
 */

const path = require('path');
const fs   = require('fs');
const { getProvider } = require('../database/dbProvider');

const CONFIRMACAO_ESPERADA = 'RESETAR_DADOS_DE_TESTE_CRM';

// ── POST /api/admin/reset-dados-teste ────────────────────────────────────────
async function resetDadosTeste(req, res) {
  const { sb, isSupa, sqlite } = getProvider();
  const usuario = req.usuario;

  // ── Autenticação / autorização ────────────────────────────────────────────
  if (!usuario || usuario.role !== 'SUPER_ADMIN') {
    console.warn('RESET_CRM_AUTH_BLOCKED', { usuario_id: usuario?.id, role: usuario?.role });
    return res.status(403).json({
      sucesso: false,
      erro: 'Apenas Super Admin pode executar o reset de dados de teste.',
    });
  }

  const { confirmacao } = req.body || {};
  if (confirmacao !== CONFIRMACAO_ESPERADA) {
    console.warn('RESET_CRM_CONFIRMACAO_INVALIDA', { usuario_id: usuario.id, recebida: confirmacao });
    return res.status(400).json({
      sucesso: false,
      erro: `Confirmação inválida. Envie exatamente: "${CONFIRMACAO_ESPERADA}"`,
      esperado: CONFIRMACAO_ESPERADA,
    });
  }

  console.log('RESET_CRM_START', { usuario_id: usuario.id, usuario_nome: usuario.nome, ts: new Date().toISOString() });
  console.log('RESET_CRM_AUTH_OK', { usuario_id: usuario.id, role: usuario.role });

  const agora    = new Date().toISOString();
  const tsArq    = agora.replace(/[:.]/g, '-').slice(0, 19);
  const resultado = {
    ts:                     agora,
    usuario_id:             usuario.id,
    leads_arquivados:       0,
    adm_vendas_cancelados:  0,
    adm_historico_deletados:0,
    conta_azul_deletados:   0,
    comissoes_deletadas:    0,
    atividades_deletadas:   0,
    importacoes_deletadas:  0,
    backup_arquivo:         null,
  };

  try {

    // ── 1. BACKUP ─────────────────────────────────────────────────────────────
    console.log('RESET_CRM_BACKUP_START', { ts: agora });

    const backup = {
      meta: {
        criado_em:    agora,
        criado_por:   usuario.nome || usuario.email,
        confirmacao:  CONFIRMACAO_ESPERADA,
        descricao:    'Backup automático criado antes do reset de dados de teste do CRM Prospekt',
      },
      leads:                    [],
      lead_produtos:            [],
      adm_vendas:               [],
      adm_vendas_historico:     [],
      conta_azul_emails_enviados: [],
      comissoes:                [],
      atividades:               [],
      importacoes_leads:        [],
    };

    if (isSupa) {
      // Coleta dados para backup em paralelo
      const [
        { data: bLeads },
        { data: bLeadProd },
        { data: bAdmV },
        { data: bAdmH },
        { data: bCAEmail },
        { data: bComissoes },
        { data: bAtividades },
        { data: bImportacoes },
      ] = await Promise.all([
        sb.from('leads').select('*').is('deleted_at', null),
        sb.from('lead_produtos').select('*').is('deleted_at', null),
        sb.from('adm_vendas').select('*').neq('status', 'cancelado'),
        sb.from('adm_vendas_historico').select('*'),
        sb.from('conta_azul_emails_enviados').select('*'),
        sb.from('comissoes').select('*'),
        sb.from('atividades').select('*'),
        sb.from('importacoes_leads').select('*'),
      ]);

      backup.leads                     = bLeads                || [];
      backup.lead_produtos             = bLeadProd             || [];
      backup.adm_vendas                = bAdmV                 || [];
      backup.adm_vendas_historico      = bAdmH                 || [];
      backup.conta_azul_emails_enviados = bCAEmail             || [];
      backup.comissoes                 = bComissoes            || [];
      backup.atividades                = bAtividades           || [];
      backup.importacoes_leads         = bImportacoes          || [];

    } else {
      // SQLite backup
      const t = (tbl, q = `SELECT * FROM ${tbl}`) => { try { return sqlite.prepare(q).all(); } catch { return []; } };
      backup.leads                      = t('leads',             'SELECT * FROM leads WHERE deleted_at IS NULL');
      backup.lead_produtos              = t('lead_produtos',     'SELECT * FROM lead_produtos WHERE deleted_at IS NULL');
      backup.adm_vendas                 = t('adm_vendas',        "SELECT * FROM adm_vendas WHERE status != 'cancelado'");
      backup.adm_vendas_historico       = t('adm_vendas_historico');
      backup.conta_azul_emails_enviados = t('conta_azul_emails_enviados');
      backup.comissoes                  = t('comissoes');
      backup.atividades                 = t('atividades');
      backup.importacoes_leads          = t('importacoes_leads');
    }

    // Salva backup em disco
    const backupDir  = path.join(__dirname, '../../data/backups');
    const backupFile = path.join(backupDir, `reset-dados-teste-${tsArq}.json`);
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
    fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2), 'utf-8');
    resultado.backup_arquivo = `data/backups/reset-dados-teste-${tsArq}.json`;

    console.log('RESET_CRM_BACKUP_CREATED', {
      arquivo:          resultado.backup_arquivo,
      leads:            backup.leads.length,
      lead_produtos:    backup.lead_produtos.length,
      adm_vendas:       backup.adm_vendas.length,
      adm_historico:    backup.adm_vendas_historico.length,
      conta_azul:       backup.conta_azul_emails_enviados.length,
      comissoes:        backup.comissoes.length,
      atividades:       backup.atividades.length,
      importacoes:      backup.importacoes_leads.length,
    });

    // ── 2. SOFT DELETE — LEADS ────────────────────────────────────────────────
    // Todos os leads não deletados viram archived. A UI filtra: deleted_at IS NULL.
    if (isSupa) {
      const { data: leadsAfetados } = await sb
        .from('leads')
        .update({ deleted_at: agora, status: 'arquivado', atualizado_em: agora })
        .is('deleted_at', null)
        .select('id');
      resultado.leads_arquivados = leadsAfetados?.length || 0;
    } else {
      const r = sqlite.prepare(
        `UPDATE leads SET deleted_at=?, status='arquivado', atualizado_em=? WHERE deleted_at IS NULL`
      ).run(agora, agora);
      resultado.leads_arquivados = r.changes || 0;
    }
    console.log('RESET_CRM_LEADS_CLEARED', { quantidade: resultado.leads_arquivados });

    // ── 3. SOFT CANCEL — ADM_VENDAS ───────────────────────────────────────────
    // Cancela todos os registros ativos (status=cancelado). O painel só mostra ativo.
    if (isSupa) {
      const { data: admAfetados } = await sb
        .from('adm_vendas')
        .update({ status: 'cancelado', atualizado_em: agora })
        .neq('status', 'cancelado')
        .select('id');
      resultado.adm_vendas_cancelados = admAfetados?.length || 0;
    } else {
      const r = sqlite.prepare(
        `UPDATE adm_vendas SET status='cancelado', atualizado_em=? WHERE status != 'cancelado'`
      ).run(agora);
      resultado.adm_vendas_cancelados = r.changes || 0;
    }
    console.log('RESET_CRM_ADM_VENDAS_CLEARED', { quantidade: resultado.adm_vendas_cancelados });

    // ── 4. HARD DELETE — TABELAS DERIVADAS ────────────────────────────────────

    // adm_vendas_historico
    if (isSupa) {
      const { data: hAdm } = await sb.from('adm_vendas_historico').delete().not('id', 'is', null).select('id');
      resultado.adm_historico_deletados = hAdm?.length || 0;
    } else {
      const r = sqlite.prepare('DELETE FROM adm_vendas_historico').run();
      resultado.adm_historico_deletados = r.changes || 0;
    }

    // conta_azul_emails_enviados
    if (isSupa) {
      const { data: hCA } = await sb.from('conta_azul_emails_enviados').delete().not('id', 'is', null).select('id');
      resultado.conta_azul_deletados = hCA?.length || 0;
    } else {
      try { const r = sqlite.prepare('DELETE FROM conta_azul_emails_enviados').run(); resultado.conta_azul_deletados = r.changes || 0; } catch {}
    }

    // comissoes
    if (isSupa) {
      const { data: hCom } = await sb.from('comissoes').delete().not('id', 'is', null).select('id');
      resultado.comissoes_deletadas = hCom?.length || 0;
    } else {
      try { const r = sqlite.prepare('DELETE FROM comissoes').run(); resultado.comissoes_deletadas = r.changes || 0; } catch {}
    }

    // atividades
    if (isSupa) {
      const { data: hAtv } = await sb.from('atividades').delete().not('id', 'is', null).select('id');
      resultado.atividades_deletadas = hAtv?.length || 0;
    } else {
      try { const r = sqlite.prepare('DELETE FROM atividades').run(); resultado.atividades_deletadas = r.changes || 0; } catch {}
    }

    // importacao_lead_linhas (filhas primeiro)
    if (isSupa) {
      try { await sb.from('importacao_lead_linhas').delete().not('id', 'is', null); } catch {}
      try {
        const { data: hImp } = await sb.from('importacoes_leads').delete().not('id', 'is', null).select('id');
        resultado.importacoes_deletadas = hImp?.length || 0;
      } catch {}
    } else {
      try { sqlite.prepare('DELETE FROM importacao_lead_linhas').run(); } catch {}
      try { const r = sqlite.prepare('DELETE FROM importacoes_leads').run(); resultado.importacoes_deletadas = r.changes || 0; } catch {}
    }

    console.log('RESET_CRM_VENDAS_CLEARED', {
      adm_historico:  resultado.adm_historico_deletados,
      conta_azul:     resultado.conta_azul_deletados,
      comissoes:      resultado.comissoes_deletadas,
      atividades:     resultado.atividades_deletadas,
      importacoes:    resultado.importacoes_deletadas,
    });
    console.log('RESET_CRM_HISTORICOS_CLEARED', { adm_historico: resultado.adm_historico_deletados });

    // ── 5. VERIFICAÇÃO DE ZERO ────────────────────────────────────────────────
    let checkLeads = 0, checkAdm = 0;
    if (isSupa) {
      const { count: cl } = await sb.from('leads').select('id', { count: 'exact', head: true }).is('deleted_at', null);
      const { count: ca } = await sb.from('adm_vendas').select('id', { count: 'exact', head: true }).eq('status', 'ativo');
      checkLeads = cl || 0;
      checkAdm   = ca || 0;
    } else {
      checkLeads = sqlite.prepare('SELECT COUNT(*) as c FROM leads WHERE deleted_at IS NULL').get()?.c || 0;
      checkAdm   = sqlite.prepare("SELECT COUNT(*) as c FROM adm_vendas WHERE status='ativo'").get()?.c || 0;
    }

    console.log('RESET_CRM_DASHBOARD_ZERO_CHECK', {
      leads_ativos_restantes:    checkLeads,
      adm_vendas_ativos_restantes: checkAdm,
      pipeline_zerado:           checkLeads === 0,
      adm_vendas_zerado:         checkAdm   === 0,
    });

    console.log('RESET_CRM_SUCCESS', {
      ...resultado,
      pipeline_zerado:   checkLeads === 0,
      adm_vendas_zerado: checkAdm   === 0,
    });

    return res.json({
      sucesso:          true,
      mensagem:         'Reset concluído. CRM pronto para operação real.',
      backup_arquivo:   resultado.backup_arquivo,
      resumo: {
        leads_arquivados:          resultado.leads_arquivados,
        adm_vendas_cancelados:     resultado.adm_vendas_cancelados,
        adm_historico_deletados:   resultado.adm_historico_deletados,
        conta_azul_deletados:      resultado.conta_azul_deletados,
        comissoes_deletadas:       resultado.comissoes_deletadas,
        atividades_deletadas:      resultado.atividades_deletadas,
        importacoes_deletadas:     resultado.importacoes_deletadas,
        pipeline_zerado:           checkLeads === 0,
        adm_vendas_zerado:         checkAdm   === 0,
      },
      preservado: [
        'funis', 'etapas', 'pipelines', 'produtos', 'usuarios',
        'comissao_regras', 'metas', 'mensagens_padrao', 'mensagens',
        'config_email_conta_azul', 'motivos_perda',
        'conversas_whatsapp (CONGELADO)',
        'mensagens_whatsapp (CONGELADO)',
        'whatsapp_conversa_aliases (CONGELADO)',
      ],
    });

  } catch(e) {
    console.error('RESET_CRM_ERROR', { motivo: e.message, usuario_id: usuario.id, ts: agora });
    return res.status(500).json({ sucesso: false, erro: `Erro durante o reset: ${e.message}` });
  }
}

module.exports = { resetDadosTeste };
