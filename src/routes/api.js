/**
 * PROSPERKT CRM — API Routes
 */

const express = require('express');
const router  = express.Router();

const { autenticar, exigirRole, exigirSuperAdmin } = require('../middleware/auth');
const { auditMiddleware } = require('../services/auditService');

const authCtrl     = require('../controllers/authController');
const usuariosCtrl = require('../controllers/usuariosController');
const logsCtrl     = require('../controllers/logsController');
const funisCtrl    = require('../controllers/funisController');
const etapasCtrl   = require('../controllers/etapasController');
const leadsCtrl      = require('../controllers/leadsController');
const dashboardCtrl  = require('../controllers/dashboardController');
const metasCtrl      = require('../controllers/metasController');
const comissoesCtrl  = require('../controllers/comissoesController');
const whatsappCtrl   = require('../controllers/whatsappController');
const automacoesCtrl  = require('../controllers/automacoesMsgController');
const msgsPadraoCtrl     = require('../controllers/msgsPadraoController');
const motivosPerdaCtrl   = require('../controllers/motivosPerdaController');
const produtosCtrl       = require('../controllers/produtosController');
const auditCtrl          = require('../controllers/auditController');
const backupCtrl         = require('../controllers/backupController');
const importacaoCtrl     = require('../controllers/importacaoLeadsController');

// Seed funis iniciais (só roda se vazio)
funisCtrl.seedFunis();

// Agenda backups automáticos (diário às 3h, semanal às segundas, mensal dia 1)
try { require('../services/backupService').agendarBackups(); } catch(e) { console.warn('[Backup] Agendador não iniciado:', e.message); }

// Polling da planilha desativado — descomentar para reativar:
// try { require('../services/planilhaLeadsService').iniciarPolling(); } catch(e) { console.warn('[Planilha] Polling não iniciado:', e.message); }

// Aplica audit middleware em todas as rotas
router.use(auditMiddleware);

// ─────────────────────────────────────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────────────────────────────────────
router.post('/auth/login',   authCtrl.login);
router.post('/auth/refresh', authCtrl.refresh);
router.post('/auth/logout',  autenticar, authCtrl.logout);
router.get ('/auth/me',      autenticar, authCtrl.me);

// ─────────────────────────────────────────────────────────────────────────────
// USUARIOS
// ─────────────────────────────────────────────────────────────────────────────
router.get   ('/usuarios',          autenticar, usuariosCtrl.listar);
router.get   ('/usuarios/:id',      autenticar, usuariosCtrl.buscarPorId);
router.post  ('/usuarios',          autenticar, exigirRole('GESTOR'), usuariosCtrl.criar);
router.patch ('/usuarios/:id',      autenticar, usuariosCtrl.atualizar);
router.post  ('/usuarios/:id/avatar', autenticar, usuariosCtrl.uploadAvatar);
router.delete('/usuarios/:id',      autenticar, exigirSuperAdmin,     usuariosCtrl.deletar);

// ─────────────────────────────────────────────────────────────────────────────
// LOGS DE AUDITORIA
// ─────────────────────────────────────────────────────────────────────────────
router.get('/logs',      autenticar, exigirRole('GESTOR'), logsCtrl.listar);
router.get('/dashboard', autenticar, dashboardCtrl.resumo);

// ─────────────────────────────────────────────────────────────────────────────
// FUNIS
// ─────────────────────────────────────────────────────────────────────────────
router.get   ('/funis',     autenticar, funisCtrl.listar);
router.get   ('/funis/:id', autenticar, funisCtrl.buscarPorId);
router.post  ('/funis',     autenticar, exigirRole('GESTOR'), funisCtrl.criar);
router.patch ('/funis/:id', autenticar, exigirRole('GESTOR'), funisCtrl.atualizar);
router.delete('/funis/:id', autenticar, exigirSuperAdmin, funisCtrl.deletar);

