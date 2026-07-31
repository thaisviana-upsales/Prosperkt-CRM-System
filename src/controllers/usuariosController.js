/**
 * PROSPEKT CRM — Users Controller
 * CRUD de usuários com permissões RBAC reais.
 * Supabase JS nativo ou SQLite conforme DATABASE_PROVIDER.
 */

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { getProvider } = require('../database/dbProvider');
const { registrarLog } = require('../services/auditService');

const CAMPOS_PUBLICOS_SUPA = 'id, nome, email, role, ativo, avatar_url, criado_em, atualizado_em, sdr_padrao, recebe_leads_automaticos';


// GET /api/usuarios
// SUPER_ADMIN / GESTOR: todos; VENDEDOR: apenas ele mesmo
// ───────────────────────────────────────────────────────────────────────────────
async function listar(req, res) {
  const { sb, isSupa, sqlite } = getProvider();

  // Por padrão, mostra apenas usuários ativos.
  // SUPER_ADMIN pode passar ?incluir_inativos=true para ver todos (tela de gerenciamento).
  const incluirInativos = req.query.incluir_inativos === 'true'
    && req.usuario.role === 'SUPER_ADMIN';

  try {
    if (isSupa) {
      // ── Busca todos e filtra ativo no Node (robustez boolean/integer) ────────
      // Supabase pode armazenar ativo como boolean true ou integer 1.
      // .eq('ativo', true) retorna [] quando o campo é integer — bug conhecido.
      // Fix: busca sem filtro de ativo e filtra no Node-side.
      let q = sb.from('usuarios').select(CAMPOS_PUBLICOS_SUPA).order('nome');
      if (req.usuario.role === 'VENDEDOR') {
        q = q.eq('id', req.usuario.id);
      }
      const { data: rawData, error } = await q;
      if (error) throw error;

      let data = rawData || [];
      if (req.usuario.role !== 'VENDEDOR' && !incluirInativos) {
        // Aceita boolean true, integer 1 ou string '1'
        data = data.filter(u => u.ativo === true || u.ativo === 1 || u.ativo === '1');
      }

      console.log('[FILTRO_VENDEDOR_LOAD] usuarios.listar | role:', req.usuario?.role, '| total:', (rawData||[]).length, '| ativos:', data.length);
      return res.json({ sucesso: true, dados: data, total: data.length });
    }

    // SQLite
    const { getDb } = require('../database/db');
    const db = getDb();
    const campos = 'id, nome, email, role, ativo, avatar_url, criado_em, atualizado_em';
    let usuarios;
    if (req.usuario.role === 'VENDEDOR') {
      usuarios = db.prepare(`SELECT ${campos} FROM usuarios WHERE id = ?`).all(req.usuario.id);
    } else if (incluirInativos) {
      usuarios = db.prepare(`SELECT ${campos} FROM usuarios ORDER BY nome`).all();
    } else {
      usuarios = db.prepare(`SELECT ${campos} FROM usuarios WHERE ativo = 1 ORDER BY nome`).all();
    }
    console.log('[FILTRO_VENDEDOR_LOAD] usuarios.listar SQLite | role:', req.usuario?.role, '| encontrados:', usuarios.length);
    return res.json({ sucesso: true, dados: usuarios, total: usuarios.length });
  } catch (e) {
    console.error('[usuarios.listar]', e.message);
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/usuarios/responsaveis
// Retorna usuários ativos que podem ser responsáveis por leads.
// VENDEDOR: vê apenas VENDEDOR, SDR e SUPER_ADMIN
// GESTOR/SUPER_ADMIN: vê VENDEDOR, SDR, GESTOR, CLOSER e SUPER_ADMIN
// ───────────────────────────────────────────────────────────────────────────────
async function listarResponsaveis(req, res) {
  const { sb, isSupa, sqlite } = getProvider();

  // Todos os papéis comerciais que podem ser responsáveis por leads
  const ROLES_VALIDAS = req.usuario?.role === 'VENDEDOR'
    ? ['VENDEDOR', 'SDR', 'SUPER_ADMIN']
    : ['VENDEDOR', 'SDR', 'GESTOR', 'CLOSER', 'COMERCIAL', 'SUPER_ADMIN'];

  console.log('[FILTRO_VENDEDOR_LOAD_START] listarResponsaveis | role solicitante:', req.usuario?.role, '| roles vistas:', ROLES_VALIDAS);

  try {
    if (isSupa) {
      // Tenta 1: busca apenas ativos com roles válidas
      const { data: tentativa1, error: e1 } = await sb
        .from('usuarios')
        .select(CAMPOS_PUBLICOS_SUPA)
        .eq('ativo', true)
        .in('role', ROLES_VALIDAS)
        .order('nome');

      if (!e1 && (tentativa1 || []).length > 0) {
        console.log('[FILTRO_VENDEDOR_USUARIOS_TOTAL_API] tentativa1 (ativo=true + roles):', tentativa1.length);
        return res.json({ sucesso: true, dados: tentativa1, total: tentativa1.length });
      }

      if (e1) console.warn('[listarResponsaveis] tentativa1 error:', e1.message);

      // Tenta 2: busca todos sem filtro de ativo e filtra no Node
      // (resolve casos onde ativo é integer 1/0 em vez de boolean no Supabase)
      console.warn('[FILTRO_VENDEDOR_LOAD_START] tentativa1 vazia — buscando todos e filtrando no Node...');
      const { data: todos, error: e2 } = await sb
        .from('usuarios')
        .select(CAMPOS_PUBLICOS_SUPA)
        .in('role', ROLES_VALIDAS)
        .order('nome');

      if (e2) throw e2;

      const raw = todos || [];
      console.log('[FILTRO_VENDEDOR_USUARIOS_TOTAL_API] tentativa2 (todos com roles válidas):', raw.length);

      const ativos = [];
      const descartados = [];
      raw.forEach(u => {
        const isAtivo = u.ativo === true || u.ativo === 1 || u.ativo === '1' || u.ativo === 'true';
        if (isAtivo) {
          ativos.push(u);
        } else {
          descartados.push({ nome: u.nome, role: u.role, ativo: u.ativo });
        }
      });

      console.log('[FILTRO_VENDEDOR_USUARIOS_ATIVOS_TOTAL]', ativos.length, 'ativos para o select');
      if (descartados.length > 0) {
        console.log('[FILTRO_VENDEDOR_USUARIO_DESCARTADO_INATIVO]', JSON.stringify(descartados));
      }

      return res.json({ sucesso: true, dados: ativos, total: ativos.length });
    }

    // SQLite — filtra ativo=1 e role VENDEDOR ou SUPER_ADMIN
    const { getDb } = require('../database/db');
    const db = getDb();
    const placeholders = ROLES_VALIDAS.map(() => '?').join(',');
    const ativos = db.prepare(`
      SELECT id, nome, email, role, ativo, avatar_url, criado_em, atualizado_em
      FROM usuarios
      WHERE ativo = 1 AND role IN (${placeholders})
      ORDER BY nome
    `).all(...ROLES_VALIDAS);

    console.log('[FILTRO_VENDEDOR_USUARIOS_ATIVOS_TOTAL] SQLite:', ativos.length);
    return res.json({ sucesso: true, dados: ativos, total: ativos.length });

  } catch (e) {
    console.error('[usuarios.listarResponsaveis]', e.message);
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/usuarios/:id
// ─────────────────────────────────────────────────────────────────────────────
async function buscarPorId(req, res) {
  const { sb, isSupa } = getProvider();
  const { id } = req.params;
  if (req.usuario.role === 'VENDEDOR' && id !== req.usuario.id) {
    return res.status(403).json({ sucesso: false, erro: 'Acesso negado.' });
  }
  try {
    if (isSupa) {
      const { data, error } = await sb.from('usuarios').select(CAMPOS_PUBLICOS_SUPA).eq('id', id).single();
      if (error || !data) return res.status(404).json({ sucesso: false, erro: 'Usuário não encontrado.' });
      return res.json({ sucesso: true, dados: data });
    }
    const { getDb } = require('../database/db');
    const db = getDb();
    const usuario = db.prepare('SELECT id,nome,email,role,ativo,avatar_url,criado_em,atualizado_em FROM usuarios WHERE id = ?').get(id);
    if (!usuario) return res.status(404).json({ sucesso: false, erro: 'Usuário não encontrado.' });
    return res.json({ sucesso: true, dados: usuario });
  } catch (e) {
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/usuarios — Somente SUPER_ADMIN e GESTOR
// ─────────────────────────────────────────────────────────────────────────────
async function criar(req, res) {
  const { sb, isSupa } = getProvider();
  const { nome, email, senha, role = 'VENDEDOR' } = req.body;

  if (!nome || !email || !senha) {
    return res.status(400).json({ sucesso: false, erro: 'nome, email e senha são obrigatórios.' });
  }
  if (req.usuario.role === 'GESTOR' && role === 'SUPER_ADMIN') {
    return res.status(403).json({ sucesso: false, erro: 'GESTOR não pode criar SUPER_ADMIN.' });
  }
  const roles = ['SUPER_ADMIN', 'GESTOR', 'VENDEDOR', 'SDR'];
  if (!roles.includes(role)) {
    return res.status(400).json({ sucesso: false, erro: `Role inválida. Use: ${roles.join(', ')}` });
  }

  const emailNorm = email.toLowerCase().trim();
  const id = crypto.randomBytes(16).toString('hex');
  const hash = await bcrypt.hash(senha, 12);

  try {
    if (isSupa) {
      // Verifica email duplicado
      const { data: dup } = await sb.from('usuarios').select('id').eq('email', emailNorm).limit(1);
      if (dup?.length) return res.status(409).json({ sucesso: false, erro: 'Email já está em uso.' });

      const insertData = {
        id, nome: nome.trim(), email: emailNorm, senha_hash: hash, role, ativo: 1,
        criado_em: new Date().toISOString(), atualizado_em: new Date().toISOString(),
      };
      if (role === 'SDR') {
        insertData.recebe_leads_automaticos = req.body.recebe_leads_automaticos === true || req.body.recebe_leads_automaticos === 1 || true; // SDR recebe por padrão
        insertData.sdr_padrao = req.body.sdr_padrao === true || req.body.sdr_padrao === 1;
        console.log('[USER_CREATE_SDR_ACCEPTED] nome:', nome.trim(), '| sdr_padrao:', insertData.sdr_padrao);
      }
      const { data, error } = await sb.from('usuarios').insert(insertData).select(CAMPOS_PUBLICOS_SUPA).single();
      if (error) throw error;
      req.log({ acao: 'CREATE', entidade: 'usuarios', entidade_id: id, depois: { nome, email: emailNorm, role } });
      return res.status(201).json({ sucesso: true, dados: data });
    }

    // SQLite
    const { getDb } = require('../database/db');
    const db = getDb();
    const existente = db.prepare('SELECT id FROM usuarios WHERE email = ?').get(emailNorm);
    if (existente) return res.status(409).json({ sucesso: false, erro: 'Email já está em uso.' });
    db.prepare('INSERT INTO usuarios (id, nome, email, senha_hash, role) VALUES (?, ?, ?, ?, ?)').run(id, nome.trim(), emailNorm, hash, role);
    const criado = db.prepare('SELECT id,nome,email,role,ativo,avatar_url,criado_em,atualizado_em FROM usuarios WHERE id = ?').get(id);
    req.log({ acao: 'CREATE', entidade: 'usuarios', entidade_id: id, depois: { nome, email: emailNorm, role } });
    return res.status(201).json({ sucesso: true, dados: criado });
  } catch (e) {
    console.error('[usuarios.criar]', e.message);
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/usuarios/:id
// ─────────────────────────────────────────────────────────────────────────────
async function atualizar(req, res) {
  const { sb, isSupa } = getProvider();
  const { id } = req.params;
  const { role: roleAtual, id: meId } = req.usuario;

  if (roleAtual === 'VENDEDOR' && id !== meId) {
    return res.status(403).json({ sucesso: false, erro: 'Acesso negado.' });
  }

  try {
    if (isSupa) {
      const { data: atual, error: e0 } = await sb.from('usuarios').select('*').eq('id', id).single();
      if (e0 || !atual) return res.status(404).json({ sucesso: false, erro: 'Usuário não encontrado.' });

      const upd = { atualizado_em: new Date().toISOString() };
      if (req.body.nome)  upd.nome  = req.body.nome.trim();
      if (req.body.email) upd.email = req.body.email.toLowerCase().trim();
      if (req.body.avatar_url !== undefined) upd.avatar_url = req.body.avatar_url;
      if (req.body.role && roleAtual === 'SUPER_ADMIN') upd.role = req.body.role;
      if (req.body.ativo !== undefined && roleAtual !== 'VENDEDOR') {
        // Campo ativo no Supabase é INTEGER (1/0), não boolean.
        // Enviar boolean false causa: "invalid input syntax for type integer: 'false'"
        const ativoVal = req.body.ativo === true || req.body.ativo === 1 || req.body.ativo === '1';
        upd.ativo = ativoVal ? 1 : 0;
      }
      if (req.body.senha) upd.senha_hash = await bcrypt.hash(req.body.senha, 12);
      // sdr_padrao: somente SUPER_ADMIN pode marcar/desmarcar
      if (req.body.sdr_padrao !== undefined && roleAtual === 'SUPER_ADMIN') {
        upd.sdr_padrao = req.body.sdr_padrao === true || req.body.sdr_padrao === 1;
      }
      // recebe_leads_automaticos: SUPER_ADMIN e GESTOR podem configurar
      if (req.body.recebe_leads_automaticos !== undefined && (roleAtual === 'SUPER_ADMIN' || roleAtual === 'GESTOR')) {
        upd.recebe_leads_automaticos = req.body.recebe_leads_automaticos === true || req.body.recebe_leads_automaticos === 1;
      }
      // Log específico para SDR
      if (upd.role === 'SDR' || atual.role === 'SDR') {
        console.log('[USER_UPDATE_SDR_ACCEPTED] id:', id, '| sdr_padrao:', upd.sdr_padrao, '| recebe_leads:', upd.recebe_leads_automaticos);
      }

      if (Object.keys(upd).length === 1) {
        return res.status(400).json({ sucesso: false, erro: 'Nenhum campo para atualizar.' });
      }

      const { data, error } = await sb.from('usuarios').update(upd).eq('id', id).select(CAMPOS_PUBLICOS_SUPA).single();
      if (error) throw error;
      req.log({ acao: 'UPDATE', entidade: 'usuarios', entidade_id: id, depois: upd });
      return res.json({ sucesso: true, dados: data });
    }

    // SQLite
    const { getDb } = require('../database/db');
    const db = getDb();
    const atual = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
    if (!atual) return res.status(404).json({ sucesso: false, erro: 'Usuário não encontrado.' });

    const campos = {};
    if (req.body.nome)  campos.nome  = req.body.nome.trim();
    if (req.body.email) campos.email = req.body.email.toLowerCase().trim();
    if (req.body.avatar_url !== undefined) campos.avatar_url = req.body.avatar_url;
    if (req.body.role && roleAtual === 'SUPER_ADMIN') campos.role = req.body.role;
    if (req.body.ativo !== undefined && roleAtual !== 'VENDEDOR') campos.ativo = req.body.ativo ? 1 : 0;
    if (req.body.senha) campos.senha_hash = await bcrypt.hash(req.body.senha, 12);
    if (Object.keys(campos).length === 0) return res.status(400).json({ sucesso: false, erro: 'Nenhum campo para atualizar.' });

    campos.atualizado_em = new Date().toISOString();
    const sets = Object.keys(campos).map(k => `${k} = ?`).join(', ');
    db.prepare(`UPDATE usuarios SET ${sets} WHERE id = ?`).run(...Object.values(campos), id);
    const atualizado = db.prepare('SELECT id,nome,email,role,ativo,avatar_url,criado_em,atualizado_em FROM usuarios WHERE id = ?').get(id);
    req.log({ acao: 'UPDATE', entidade: 'usuarios', entidade_id: id, depois: atualizado });
    return res.json({ sucesso: true, dados: atualizado });
  } catch (e) {
    console.error('[usuarios.atualizar]', e.message);
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/usuarios/:id — Somente SUPER_ADMIN (soft delete)
// ─────────────────────────────────────────────────────────────────────────────
async function deletar(req, res) {
  const { sb, isSupa } = getProvider();
  const { id } = req.params;
  if (id === req.usuario.id) {
    return res.status(400).json({ sucesso: false, erro: 'Você não pode desativar sua própria conta.' });
  }
  try {
    if (isSupa) {
      const { data: u, error: e0 } = await sb.from('usuarios').select('id,nome').eq('id', id).single();
      if (e0 || !u) return res.status(404).json({ sucesso: false, erro: 'Usuário não encontrado.' });
      // Campo ativo é INTEGER no Supabase — enviar 0 (não false/boolean)
      const { error: eUpd } = await sb
        .from('usuarios')
        .update({ ativo: 0, atualizado_em: new Date().toISOString() })
        .eq('id', id);
      if (eUpd) {
        console.error('[usuarios.deletar] Supabase update error:', eUpd.message);
        return res.status(500).json({ sucesso: false, erro: 'Falha ao desativar no banco: ' + eUpd.message });
      }
      req.log({ acao: 'DELETE', entidade: 'usuarios', entidade_id: id, antes: u });
      return res.json({ sucesso: true, mensagem: 'Usuário desativado com sucesso.' });
    }
    const { getDb } = require('../database/db');
    const db = getDb();
    const usuario = db.prepare('SELECT id,nome FROM usuarios WHERE id = ?').get(id);
    if (!usuario) return res.status(404).json({ sucesso: false, erro: 'Usuário não encontrado.' });
    db.prepare('UPDATE usuarios SET ativo = 0, atualizado_em = ? WHERE id = ?').run(new Date().toISOString(), id);
    req.log({ acao: 'DELETE', entidade: 'usuarios', entidade_id: id, antes: usuario });
    return res.json({ sucesso: true, mensagem: 'Usuário desativado com sucesso.' });
  } catch (e) {
    console.error('[usuarios.deletar]', e.message);
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/usuarios/:id/avatar — salva avatar como data URL
// ─────────────────────────────────────────────────────────────────────────────
async function uploadAvatar(req, res) {
  const { sb, isSupa } = getProvider();
  const { id } = req.params;
  const { role: roleAtual, id: meId } = req.usuario;

  // Vendedor só pode atualizar o próprio avatar
  if (roleAtual === 'VENDEDOR' && id !== meId) {
    return res.status(403).json({ sucesso: false, erro: 'Acesso negado.' });
  }

  const { avatar_url } = req.body;
  if (!avatar_url) {
    return res.status(400).json({ sucesso: false, erro: 'Campo avatar_url é obrigatório.' });
  }

  // Valida formato: aceita data:image/... ou URL externa
  const isDataUrl = avatar_url.startsWith('data:image/');
  const isUrl = avatar_url.startsWith('http://') || avatar_url.startsWith('https://');
  const isEmpty = avatar_url === '';
  if (!isDataUrl && !isUrl && !isEmpty) {
    return res.status(400).json({ sucesso: false, erro: 'Formato de imagem inválido. Use JPG, PNG ou WEBP.' });
  }

  // Limita tamanho: data URL de 2MB ≈ ~2.7MB em base64
  if (avatar_url.length > 3_000_000) {
    return res.status(413).json({ sucesso: false, erro: 'Imagem muito grande. Máximo 2MB.' });
  }

  try {
    if (isSupa) {
      const { data, error } = await sb.from('usuarios')
        .update({ avatar_url: avatar_url || null, atualizado_em: new Date().toISOString() })
        .eq('id', id)
        .select(CAMPOS_PUBLICOS_SUPA)
        .single();
      if (error) throw error;
      return res.json({ sucesso: true, dados: data });
    }
    const { getDb } = require('../database/db');
    const db = getDb();
    db.prepare('UPDATE usuarios SET avatar_url = ?, atualizado_em = ? WHERE id = ?')
      .run(avatar_url || null, new Date().toISOString(), id);
    const atualizado = db.prepare('SELECT id,nome,email,role,ativo,avatar_url,criado_em,atualizado_em FROM usuarios WHERE id = ?').get(id);
    return res.json({ sucesso: true, dados: atualizado });
  } catch (e) {
    console.error('[usuarios.uploadAvatar]', e.message);
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

module.exports = { listar, listarResponsaveis, buscarPorId, criar, atualizar, deletar, uploadAvatar };


