/**
 * PROSPERKT CRM — Comissões Controller
 * Calcula comissões em tempo real baseado nas vendas do CRM
 */
const crypto = require('crypto');
const { getDb } = require('../database/db');

// GET /api/comissoes/painel  — Painel detalhado por vendedor
function painel(req, res) {
  const db = getDb();
  const { mes, funil_id, usuario_id } = req.query;
  const hoje = new Date();
  const anoMes = mes || `${hoje.getFullYear()}-${String(hoje.getMonth()+1).padStart(2,'0')}`;
  const mesNum = parseInt(anoMes.split('-')[1]);
  const anoNum = parseInt(anoMes.split('-')[0]);

  const params = [anoMes];
  let filtroUser = '';
  if (req.usuario.role === 'VENDEDOR') { filtroUser = ' AND c.usuario_id=?'; params.push(req.usuario.id); }
  else if (usuario_id) { filtroUser = ' AND c.usuario_id=?'; params.push(usuario_id); }

  // Comissões reais registradas
  const comissoes = db.prepare(`
    SELECT c.*, u.nome as vendedor_nome, u.salario_fixo,
      l.nome as lead_nome, l.empresa, l.valor as lead_valor,
      f.nome as funil_nome
    FROM comissoes c
    LEFT JOIN usuarios u ON c.usuario_id=u.id
    LEFT JOIN leads l ON c.lead_id=l.id
    LEFT JOIN pipelines p ON l.pipeline_id=p.id
    LEFT JOIN funis f ON p.funil_id=f.id
    WHERE c.periodo_ref=?${filtroUser}
    ${funil_id ? 'AND p.funil_id=?' : ''}
    ORDER BY c.criado_em DESC
  `).all(...params, ...(funil_id ? [funil_id] : []));

  // Regras de comissão ativas (para bonus)
  const todasRegras = db.prepare('SELECT * FROM comissao_regras WHERE ativo=1').all();

  // Agrupa por vendedor
  const porVendedor = {};
  comissoes.forEach(c => {
    if (!porVendedor[c.usuario_id]) {
      porVendedor[c.usuario_id] = {
        usuario_id: c.usuario_id,
        vendedor_nome: c.vendedor_nome,
        salario_fixo: c.salario_fixo || 0,
        total_vendido:0, total_comissao:0, qtd_vendas:0,
        comissao_pendente:0, comissao_aprovada:0, comissao_paga:0,
        items:[]
      };
    }
    const v = porVendedor[c.usuario_id];
    v.total_vendido  += c.valor_venda  || 0;
    v.total_comissao += c.valor_comissao || 0;
    v.qtd_vendas++;
    if (c.status==='PENDENTE')  v.comissao_pendente  += c.valor_comissao || 0;
    if (c.status==='APROVADA')  v.comissao_aprovada  += c.valor_comissao || 0;
    if (c.status==='PAGA')      v.comissao_paga      += c.valor_comissao || 0;
    v.items.push(c);
  });

  // Calcula bonus e total_a_receber por vendedor
  Object.values(porVendedor).forEach(v => {
    // Verifica se atingiu meta de faturamento no período
    const metaFat = db.prepare(`
      SELECT * FROM metas
      WHERE ativo=1 AND tipo='FATURAMENTO'
        AND (usuario_id=? OR usuario_id IS NULL)
        AND mes=? AND ano=?
      ORDER BY usuario_id DESC LIMIT 1
    `).get(v.usuario_id, mesNum, anoNum);

    const metaAtingida = metaFat && v.total_vendido >= metaFat.valor_alvo;
    const regrasBonus = todasRegras.filter(r =>
      (r.bonus_meta_pct||0) > 0 &&
      (!r.usuario_id || r.usuario_id === v.usuario_id)
    );
    v.bonus_a_receber = (metaAtingida && regrasBonus.length) ? regrasBonus[0].bonus_meta_pct : 0;
    v.meta_atingida   = metaAtingida || false;
    v.total_a_receber = v.total_comissao + v.bonus_a_receber + v.salario_fixo;
  });

  const ranking = Object.values(porVendedor).sort((a,b) => b.total_comissao - a.total_comissao);

  // Totais consolidados
  const totais = {
    total_vendido:    ranking.reduce((s,v)=>s+v.total_vendido,0),
    total_comissao:   ranking.reduce((s,v)=>s+v.total_comissao,0),
    total_pendente:   ranking.reduce((s,v)=>s+v.comissao_pendente,0),
    total_pago:       ranking.reduce((s,v)=>s+v.comissao_paga,0),
    qtd_vendas:       ranking.reduce((s,v)=>s+v.qtd_vendas,0),
    bonus_total:      ranking.reduce((s,v)=>s+v.bonus_a_receber,0),
    salario_total:    ranking.reduce((s,v)=>s+v.salario_fixo,0),
    total_a_receber:  ranking.reduce((s,v)=>s+v.total_a_receber,0),
  };

  // Por funil (para admin)
  const porFunil = db.prepare(`
    SELECT f.nome as funil_nome, COUNT(*) as qtd,
      SUM(c.valor_venda) as total_vendido, SUM(c.valor_comissao) as total_comissao
    FROM comissoes c
    LEFT JOIN leads l ON c.lead_id=l.id
    LEFT JOIN pipelines p ON l.pipeline_id=p.id
    LEFT JOIN funis f ON p.funil_id=f.id
    WHERE c.periodo_ref=?${funil_id ? ' AND p.funil_id=?' : ''}
    GROUP BY p.funil_id, f.nome ORDER BY total_comissao DESC
  `).all(anoMes, ...(funil_id ? [funil_id] : []));

  return res.json({ sucesso:true, dados:{ ranking, totais, por_funil:porFunil, mes:anoMes } });
}