// ─────────────────────────────────────────────────────────────────────────────
// ETAPAS
// ─────────────────────────────────────────────────────────────────────────────
router.get   ('/etapas',            autenticar, etapasCtrl.listar);
router.post  ('/etapas',            autenticar, exigirRole('GESTOR'), etapasCtrl.criar);
router.post  ('/etapas/reordenar',  autenticar, exigirRole('GESTOR'), etapasCtrl.reordenar);
router.patch ('/etapas/:id',        autenticar, exigirRole('GESTOR'), etapasCtrl.atualizar);
router.delete('/etapas/:id',        autenticar, exigirRole('GESTOR'), etapasCtrl.deletar);

// ─────────────────────────────────────────────────────────────────────────────
// LEADS
// ─────────────────────────────────────────────────────────────────────────────
router.get   ('/leads/distribuicao',        autenticar, leadsCtrl.getDistribuicao);
router.post  ('/leads/distribuicao',        autenticar, exigirRole('GESTOR'), leadsCtrl.setDistribuicao);

// ── Importação de leads via planilha (GESTOR+) ———————————————————————————
// Rotas estáticas ANTES de /leads/:id para não colidir
router.post  ('/leads/importar-planilha',   autenticar, exigirRole('GESTOR'), importacaoCtrl.importarPlanilha);
router.post  ('/leads/webhook-planilha',    importacaoCtrl.webhookPlanilha); // sem JWT — valida secret no header
router.get   ('/leads/importacoes',         autenticar, exigirRole('GESTOR'), importacaoCtrl.listarImportacoes);
router.post  ('/leads/sync-planilha',       autenticar, exigirRole('GESTOR'), importacaoCtrl.syncManual);

router.get   ('/leads',                     autenticar, leadsCtrl.listar);
router.get   ('/leads/:id',                 autenticar, leadsCtrl.buscarPorId);
router.post  ('/leads',                     autenticar, leadsCtrl.criar);
router.patch ('/leads/:id',                 autenticar, leadsCtrl.atualizar);
router.patch ('/leads/:id/mover',           autenticar, leadsCtrl.mover);
router.patch ('/leads/:id/transferir',      autenticar, exigirRole('GESTOR'), leadsCtrl.transferir);
router.delete('/leads/:id',                 autenticar, exigirRole('GESTOR'), leadsCtrl.deletar);
router.post  ('/leads/:id/mensagens',       autenticar, leadsCtrl.adicionarMensagem);
router.get   ('/leads/:id/historico',       autenticar, leadsCtrl.historico);

// ── Lead Produtos (múltiplos produtos por venda) ──────────────────────────────
router.get   ('/leads/:id/produtos',              autenticar, leadsCtrl.listarProdutosLead);
router.post  ('/leads/:id/produtos',              autenticar, leadsCtrl.adicionarProdutoLead);
router.patch ('/leads/:id/produtos/:itemId',      autenticar, leadsCtrl.atualizarProdutoLead);
router.delete('/leads/:id/produtos/:itemId',      autenticar, leadsCtrl.removerProdutoLead);

// ─────────────────────────────────────────────────────────────────────────────
// METAS
// ─────────────────────────────────────────────────────────────────────────────
router.get   ('/metas',              autenticar, metasCtrl.listar);
router.post  ('/metas',              autenticar, metasCtrl.criar);
router.post  ('/metas/:id/duplicar', autenticar, metasCtrl.duplicar);
router.patch ('/metas/:id',          autenticar, metasCtrl.atualizar);
router.delete('/metas/:id',          autenticar, metasCtrl.deletar);

// ─────────────────────────────────────────────────────────────────────────────
// COMISSÕES
// ─────────────────────────────────────────────────────────────────────────────
router.get   ('/comissoes/painel',            autenticar, comissoesCtrl.painel);
router.get   ('/comissoes/calcular',          autenticar, comissoesCtrl.calcular);
router.get   ('/comissoes/regras',            autenticar, comissoesCtrl.listarRegras);
router.post  ('/comissoes/regras',            autenticar, exigirSuperAdmin, comissoesCtrl.criarRegra);
router.patch ('/comissoes/regras/:id',        autenticar, exigirSuperAdmin, comissoesCtrl.atualizarRegra);
router.delete('/comissoes/regras/:id',        autenticar, exigirSuperAdmin, comissoesCtrl.deletarRegra);
router.patch ('/comissoes/salario/:id',       autenticar, exigirRole('GESTOR'), comissoesCtrl.atualizarSalario);
router.patch ('/comissoes/:id/status',        autenticar, comissoesCtrl.atualizarStatus);

