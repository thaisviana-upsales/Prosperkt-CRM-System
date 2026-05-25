/**
 * PROSPERKT CRM — Backup Service
 * Backup diário/semanal/mensal via exportação JSON do Supabase.
 * Mantém: 7 diários, 4 semanais, 12 mensais.
 */
const crypto = require('crypto');
const path   = require('path');
const fs     = require('fs');
const { getProvider, MODE } = require('../database/dbProvider');

const BACKUP_DIR = path.join(__dirname, '../../data/backups');

// Tabelas incluídas no backup
const TABELAS = [
  'usuarios', 'funis', 'pipelines', 'etapas',
  'leads', 'produtos', 'logs', 'audit_logs',
  'motivos_perda', 'metas', 'conversas',
];

// Garante que o diretório de backups existe
function garantirDiretorio() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

// Helper seguro para queries Supabase (não usa .catch — usa try/catch)
async function sbQuery(fn) {
  try { return await fn(); } catch(e) { return { data: null, error: e }; }
}

// Exporta todas as tabelas do Supabase como JSON
async function exportarSupabase(sb) {
  const dump = { exportado_em: new Date().toISOString(), tabelas: {} };
  for (const tabela of TABELAS) {
    const { data, error } = await sbQuery(() => sb.from(tabela).select('*'));
    dump.tabelas[tabela] = error ? { erro: error.message } : (data || []);
  }
  return dump;
}

// Limita backups por tipo: remove mais antigos além do limite
function limparBackupsAntigos(tipo, limite) {
  garantirDiretorio();
  const arquivos = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith(`backup-${tipo}-`) && f.endsWith('.json'))
    .map(f => ({ nome: f, mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtime }))
    .sort((a, b) => b.mtime - a.mtime);

  for (let i = limite; i < arquivos.length; i++) {
    try { fs.unlinkSync(path.join(BACKUP_DIR, arquivos[i].nome)); } catch(e) {}
  }
}

// Executa backup de um tipo específico
async function executarBackup(tipo = 'diario') {
  const limites = { diario: 7, semanal: 4, mensal: 12 };
  const limite  = limites[tipo] || 7;
  const { sb, isSupa } = getProvider();

  garantirDiretorio();

  const id        = crypto.randomBytes(8).toString('hex');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const arquivo   = path.join(BACKUP_DIR, `backup-${tipo}-${timestamp}.json`);

  // Registra início do backup na tabela backups (silencioso se não existir)
  if (isSupa) {
    await sbQuery(() => sb.from('backups').insert({
      id, tipo, status: 'pendente', arquivo, tabelas: TABELAS,
      criado_em: new Date().toISOString(),
    }));
  }

  try {
    let conteudo, tamanhoKb;

    if (isSupa) {
      const dump = await exportarSupabase(sb);
      conteudo = JSON.stringify(dump, null, 2);
    } else {
      // SQLite: exporta o arquivo do banco
      const dbPath = require('path').join(__dirname, '../../data/prosperkt.db');
      if (fs.existsSync(dbPath)) {
        const destDb = arquivo.replace('.json', '.db');
        fs.copyFileSync(dbPath, destDb);
        conteudo = JSON.stringify({ tipo: 'sqlite', arquivo_original: dbPath, exportado_em: new Date().toISOString() });
      } else {
        conteudo = JSON.stringify({ aviso: 'Banco SQLite não encontrado.', exportado_em: new Date().toISOString() });
      }
    }

    fs.writeFileSync(arquivo, conteudo, 'utf8');
    tamanhoKb = Math.round(Buffer.byteLength(conteudo, 'utf8') / 1024);
    limparBackupsAntigos(tipo, limite);

    if (isSupa) {
      await sbQuery(() => sb.from('backups').update({
        status: 'concluido',
        tamanho_kb: tamanhoKb,
        concluido_em: new Date().toISOString(),
      }).eq('id', id));
    }

    console.log(`[Backup] ${tipo} concluído: ${path.basename(arquivo)} (${tamanhoKb} KB)`);
    return { sucesso: true, id, tipo, arquivo: path.basename(arquivo), tamanho_kb: tamanhoKb };

  } catch(e) {
    console.error(`[Backup] Erro no backup ${tipo}:`, e.message);
    if (isSupa) {
      await sbQuery(() => sb.from('backups').update({ status: 'erro', erro: e.message }).eq('id', id));
    }
    return { sucesso: false, erro: e.message };
  }
}

// Lista backups locais
function listarBackupsLocais() {
  garantirDiretorio();
  return fs.readdirSync(BACKUP_DIR)
    .filter(f => f.endsWith('.json') || f.endsWith('.db'))
    .map(f => {
      const stat = fs.statSync(path.join(BACKUP_DIR, f));
      const tipo = f.includes('-diario-') ? 'diario'
                 : f.includes('-semanal-') ? 'semanal'
                 : f.includes('-mensal-') ? 'mensal' : 'outro';
      return { arquivo: f, tipo, tamanho_kb: Math.round(stat.size / 1024), criado_em: stat.mtime.toISOString() };
    })
    .sort((a, b) => new Date(b.criado_em) - new Date(a.criado_em));
}

// Agendador de backup automático
function agendarBackups() {
  const agora = new Date();

  // Verifica se há backup diário recente (< 23h)
  const ultimoDiario = listarBackupsLocais().find(b => b.tipo === 'diario');
  const deveBackupDiario = !ultimoDiario ||
    (Date.now() - new Date(ultimoDiario.criado_em).getTime()) > 23 * 60 * 60 * 1000;

  if (deveBackupDiario) {
    // Backup inicial com delay para o servidor estabilizar
    setTimeout(() => executarBackup('diario').catch(e => console.error('[Backup]', e.message)), 10000);
  }

  // Calcula ms até às 3h do próximo dia
  const msAte3h = (() => {
    const alvo = new Date(); alvo.setHours(3, 0, 0, 0);
    if (alvo <= agora) alvo.setDate(alvo.getDate() + 1);
    return alvo - agora;
  })();

  // Agenda o primeiro intervalo exato às 3h, depois a cada 24h
  setTimeout(() => {
    executarBackup('diario').catch(() => {});
    setInterval(() => executarBackup('diario').catch(() => {}), 24 * 60 * 60 * 1000);
    setInterval(() => { if (new Date().getDay() === 1) executarBackup('semanal').catch(() => {}); }, 24 * 60 * 60 * 1000);
    setInterval(() => { if (new Date().getDate() === 1) executarBackup('mensal').catch(() => {}); }, 24 * 60 * 60 * 1000);
  }, msAte3h);

  console.log('[Backup] Agendador iniciado. Próximo diário em ~', Math.round(msAte3h / 60000), 'min');
}

module.exports = { executarBackup, listarBackupsLocais, agendarBackups };