// PATCH /api/comissoes/salario/:id  — Atualiza salário fixo do vendedor
function atualizarSalario(req, res) {
  const db = getDb();
  const { salario_fixo } = req.body;
  if (salario_fixo === undefined || isNaN(Number(salario_fixo)))
    return res.status(400).json({ sucesso:false, erro:'salario_fixo inválido.' });
  const usuario = db.prepare('SELECT id, nome FROM usuarios WHERE id=?').get(req.params.id);
  if (!usuario) return res.status(404).json({ sucesso:false, erro:'Usuário não encontrado.' });
  db.prepare('UPDATE usuarios SET salario_fixo=?, atualizado_em=? WHERE id=?')
    .run(Number(salario_fixo), new Date().toISOString(), req.params.id);
  req.log({ acao:'UPDATE', entidade:'usuarios', entidade_id:req.params.id, depois:{ salario_fixo } });
  return res.json({ sucesso:true, dados:{ salario_fixo: Number(salario_fixo) } });
}



// PATCH /api/comissoes/:id/status  — Aprovar/Pagar comissão
function atualizarStatus(req, res) {
  if (!['SUPER_ADMIN','GESTOR'].includes(req.usuario.role))
    return res.status(403).json({ sucesso:false, erro:'Acesso negado.' });
  const db = getDb();
  const { status } = req.body;
  const validos = ['PENDENTE','APROVADA','PAGA','CANCELADA'];
  if (!validos.includes(status)) return res.status(400).json({ sucesso:false, erro:'Status inválido.' });
  const atual = db.prepare('SELECT * FROM comissoes WHERE id=?').get(req.params.id);
  if (!atual) return res.status(404).json({ sucesso:false, erro:'Comissão não encontrada.' });
  db.prepare('UPDATE comissoes SET status=?,atualizado_em=? WHERE id=?')
    .run(status, new Date().toISOString(), req.params.id);
  req.log({ acao:'UPDATE_STATUS', entidade:'comissoes', entidade_id:req.params.id, antes:{ status:atual.status }, depois:{ status } });
  return res.json({ sucesso:true });
}