// ─────────────────────────────────────────────────────────────────────────────
// WHATSAPP
// ─────────────────────────────────────────────────────────────────────────────
router.get   ('/whatsapp/integracao/status',          autenticar, exigirSuperAdmin, whatsappCtrl.statusIntegracao);

// ── Evolution API — gerenciamento de instância (SUPER_ADMIN) ─────────────────
router.get   ('/whatsapp/evolution/status',           autenticar, exigirSuperAdmin, whatsappCtrl.evoInstanciaStatus);
router.post  ('/whatsapp/evolution/criar',            autenticar, exigirSuperAdmin, whatsappCtrl.evoCriarInstancia);
router.get   ('/whatsapp/evolution/qrcode',           autenticar, exigirSuperAdmin, whatsappCtrl.evoQrCode);
router.delete('/whatsapp/evolution/desconectar',      autenticar, exigirSuperAdmin, whatsappCtrl.evoDesconectar);
router.delete('/whatsapp/evolution/deletar',          autenticar, exigirSuperAdmin, whatsappCtrl.evoDeletarInstancia);

router.get   ('/whatsapp/conversas',              autenticar, whatsappCtrl.listarConversas);
router.post  ('/whatsapp/conversas',              autenticar, whatsappCtrl.criarOuAbrirConversa);
router.get   ('/whatsapp/conversas/:id',          autenticar, whatsappCtrl.buscarConversa);
router.get   ('/whatsapp/conversas/:id/mensagens',autenticar, whatsappCtrl.listarMensagens);
router.post  ('/whatsapp/conversas/:id/mensagens',autenticar, whatsappCtrl.enviarMensagem);
router.patch ('/whatsapp/conversas/:id/status',   autenticar, whatsappCtrl.atualizarStatus);
router.get   ('/whatsapp/lead/:lead_id',          autenticar, whatsappCtrl.conversaPorLead);
router.get   ('/whatsapp/pendentes',              autenticar, whatsappCtrl.listarPendentes); // somente GESTOR+
router.post  ('/whatsapp/webhook/trafego',        whatsappCtrl.webhookTrafego); // sem auth (webhook externo)
// ── Webhook de recebimento WhatsApp Light (modo teste) ─────────────────────
// POST /api/whatsapp/webhook — sem JWT, protegido por WHATSAPP_WEBHOOK_SECRET
router.post  ('/whatsapp/webhook',                whatsappCtrl.webhookReceberMensagem);
// ── Ping de diagnóstico — confirma conectividade Evolution → CRM ───────────
router.post  ('/whatsapp/webhook-ping',           (req, res) => {
  console.log('WEBHOOK_PING_RECEBIDO:', JSON.stringify(req.body));
  return res.json({ ok: true, received: true, timestamp: new Date().toISOString() });
});


// ── WhatsApp Supabase — novos endpoints (tabela whatsapp_mensagens) ────────────
// IMPORTANTE: /conversas-sb antes de /conversas/:id para não colidir
router.get   ('/whatsapp/conversas-sb',           autenticar, whatsappCtrl.conversasSupabase);
router.get   ('/whatsapp/conversas-sb/:leadId',   autenticar, whatsappCtrl.conversasPorLeadSupabase);
router.post  ('/whatsapp/mensagens/manual',        autenticar, whatsappCtrl.mensagemManual);
router.get   ('/leads/:id/conversas',              autenticar, whatsappCtrl.conversasDoLead);

