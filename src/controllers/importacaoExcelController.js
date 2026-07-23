/**
 * PROSPEKT CRM — importacaoExcelController.js
 * Importação de Leads via planilha Excel (.xlsx)
 * Acesso: SOMENTE SUPER_ADMIN
 *
 * Endpoints:
 *   GET  /api/importacao-excel/modelo           — baixa planilha modelo
 *   POST /api/importacao-excel/validar          — valida arquivo (fase 1, sem criar leads)
 *   POST /api/importacao-excel/importar/:id     — importa leads validados (fase 2)
 *   GET  /api/importacao-excel/historico        — histórico de importações
 *   GET  /api/importacao-excel/historico/:id/erros — baixa relatório de erros CSV
 */

const crypto    = require('crypto');
const XLSX      = require('xlsx');
const multer    = require('multer');
const { getProvider } = require('../database/dbProvider');
const { registrarTimeline } = require('../services/auditService');

// ── Multer: aceita só .xlsx até 20MB ─────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.originalname.match(/\.(xlsx|xlsm)$/i)) cb(null, true);
    else cb(new Error('Apenas arquivos .xlsx ou .xlsm são aceitos.'), false);
  },
});

// ── Colunas da planilha modelo ───────────────────────────────────────────────
const COLUNAS_MODELO = [
  'nome_lead','empresa','telefone_whatsapp','email','cpf_cnpj',
  'funil','etapa','vendedor_usuario','vendedor_nome',
  'data_entrada','valor_estimado','prioridade','observacoes_historico_inicial',
  'tags','cep_entrega','endereco_entrega','numero_entrega','complemento_entrega',
  'referencia_entrega','bairro_entrega','cidade_entrega','uf_entrega',
  'produto_interesse_1','produto_interesse_2','produto_interesse_3',
  'origem_planilha','observacao_interna',
];

const CAMPOS_OBRIGATORIOS = ['nome_lead','telefone_whatsapp','funil','etapa','vendedor_usuario','data_entrada'];

const PRIORIDADES_VALIDAS = ['Baixa','Média','Alta','Crítica','Media','Critica'];

const UFS_VALIDAS = [
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG',
  'PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'
];

// ── Helper: normaliza telefone ────────────────────────────────────────────────────
function normalizarTelefone(tel) {
  if (!tel) return '';
  return String(tel).replace(/\D/g, '');
}

// ── Helper: remove acentos e normaliza para comparação fuzzy ───────────────────────
function semAcento(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

// ── Helper: remove acentos, espaços e pontuação — match ultra-robusto de nomes ────────
function soLetras(str) {
  return semAcento(str).replace(/[^a-z0-9]/g, '');
}

// ── Helper: normaliza data ─────────────────────────────────────────────────────────
// Aceita: Date JS (cellDates:true), número serial Excel, dd/mm/aaaa, aaaa-mm-dd
function normalizarData(val) {
  if (!val && val !== 0) return null;

  // 1. Objeto Date (retornado pelo xlsx com cellDates:true)
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return null;
    return val.toISOString().slice(0, 10);
  }

  // 2. Número serial do Excel (fallback sem cellDates)
  if (typeof val === 'number') {
    try {
      const d = XLSX.SSF.parse_date_code(val);
      if (d && d.y > 1900) return new Date(Date.UTC(d.y, d.m - 1, d.d)).toISOString().slice(0, 10);
    } catch (_) {}
    return null;
  }

  const s = String(val).trim();
  // 3. dd/mm/aaaa
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
    const [d, m, y] = s.split('/');
    const dt = new Date(Date.UTC(+y, +m - 1, +d));
    if (isNaN(dt.getTime())) return null;
    return dt.toISOString().slice(0, 10);
  }
  // 4. aaaa-mm-dd
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const dt = new Date(s);
    if (isNaN(dt.getTime())) return null;
    return s.slice(0, 10);
  }
  return null;
}