// Aplica regras de faixas de comissão sobre um valor de venda
function calcularComissaoFaixas(valorVenda, regras) {
  if (!regras?.length) return 0;
  // Regras ordenadas por valor_min crescente
  const faixas = [...regras].sort((a,b) => (a.valor_min||0)-(b.valor_min||0));
  let regra = faixas[0];
  for (const f of faixas) {
    if (valorVenda >= (f.valor_min||0)) regra = f;
  }
  if (!regra) return 0;
  if (regra.tipo_calculo === 'PERCENTUAL') return valorVenda * (regra.percentual||0) / 100;
  if (regra.tipo_calculo === 'FIXO') return regra.valor_fixo || 0;
  return 0;
}

// GET /api/comissoes/regras  — Lista regras de comissão
function listarRegras(req, res) {
  const db = getDb();
  const rows = db.prepare(`SELECT r.*, u.nome as usuario_nome, f.nome as funil_nome
    FROM comissao_regras r
    LEFT JOIN usuarios u ON r.usuario_id=u.id
    LEFT JOIN funis f ON r.funil_id=f.id
    ORDER BY r.criado_em DESC`).all();
  return res.json({ sucesso:true, dados:rows });
}

// POST /api/comissoes/regras  — Cria regra
function criarRegra(req, res) {
  if (req.usuario.role !== 'SUPER_ADMIN') return res.status(403).json({ sucesso:false, erro:'Acesso negado.' });
  const db = getDb();
  const { nome, usuario_id, funil_id, tipo_calculo, percentual, valor_fixo, valor_min, valor_max, bonus_meta_valor } = req.body;
  if (!nome || !tipo_calculo) return res.status(400).json({ sucesso:false, erro:'nome e tipo_calculo obrigatórios.' });
  const id = crypto.randomBytes(16).toString('hex');
  db.prepare(`INSERT INTO comissao_regras
    (id,nome,usuario_id,funil_id,tipo_calculo,percentual,valor_fixo,valor_min,valor_max,bonus_meta_pct,criado_por)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(id, nome, usuario_id||null, funil_id||null,
    tipo_calculo, percentual||0, valor_fixo||0, valor_min||0, valor_max||null, bonus_meta_valor||0, req.usuario.id);
  req.log({ acao:'CREATE', entidade:'comissao_regras', entidade_id:id, depois:req.body });
  return res.status(201).json({ sucesso:true, dados: db.prepare('SELECT * FROM comissao_regras WHERE id=?').get(id) });
}

// PATCH /api/comissoes/regras/:id
function atualizarRegra(req, res) {
  if (req.usuario.role !== 'SUPER_ADMIN') return res.status(403).json({ sucesso:false, erro:'Acesso negado.' });
  const db = getDb();
  const atual = db.prepare('SELECT * FROM comissao_regras WHERE id=?').get(req.params.id);
  if (!atual) return res.status(404).json({ sucesso:false, erro:'Regra não encontrada.' });
  const campos = {};
  // Aceita tanto bonus_meta_valor (novo) quanto bonus_meta_pct (retrocompatibilidade)
  ['nome','usuario_id','funil_id','tipo_calculo','percentual','valor_fixo','valor_min','valor_max','bonus_meta_pct','ativo'].forEach(k => {
    if (k === 'bonus_meta_pct' && req.body.bonus_meta_valor !== undefined) {
      campos.bonus_meta_pct = req.body.bonus_meta_valor; // salva no campo legado do banco
    } else if (req.body[k] !== undefined) {
      campos[k] = req.body[k];
    }
  });
  campos.atualizado_em = new Date().toISOString();
  db.prepare(`UPDATE comissao_regras SET ${Object.keys(campos).map(k=>`${k}=?`).join(',')} WHERE id=?`)
    .run(...Object.values(campos), req.params.id);
  req.log({ acao:'UPDATE', entidade:'comissao_regras', entidade_id:req.params.id, antes:atual, depois:campos });
  return res.json({ sucesso:true, dados: db.prepare('SELECT * FROM comissao_regras WHERE id=?').get(req.params.id) });
}

// DELETE /api/comissoes/regras/:id
function deletarRegra(req, res) {
  if (req.usuario.role !== 'SUPER_ADMIN') return res.status(403).json({ sucesso:false, erro:'Acesso negado.' });
  const db = getDb();
  db.prepare('DELETE FROM comissao_regras WHERE id=?').run(req.params.id);
  req.log({ acao:'DELETE', entidade:'comissao_regras', entidade_id:req.params.id });
  return res.json({ sucesso:true });
}

// GET /api/comissoes/calcular  — Calcula comissões em tempo real por vendedor
function calcular(req, res) {
  const db = getDb();
  const { funil_id, usuario_id, mes } = req.query;

  // Período: mês atual por padrão
  const hoje = new Date();
  const anoMes = mes || `${hoje.getFullYear()}-${String(hoje.getMonth()+1).padStart(2,'0')}`;
  const de  = anoMes + '-01';
  const ate = new Date(anoMes.slice(0,4), parseInt(anoMes.slice(5,7)), 0).toISOString().slice(0,10);

  // Busca vendas do período
  let sql = `SELECT l.responsavel_id, u.nome as vendedor_nome,
    SUM(l.valor) as total_vendido, COUNT(*) as qtd_vendas
    FROM leads l
    LEFT JOIN usuarios u ON l.responsavel_id=u.id
    LEFT JOIN pipelines p ON l.pipeline_id=p.id
    WHERE l.status='GANHO'
    AND date(l.atualizado_em) >= ? AND date(l.atualizado_em) <= ?`;
  const params = [de, ate];
  if (funil_id)   { sql += ' AND p.funil_id=?';       params.push(funil_id); }
  if (usuario_id) { sql += ' AND l.responsavel_id=?'; params.push(usuario_id); }
  if (req.usuario.role === 'VENDEDOR') { sql += ' AND l.responsavel_id=?'; params.push(req.usuario.id); }
  sql += ' GROUP BY l.responsavel_id, u.nome ORDER BY total_vendido DESC';

  const vendas = db.prepare(sql).all(...params);
  const regras = db.prepare('SELECT * FROM comissao_regras WHERE ativo=1').all();

  const resultado = vendas.map(v => {
    // Regras filtradas para este vendedor/geral
    const regrasVendedor = regras.filter(r =>
      (!r.usuario_id || r.usuario_id === v.responsavel_id) &&
      (!r.funil_id   || r.funil_id === funil_id)
    );
    const comissao = calcularComissaoFaixas(v.total_vendido || 0, regrasVendedor);

    // Bônus por meta atingida — valor fixo em R$
    let bonus = 0;
    const meta = db.prepare(`
      SELECT m.* FROM metas m
      WHERE m.ativo=1 AND m.tipo='FATURAMENTO'
        AND (m.usuario_id=? OR m.usuario_id IS NULL)
        AND m.mes=CAST(strftime('%m',?) AS INTEGER)
        AND m.ano=CAST(strftime('%Y',?) AS INTEGER)
      LIMIT 1`).get(v.responsavel_id, de, de);

    if (meta && (v.total_vendido||0) >= meta.valor_alvo) {
      // bonus_meta_pct está armazenado como valor R$ (coluna renomeada semanticamente)
      const regrasBonus = regrasVendedor.filter(r => (r.bonus_meta_pct||0) > 0);
      if (regrasBonus.length) bonus = regrasBonus[0].bonus_meta_pct; // R$ fixo
    }

    return {
      responsavel_id: v.responsavel_id,
      vendedor_nome:  v.vendedor_nome,
      total_vendido:  v.total_vendido || 0,
      qtd_vendas:     v.qtd_vendas,
      comissao_base:  comissao,
      bonus,
      comissao_total: comissao + bonus,
      meta_atingida:  meta ? (v.total_vendido||0) >= meta.valor_alvo : false,
      mes:            anoMes,
    };
  });

  return res.json({ sucesso:true, dados:resultado, periodo:{ de, ate, mes:anoMes } });
}

module.exports = { painel, atualizarStatus, atualizarSalario, listarRegras, criarRegra, atualizarRegra, deletarRegra, calcular };