// ─────────────────────────────────────────────────────────────────────────────
// AUTOMAÇÕES DE MENSAGEM (SUPER_ADMIN)
// ─────────────────────────────────────────────────────────────────────────────
router.get   ('/automacoes/mensagens',              autenticar, automacoesCtrl.listar);
router.post  ('/automacoes/mensagens',              autenticar, automacoesCtrl.criar);
router.get   ('/automacoes/mensagens/:id/preview',  autenticar, automacoesCtrl.preview);
router.patch ('/automacoes/mensagens/:id',          autenticar, automacoesCtrl.editar);
router.delete('/automacoes/mensagens/:id',          autenticar, automacoesCtrl.deletar);

// ─────────────────────────────────────────────────────────────────────────────
// MENSAGENS PADRÃO (biblioteca de scripts)
// ─────────────────────────────────────────────────────────────────────────────
router.get   ('/mensagens-padrao/categorias',            autenticar, msgsPadraoCtrl.getCategorias);
router.get   ('/mensagens-padrao',                       autenticar, msgsPadraoCtrl.listar);
router.post  ('/mensagens-padrao',                       autenticar, msgsPadraoCtrl.criar);
router.post  ('/mensagens-padrao/reordenar',             autenticar, msgsPadraoCtrl.reordenar);
router.patch ('/mensagens-padrao/renomear-subcategoria', autenticar, msgsPadraoCtrl.renomearSubcategoria);
router.get   ('/mensagens-padrao/:id/preview',           autenticar, msgsPadraoCtrl.preview);
router.get   ('/mensagens-padrao/:id',                   autenticar, msgsPadraoCtrl.buscarPorId);
router.patch ('/mensagens-padrao/:id',                   autenticar, msgsPadraoCtrl.editar);
router.delete('/mensagens-padrao/:id',                   autenticar, msgsPadraoCtrl.deletar);

// ─────────────────────────────────────────────────────────────────────────────
// MOTIVOS DE PERDA
// ─────────────────────────────────────────────────────────────────────────────
router.get   ('/motivos-perda',        autenticar, motivosPerdaCtrl.listar);
router.post  ('/motivos-perda',        autenticar, exigirRole('GESTOR'), motivosPerdaCtrl.criar);
router.patch ('/motivos-perda/:id',    autenticar, exigirRole('GESTOR'), motivosPerdaCtrl.atualizar);
router.delete('/motivos-perda/:id',    autenticar, exigirRole('GESTOR'), motivosPerdaCtrl.deletar);

// ─────────────────────────────────────────────────────────────────────────────
// PRODUTOS
// ─────────────────────────────────────────────────────────────────────────────
router.get   ('/produtos',     autenticar, produtosCtrl.listar);
router.post  ('/produtos',     autenticar, produtosCtrl.criar);
router.patch ('/produtos/:id', autenticar, exigirRole('GESTOR'), produtosCtrl.atualizar);
router.delete('/produtos/:id', autenticar, exigirRole('GESTOR'), produtosCtrl.deletar);

// ─────────────────────────────────────────────────────────────────────────────
// AUDITORIA (GESTOR+)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/audit',                autenticar, exigirRole('GESTOR'), auditCtrl.listarAudit);

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN — LIXEIRA + RESTORE + BACKUP + STATS (SUPER_ADMIN)
// ─────────────────────────────────────────────────────────────────────────────
router.get ('/admin/stats',           autenticar, exigirSuperAdmin, auditCtrl.statsAudit);
router.get ('/admin/lixeira',         autenticar, exigirRole('GESTOR'), auditCtrl.listarLixeira);
router.post('/admin/restore',         autenticar, exigirSuperAdmin, auditCtrl.restore);
router.get ('/admin/backups',         autenticar, exigirSuperAdmin, backupCtrl.listar);
router.post('/admin/backups',         autenticar, exigirSuperAdmin, backupCtrl.executar);
router.get ('/admin/backups/:arquivo',autenticar, exigirSuperAdmin, backupCtrl.download);

// ─────────────────────────────────────────────────────────────────────────────
// HEALTH CHECK
// ─────────────────────────────────────────────────────────────────────────────
router.get('/health', (req, res) => {
  res.json({
    sucesso: true,
    sistema: 'PROSPERKT CRM',
    versao: '1.0.0',
    timestamp: new Date().toISOString(),
    status: 'online',
  });
});


module.exports = router;
