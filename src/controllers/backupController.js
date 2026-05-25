/**
 * PROSPERKT CRM — Backup Controller
 * Endpoints: listar, executar, download
 * Acesso restrito a SUPER_ADMIN
 */
const { executarBackup, listarBackupsLocais } = require('../services/backupService');
const { getProvider } = require('../database/dbProvider');
const path = require('path');
const fs   = require('fs');

// GET /api/admin/backups — lista backups locais e registro no banco
async function listar(req, res) {
  const { sb, isSupa } = getProvider();
  try {
    const locais = listarBackupsLocais();

    let registros = [];
    if (isSupa) {
      const { data } = await sb.from('backups').select('*').order('criado_em', { ascending: false }).limit(50);
      registros = data || [];
    }

    return res.json({ sucesso: true, backups_locais: locais, registros_banco: registros });
  } catch(e) {
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// POST /api/admin/backups — executa backup manual
async function executar(req, res) {
  const { tipo = 'diario' } = req.body;
  if (!['diario', 'semanal', 'mensal'].includes(tipo)) {
    return res.status(400).json({ sucesso: false, erro: 'tipo deve ser: diario, semanal ou mensal' });
  }
  try {
    const resultado = await executarBackup(tipo);
    return res.json(resultado);
  } catch(e) {
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// GET /api/admin/backups/:arquivo — download de um arquivo de backup
async function download(req, res) {
  const BACKUP_DIR = path.join(__dirname, '../../data/backups');
  const arquivo    = req.params.arquivo;

  // Segurança: não permite path traversal
  if (arquivo.includes('..') || arquivo.includes('/')) {
    return res.status(400).json({ sucesso: false, erro: 'Nome de arquivo inválido.' });
  }

  const filePath = path.join(BACKUP_DIR, arquivo);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ sucesso: false, erro: 'Arquivo não encontrado.' });
  }

  res.download(filePath, arquivo);
}

module.exports = { listar, executar, download };