// ── Helper: parse de tags ────────────────────────────────────────────────────
function parseTags(val) {
  if (!val) return [];
  return String(val).split(';').map(t => t.trim()).filter(Boolean);
}

// ── GET /api/importacao-excel/modelo ─────────────────────────────────────────
async function downloadModelo(req, res) {
  try {
    // Linha de exemplo
    const exemplo = {
      nome_lead: 'João da Silva',
      empresa: 'Empresa XYZ',
      telefone_whatsapp: '5511999999999',
      email: 'joao@empresa.com',
      cpf_cnpj: '123.456.789-00',
      funil: 'LinkedIn',
      etapa: 'Lead Recebido',
      vendedor_usuario: 'vendedor@prospekt.com',
      vendedor_nome: 'Maria Vendedora',
      data_entrada: '20/07/2026',
      valor_estimado: '5000',
      prioridade: 'Alta',
      observacoes_historico_inicial: 'Prospectado via evento.',
      tags: 'urgente;b2b',
      cep_entrega: '01310-000',
      endereco_entrega: 'Av. Paulista',
      numero_entrega: '1000',
      complemento_entrega: 'Sala 101',
      referencia_entrega: 'Próx. metrô',
      bairro_entrega: 'Bela Vista',
      cidade_entrega: 'São Paulo',
      uf_entrega: 'SP',
      produto_interesse_1: 'Produto A',
      produto_interesse_2: '',
      produto_interesse_3: '',
      origem_planilha: 'Planilha Q2 2026',
      observacao_interna: 'Lead quente.',
    };

    const wb  = XLSX.utils.book_new();
    const ws  = XLSX.utils.json_to_sheet([exemplo], { header: COLUNAS_MODELO });
    XLSX.utils.book_append_sheet(wb, ws, 'Leads');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Disposition', 'attachment; filename="modelo_importacao_leads_prospekt.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    return res.send(buf);
  } catch (e) {
    console.error('[importacao-excel.modelo]', e.message);
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// ── POST /api/importacao-excel/validar ────────────────────────────────────────
// FASE 1: lê o Excel, valida linhas, NÃO cria leads ainda.
// Cria registro em importacoes_leads com status='aguardando_confirmacao'.
async function validar(req, res) {
  const arquivo = req.file;
  if (!arquivo) return res.status(400).json({ sucesso: false, erro: 'Envie um arquivo .xlsx.' });

  const { sb, isSupa } = getProvider();
  const usuarioId   = req.usuario.id;
  const usuarioNome = req.usuario.nome;
  const nomeArquivo = arquivo.originalname;
  const agora       = new Date().toISOString();

  try {
    // Parse do Excel com cellDates:true para receber datas como objetos Date
    const wb    = XLSX.read(arquivo.buffer, { type: 'buffer', cellDates: true });
    const ws    = wb.Sheets[wb.SheetNames[0]];
    const rows  = XLSX.utils.sheet_to_json(ws, { defval: '' });

    if (!rows.length) {
      return res.status(400).json({ sucesso: false, erro: 'Planilha vazia ou sem dados.' });
    }
    if (rows.length > 1000) {
      return res.status(400).json({ sucesso: false, erro: 'Máximo de 1000 linhas por importação.' });
    }

    // Carrega funis + etapas + usuários ativos para validação em memória
    let funisList = [], etapasList = [], usuariosList = [];
    let telefonesExistentes = new Set(), emailsExistentes = new Set();

    if (isSupa) {
      const [fR, eR, uR, lR] = await Promise.all([
        sb.from('funis').select('id,nome,ativo'),
        sb.from('etapas').select('id,nome,pipeline_id,oculta').eq('oculta', false),
        sb.from('usuarios').select('id,nome,email,role,ativo').eq('ativo', true),
        sb.from('leads').select('telefone,email').is('deleted_at', null),
      ]);
      // Resolve funil_id por etapa via pipelines
      const [pR] = await Promise.all([
        sb.from('pipelines').select('id,funil_id'),
      ]);
      const pipelineMap = Object.fromEntries((pR.data||[]).map(p => [p.id, p.funil_id]));
      funisList   = (fR.data||[]).filter(f => f.ativo !== false && f.ativo !== 0);
      etapasList  = (eR.data||[]).map(e => ({ ...e, funil_id: pipelineMap[e.pipeline_id] || null }));
      usuariosList = (uR.data||[]).filter(u => ['VENDEDOR','SUPER_ADMIN','GESTOR'].includes(u.role));
      (lR.data||[]).forEach(l => {
        if (l.telefone) telefonesExistentes.add(normalizarTelefone(l.telefone));
        if (l.email)    emailsExistentes.add(l.email.toLowerCase().trim());
      });
    }

    // Mapas de busca rápida (com normalização de acentos)
    // funilMap: sem acento -> objeto funil
    const funilMap   = {};
    funisList.forEach(f => { funilMap[semAcento(f.nome)] = f; });

    // etapasByFunil: funilId -> [etapa]
    const etapasByFunil = {};
    etapasList.forEach(e => {
      if (e.funil_id) {
        if (!etapasByFunil[e.funil_id]) etapasByFunil[e.funil_id] = [];
        etapasByFunil[e.funil_id].push(e);
      }
    });

    // usuarioByEmail: email -> usuario
    const usuarioByEmail      = {};
    // usuarioByNome: nome sem acento -> usuario
    const usuarioByNome       = {};
    // usuarioByNomeCompacto: nome sem acento/espacos/pontuacao -> usuario (match definitivo)
    const usuarioByNomeCompacto = {};
    usuariosList.forEach(u => {
      usuarioByEmail[u.email.toLowerCase().trim()] = u;
      usuarioByNome[semAcento(u.nome)] = u;
      usuarioByNomeCompacto[soLetras(u.nome)] = u;
    });

    // ── Valida cada linha ─────────────────────────────────────────────────────
    const linhas = rows.map((row, idx) => {
      const numero = idx + 2; // 1=cabeçalho, linhas começam em 2
      const erros  = [];

      // get: retorna valor como string (para campos texto)
      const get = (col) => {
        if (row[col] !== undefined) return String(row[col]).trim();
        const colLower = col.toLowerCase();
        for (const key of Object.keys(row)) {
          if (key.toLowerCase().replace(/\s+/g,'_') === colLower) {
            return String(row[key]).trim();
          }
        }
        return '';
      };

      // getRaw: retorna o valor bruto da celula sem forcar String()
      // Necessario para datas: com cellDates:true o xlsx retorna objeto Date, nao string
      const getRaw = (col) => {
        if (row[col] !== undefined) return row[col];
        const colLower = col.toLowerCase();
        for (const key of Object.keys(row)) {
          if (key.toLowerCase().replace(/\s+/g,'_') === colLower) return row[key];
        }
        return '';
      };

      const nome     = get('nome_lead');
      const telefone = normalizarTelefone(get('telefone_whatsapp'));
      const email    = get('email').toLowerCase();
      const funilNm  = get('funil');
      const etapaNm  = get('etapa');
      // Aceita vendedor_usuario OU vendedor_email (retrocompatibilidade)
      const vendLogin = (get('vendedor_usuario') || get('vendedor_email')).toLowerCase().trim();
      // IMPORTANTE: usa getRaw para preservar objeto Date retornado pelo xlsx
      const dataEntradaRaw  = getRaw('data_entrada');
      const dataEntrada     = String(dataEntradaRaw).trim(); // para checar se e vazio
      const dataEntradaNorm = normalizarData(dataEntradaRaw);


      // ── Campos obrigatórios ───────────────────────────────────────────────
      if (!nome)          erros.push(`Linha ${numero}: nome_lead é obrigatório.`);
      if (!telefone)      erros.push(`Linha ${numero}: telefone_whatsapp é obrigatório.`);
      if (!funilNm)       erros.push(`Linha ${numero}: funil é obrigatório.`);
      if (!etapaNm)       erros.push(`Linha ${numero}: etapa é obrigatória.`);
      if (!vendLogin)     erros.push(`Linha ${numero}: vendedor_usuario é obrigatório.`);
      if (!dataEntrada || dataEntrada === '[object Object]')
                          erros.push(`Linha ${numero}: data_entrada é obrigatória.`);

      // ── Funil válido (sem acento) ──────────────────────────────────────────────
      let funilObj = null, etapaObj = null, vendedorObj = null;
      if (funilNm) {
        funilObj = funilMap[semAcento(funilNm)];
        if (!funilObj) erros.push(`Linha ${numero}: Funil "${funilNm}" não encontrado ou inativo.`);
      }

      // ── Etapa válida no funil (sem acento) ──────────────────────────────────────
      if (funilObj && etapaNm) {
        const etapasDoFunil = etapasByFunil[funilObj.id] || [];
        etapaObj = etapasDoFunil.find(e => semAcento(e.nome) === semAcento(etapaNm));
        if (!etapaObj) {
          erros.push(`Linha ${numero}: Etapa "${etapaNm}" não pertence ao funil "${funilNm}" ou está oculta.`);
        }
      } else if (!funilObj && etapaNm) {
        erros.push(`Linha ${numero}: Etapa não pôde ser validada pois o funil é inválido.`);
      }

      // ── Vendedor ativo (por email OU nome, sem acento) ─────────────────────────────
      if (vendLogin) {
        // 1º tenta por email exato
        // 2º tenta por nome sem acento ("lais basilio" == "Lais Basilio")
        // 3º tenta por nome compacto sem espacos/pontuacao (match definitivo)
        vendedorObj =
          usuarioByEmail[vendLogin]
          || usuarioByNome[semAcento(vendLogin)]
          || usuarioByNomeCompacto[soLetras(vendLogin)];
        if (!vendedorObj) {
          erros.push(`Linha ${numero}: Vendedor "${vendLogin}" não encontrado ou inativo no CRM. Use o email ou nome exato do usuário.`);
        }
      }

      // ── Prioridade ────────────────────────────────────────────────────────
      const prioridade = get('prioridade');
      if (prioridade && !PRIORIDADES_VALIDAS.includes(prioridade)) {
        erros.push(`Linha ${numero}: Prioridade "${prioridade}" inválida. Use: Baixa, Média, Alta ou Crítica.`);
      }

      // ── UF ────────────────────────────────────────────────────────────────
      const uf = get('uf_entrega').toUpperCase();
      if (uf && !UFS_VALIDAS.includes(uf)) {
        erros.push(`Linha ${numero}: UF "${uf}" inválida.`);
      }

      // ── Tamanho mínimo telefone ───────────────────────────────────────────
      if (telefone && telefone.length < 8) {
        erros.push(`Linha ${numero}: telefone_whatsapp muito curto (mínimo 8 dígitos).`);
      }

      // ── Data entrada válida (usa dataEntradaNorm já calculado acima) ────────────
      if (dataEntradaRaw && !dataEntradaNorm) {
        erros.push(`Linha ${numero}: data_entrada inválida. Use dd/mm/aaaa (ex: 20/07/2026).`);
      }

      // ── Duplicidade ───────────────────────────────────────────────────────
      let isDuplicado = false;
      const motivosDupl = [];
      if (telefone && telefonesExistentes.has(telefone)) {
        isDuplicado = true;
        motivosDupl.push(`Linha ${numero}: Telefone ${telefone} já existe no CRM.`);
      }
      if (email && emailsExistentes.has(email)) {
        isDuplicado = true;
        motivosDupl.push(`Linha ${numero}: E-mail ${email} já existe no CRM.`);
      }

      // ── Dados normalizados ────────────────────────────────────────────────
      const dadosNorm = {
        nome_lead:               nome,
        empresa:                 get('empresa'),
        telefone_whatsapp:       telefone,
        email:                   email || null,
        cpf_cnpj:                get('cpf_cnpj'),
        funil:                   funilNm,
        funil_id:                funilObj?.id || null,
        etapa:                   etapaNm,
        etapa_id:                etapaObj?.id || null,
        vendedor_usuario:        vendLogin,
        vendedor_id:             vendedorObj?.id || null,
        vendedor_nome:           vendedorObj?.nome || get('vendedor_nome'),
        data_entrada:            dataEntradaNorm || agora.slice(0,10),
        valor_estimado:          parseFloat(get('valor_estimado')) || 0,
        prioridade:              prioridade || null,
        observacoes_historico_inicial: get('observacoes_historico_inicial'),
        tags:                    parseTags(get('tags')),
        cep_entrega:             get('cep_entrega'),
        endereco_entrega:        get('endereco_entrega'),
        numero_entrega:          get('numero_entrega'),
        complemento_entrega:     get('complemento_entrega'),
        referencia_entrega:      get('referencia_entrega'),
        bairro_entrega:          get('bairro_entrega'),
        cidade_entrega:          get('cidade_entrega'),
        uf_entrega:              uf,
        produto_interesse_1:     get('produto_interesse_1'),
        produto_interesse_2:     get('produto_interesse_2'),
        produto_interesse_3:     get('produto_interesse_3'),
        origem_planilha:         get('origem_planilha') || 'importacao_excel',
        observacao_interna:      get('observacao_interna'),
      };

      const status = erros.length > 0 ? 'invalido'
        : isDuplicado ? 'duplicado' : 'valido';

      return {
        numero_linha: numero,
        status,
        erro:      erros.length  ? erros.join(' | ')          : null,
        duplicado: isDuplicado   ? motivosDupl.join(' | ')    : null,
        dados_json: dadosNorm,
      };
    });

    // ── Salva importação no banco (status aguardando_confirmacao) ────────────
    const importacaoId = crypto.randomBytes(16).toString('hex');
    const totalValidas    = linhas.filter(l => l.status === 'valido').length;
    const totalErros      = linhas.filter(l => l.status === 'invalido').length;
    const totalDuplicados = linhas.filter(l => l.status === 'duplicado').length;

    if (isSupa) {
      await sb.from('importacoes_leads').insert({
        id:               importacaoId,
        usuario_id:       usuarioId,
        usuario_nome:     usuarioNome,
        nome_arquivo:     nomeArquivo,
        total_linhas:     rows.length,
        total_validas:    totalValidas,
        total_erros:      totalErros,
        total_duplicados: totalDuplicados,
        total_importados: 0,
        status:           'aguardando_confirmacao',
        criado_em:        agora,
      });

      // Salva as linhas
      const loteLinhas = linhas.map(l => ({
        id:            crypto.randomBytes(16).toString('hex'),
        importacao_id: importacaoId,
        numero_linha:  l.numero_linha,
        dados_json:    l.dados_json,
        status:        l.status,
        erro:          l.erro || l.duplicado || null,
        criado_em:     agora,
      }));

      // Insere em lotes de 100
      for (let i = 0; i < loteLinhas.length; i += 100) {
        await sb.from('importacao_lead_linhas').insert(loteLinhas.slice(i, i + 100));
      }
    }

    return res.json({
      sucesso: true,
      importacao_id: importacaoId,
      resumo: {
        total:      rows.length,
        validas:    totalValidas,
        erros:      totalErros,
        duplicados: totalDuplicados,
      },
      linhas: linhas.map(l => ({
        numero_linha: l.numero_linha,
        status:       l.status,
        erro:         l.erro,
        duplicado:    l.duplicado,
        nome_lead:    l.dados_json.nome_lead,
        telefone:     l.dados_json.telefone_whatsapp,
        funil:        l.dados_json.funil,
        etapa:        l.dados_json.etapa,
        vendedor:     l.dados_json.vendedor_usuario || l.dados_json.vendedor_nome,
      })),
    });

  } catch (e) {
    console.error('[importacao-excel.validar]', e.message);
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// ── POST /api/importacao-excel/importar/:id ───────────────────────────────────
// FASE 2: importa as linhas válidas de uma validação prévia.
async function importar(req, res) {
  const { sb, isSupa } = getProvider();
  const importacaoId   = req.params.id;
  const usuarioId      = req.usuario.id;
  const usuarioNome    = req.usuario.nome;
  const agora          = new Date().toISOString();

  if (!isSupa) {
    return res.status(501).json({ sucesso: false, erro: 'Importação Excel disponível apenas com Supabase.' });
  }

  try {
    // Busca importação
    const { data: imp, error: errImp } = await sb.from('importacoes_leads')
      .select('*').eq('id', importacaoId).single();
    if (errImp || !imp) return res.status(404).json({ sucesso: false, erro: 'Importação não encontrada.' });
    if (imp.status !== 'aguardando_confirmacao') {
      return res.status(400).json({ sucesso: false, erro: `Importação está com status "${imp.status}". Valide novamente.` });
    }

    // Marca como importando
    await sb.from('importacoes_leads').update({ status: 'importando' }).eq('id', importacaoId);

    // Busca linhas válidas
    const { data: linhas } = await sb.from('importacao_lead_linhas')
      .select('*').eq('importacao_id', importacaoId).eq('status', 'valido');

    let importados = 0;
    let erros = 0;

    for (const linha of (linhas || [])) {
      try {
        const d = linha.dados_json;
        const leadId = crypto.randomBytes(16).toString('hex');

        // Cria lead
        const leadRow = {
          id:              leadId,
          nome:            d.nome_lead,
          email:           d.email || null,
          telefone:        d.telefone_whatsapp || null,
          empresa:         d.empresa || null,
          cargo:           null,
          valor:           d.valor_estimado || 0,
          funil_id:        d.funil_id,
          etapa_id:        d.etapa_id,
          responsavel_id:  d.vendedor_id,
          origem:          d.origem_planilha || 'importacao_excel',
          status:          'ativo',
          observacoes:     d.observacao_interna || null,
          tags:            d.tags?.length ? d.tags : null,
          // Endereço de entrega
          cep_entrega:             d.cep_entrega || null,
          endereco_entrega:        d.endereco_entrega || null,
          numero_entrega:          d.numero_entrega || null,
          complemento_entrega:     d.complemento_entrega || null,
          referencia_entrega:      d.referencia_entrega || null,
          bairro_entrega:          d.bairro_entrega || null,
          cidade_entrega:          d.cidade_entrega || null,
          uf_entrega:              d.uf_entrega || null,
          criado_em:       d.data_entrada ? new Date(d.data_entrada).toISOString() : agora,
          atualizado_em:   agora,
        };

        const { error: errLead } = await sb.from('leads').insert(leadRow);
        if (errLead) throw new Error(errLead.message);

        // Registra etapa histórico (Funil de Conversão)
        try {
          const ehSvc = require('../services/etapaHistoricoService');
          await ehSvc.registrarPassagem({
            leadId, etapaId: d.etapa_id, funilId: d.funil_id,
            responsavelId: d.vendedor_id, origem: 'importacao_excel',
            entrou_em: leadRow.criado_em,
          });
        } catch (_) {}

        // Registra nota inicial se houver
        if (d.observacoes_historico_inicial) {
          await sb.from('mensagens').insert({
            id:       crypto.randomBytes(16).toString('hex'),
            lead_id:  leadId,
            usuario_id: usuarioId,
            tipo:     'NOTA',
            conteudo: `Histórico inicial: ${d.observacoes_historico_inicial}`,
            criado_em: agora,
            enviado_em: agora,
          }).catch(() => {});
        }

        // Timeline: IMPORTACAO_LEAD
        await registrarTimeline({
          leadId,
          usuarioId,
          usuarioNome,
          tipoAcao:   'IMPORTACAO_LEAD',
          descricao:  `Lead importado via planilha: "${imp.nome_arquivo}". Importado por: ${usuarioNome}.`,
          dadosNovos: {
            arquivo:   imp.nome_arquivo,
            funil:     d.funil,
            etapa:     d.etapa,
            vendedor:  d.vendedor_nome || d.vendedor_usuario || d.vendedor_email,
            telefone:  d.telefone_whatsapp,
            origem:    d.origem_planilha || 'importacao_excel',
            historico_inicial: d.observacoes_historico_inicial || null,
            data_entrada: d.data_entrada,
            importado_em: agora,
          },
          origem: 'importacao_excel',
        }).catch(e => console.warn('[TIMELINE_IMPORT]', e.message));

        // Atualiza linha como importado
        await sb.from('importacao_lead_linhas').update({ status: 'importado', lead_id: leadId }).eq('id', linha.id);
        importados++;
      } catch (errLinha) {
        console.error('[importacao-excel.importar linha]', errLinha.message);
        await sb.from('importacao_lead_linhas').update({ status: 'erro', erro: errLinha.message }).eq('id', linha.id);
        erros++;
      }
    }

    // Finaliza importação
    await sb.from('importacoes_leads').update({
      status:          'concluido',
      total_importados: importados,
      total_erros:     erros,
      finalizado_em:   agora,
    }).eq('id', importacaoId);

    return res.json({
      sucesso: true,
      resumo: {
        total_linhas:  linhas?.length || 0,
        importados,
        erros,
      },
    });

  } catch (e) {
    console.error('[importacao-excel.importar]', e.message);
    await sb.from('importacoes_leads').update({ status: 'erro' }).eq('id', importacaoId).catch(() => {});
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// ── GET /api/importacao-excel/historico ───────────────────────────────────────
async function historico(req, res) {
  const { sb, isSupa } = getProvider();
  if (!isSupa) return res.json({ sucesso: true, dados: [] });

  try {
    const { data, error } = await sb.from('importacoes_leads')
      .select('id,usuario_nome,nome_arquivo,total_linhas,total_validas,total_erros,total_duplicados,total_importados,status,criado_em,finalizado_em')
      .order('criado_em', { ascending: false })
      .limit(50);
    if (error) throw error;
    return res.json({ sucesso: true, dados: data || [] });
  } catch (e) {
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// ── GET /api/importacao-excel/historico/:id/erros ────────────────────────────
// Baixa CSV de erros de uma importação
async function downloadErros(req, res) {
  const { sb, isSupa } = getProvider();
  if (!isSupa) return res.status(501).json({ sucesso: false, erro: 'Disponível apenas com Supabase.' });

  const importacaoId = req.params.id;
  try {
    const { data: linhas } = await sb.from('importacao_lead_linhas')
      .select('*')
      .eq('importacao_id', importacaoId)
      .in('status', ['invalido','duplicado','erro'])
      .order('numero_linha');

    const rows = (linhas || []).map(l => ({
      'Linha':             l.numero_linha,
      'Nome Lead':         l.dados_json?.nome_lead || '',
      'Telefone':          l.dados_json?.telefone_whatsapp || '',
      'Funil':             l.dados_json?.funil || '',
      'Etapa':             l.dados_json?.etapa || '',
      'Vendedor Email':    l.dados_json?.vendedor_email || '',
      'Status':            l.status,
      'Erro':              l.erro || '',
      'Ação Recomendada':  l.status === 'duplicado' ? 'Verificar lead existente no CRM.' : 'Corrigir dado e reimportar.',
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, 'Erros');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Disposition', `attachment; filename="erros_importacao_${importacaoId.slice(0,8)}.xlsx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    return res.send(buf);
  } catch (e) {
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

module.exports = {
  upload,           // middleware multer para usar na rota
  downloadModelo,
  validar,
  importar,
  historico,
  downloadErros,
};
