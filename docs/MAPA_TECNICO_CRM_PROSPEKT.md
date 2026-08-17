# Mapa Técnico — CRM Prospekt
**Data:** 2026-08-14 | Versão: 1.0

---

## 1. Ambiente de Execução

| Componente | Tecnologia |
|---|---|
| **Runtime** | Node.js (Express.js) |
| **Banco de dados (produção)** | Supabase (PostgreSQL) |
| **Banco de dados (dev/local)** | SQLite (better-sqlite3) — fallback automático |
| **Storage de mídias** | Supabase Storage |
| **Deploy** | Railway |
| **Frontend** | HTML + Vanilla CSS + JavaScript puro |
| **Autenticação** | JWT (Access Token + Refresh Token) |

---

## 2. Arquivos Analisados

### Backend — Servidor

| Arquivo | Função |
|---|---|
| `server.js` | Ponto de entrada do servidor Express |
| `src/routes/api.js` | Todas as rotas da API (1 arquivo central) |
| `src/database/dbProvider.js` | Factory: Supabase ou SQLite conforme `DATABASE_PROVIDER` |
| `src/database/db.js` | Inicialização do SQLite local |
| `src/middleware/auth.js` | Autenticação JWT + hierarquia de roles |

### Backend — Controllers

| Arquivo | Módulo |
|---|---|
| `src/controllers/leadsController.js` | Leads, movimentação, venda, clone, histórico |
| `src/controllers/admVendasController.js` | Adm. de Vendas — CRUD, etapas, histórico |
| `src/controllers/adminController.js` | Reset de dados de teste (SUPER_ADMIN only) |
| `src/controllers/authController.js` | Login, refresh token, troca de senha |
| `src/controllers/dashboardController.js` | Indicadores, funil de conversão, ranking |
| `src/controllers/funisController.js` | CRUD de funis, seed inicial, etapas |
| `src/controllers/etapasController.js` | CRUD de etapas de pipeline |
| `src/controllers/produtosController.js` | Catálogo de produtos |
| `src/controllers/usuariosController.js` | CRUD de usuários, perfis |
| `src/controllers/metasController.js` | Metas por vendedor e tipo |
| `src/controllers/comissoesController.js` | Painel de comissões, regras, salários |
| `src/controllers/producaoController.js` | Dados de produção do lead |
| `src/controllers/arquivosController.js` | Upload e download de arquivos do lead |
| `src/controllers/arquivosWhatsappController.js` | Arquivos via WhatsApp (recebidos/enviados) |
| `src/controllers/atividadesController.js` | Tarefas vinculadas ao lead |
| `src/controllers/msgsPadraoController.js` | Biblioteca de mensagens padrão |
| `src/controllers/automacoesMsgController.js` | Automações de mensagem |
| `src/controllers/contaAzulController.js` | Ficha Conta Azul, destinatários |
| `src/controllers/motivosPerdaController.js` | Motivos de perda configuráveis |
| `src/controllers/importacaoExcelController.js` | Importação de leads por planilha |
| `src/controllers/importacaoLeadsController.js` | Importação de leads (genérico) |
| `src/controllers/logsController.js` | Visualização de logs de auditoria |
| `src/controllers/auditController.js` | Auditoria, lixeira, restauração |
| `src/controllers/backupController.js` | Backup manual e download |
| `src/controllers/whatsappController.js` | 🔒 WhatsApp — texto, conversas, webhook |
| `src/controllers/whatsappAudioController.js` | 🔒 WhatsApp — áudio |

### Backend — Services

| Arquivo | Função |
|---|---|
| `src/services/admVendasCloneService.js` | Clone automático para Adm. de Vendas |
| `src/services/automacaoLeadsService.js` | Stale leads, SLA, tags automáticas |
| `src/services/backupService.js` | Backup automático (diário/semanal/mensal) |
| `src/services/etapaHistoricoService.js` | Migração e manutenção do histórico de etapas |
| `src/services/evolutionApiService.js` | 🔒 Comunicação com Evolution API (WhatsApp) |
| `src/services/whatsappService.js` | 🔒 Lógica de negócio WhatsApp |
| `src/services/authService.js` | Validação de tokens, geração de JWT |
| `src/services/auditService.js` | Registro de ações de auditoria |
| `src/services/emailService.js` | Envio de e-mail (SMTP / Gmail) |
| `src/services/sdrService.js` | Regras específicas do perfil SDR |
| `src/services/supabaseService.js` | Cliente Supabase reutilizável |
| `src/services/planilhaLeadsService.js` | Polling de planilha (desativado) |

### Backend — Utils

| Arquivo | Função |
|---|---|
| `src/utils/audioConverter.js` | Conversão de formato de áudio (ogg/mp3/webm) |

### Frontend — Telas HTML

| Arquivo | Tela | Funcionalidades principais |
|---|---|---|
| `public/index.html` | Redirect / Home | Redireciona para login ou dashboard |
| `public/login.html` | Login | Autenticação, troca de senha (primeiro acesso) |
| `public/dashboard.html` | Dashboard | KPIs, funil de conversão, ranking, alertas |
| `public/pipeline.html` | Pipeline / CRM | Kanban, card de lead completo, WhatsApp, Conta Azul |
| `public/adm-vendas.html` | Adm. de Vendas | Board de pós-venda, movimentação de etapas, histórico |
| `public/whatsapp.html` | Conversas WhatsApp | 🔒 Chat bidirecional, áudio, arquivos |
| `public/funis.html` | Funis e Etapas | CRUD de funis, pipelines, etapas |
| `public/usuarios.html` | Usuários | CRUD de usuários, perfis, salários |
| `public/metas.html` | Metas | Criação e gestão de metas por vendedor |
| `public/comissoes.html` | Comissões | Painel de comissões, regras, salários |
| `public/mensagens-padrao.html` | Biblioteca de Mensagens | Scripts comerciais, categorias, preview |
| `public/automacoes.html` | Automações | Configuração de automações de mensagem |
| `public/integracao-whatsapp.html` | Integração WhatsApp | 🔒 Configuração da Evolution API |
| `public/importacao-excel.html` | Importação | Upload de planilha de leads |
| `public/logs.html` | Logs | Visualização de auditoria |
| `public/trocar-senha.html` | Troca de Senha | Primeiro acesso / reset de senha |
| `public/acesso-negado.html` | Acesso Negado | Página de erro de permissão |

### Frontend — Scripts JS

| Arquivo | Responsabilidade |
|---|---|
| `public/js/auth.js` | Autenticação, refresh token, `Auth.api()` helper |
| `public/js/pipeline.js` | Lógica completa do pipeline, card de lead, drag-and-drop |
| `public/js/dashboard.js` | Indicadores, filtros, gráficos do dashboard |
| `public/js/whatsapp.js` | 🔒 Chat WhatsApp, mensagens em tempo real |
| `public/js/whatsapp-audio.js` | 🔒 Gravação e reprodução de áudio WhatsApp |
| `public/js/contaAzul.js` | Ficha Conta Azul, Gmail, download, cópia |
| `public/js/producao.js` | Aba de produção no card do lead |
| `public/js/leadArquivos.js` | Upload e listagem de arquivos no lead |
| `public/js/funis.js` | CRUD de funis e etapas |
| `public/js/metas.js` | Gestão de metas |
| `public/js/comissoes.js` | Painel de comissões |
| `public/js/mensagens-padrao.js` | Biblioteca de mensagens |
| `public/js/automacoes.js` | Automações de mensagem |
| `public/js/importacao-excel.js` | Upload de planilha |
| `public/js/atividades.js` | Tarefas vinculadas ao lead |
| `public/js/avatar.js` | Upload de avatar de usuário |
| `public/js/celebracao.js` | Animação de celebração ao fechar venda |
| `public/js/emoji-picker.js` | Seletor de emojis para mensagens |
| `public/js/integracao-whatsapp.js` | Configuração do WhatsApp |
| `public/js/sidebar.js` | Navegação lateral |
| `public/js/mobile-nav.js` | Navegação mobile |
| `public/js/toast.js` | Notificações visuais (Toast messages) |
| `public/js/whatsapp-picker.js` | Seletor de conversa WhatsApp no card |
| `public/js/usuarios-comerciais.js` | Lista de usuários para selects |

---

## 3. Tabelas do Banco de Dados (Supabase / PostgreSQL)

### Tabelas Operacionais

| Tabela | Campos Principais | Observação |
|---|---|---|
| `leads` | id, nome, empresa, email, telefone, status, etapa_id, funil_id, responsavel_id, valor_venda, forma_pagamento, produto_id, produto_nome, endereco_*, ganho_em, perdido_em, deleted_at, tags | Tabela central. Soft delete via `deleted_at`. |
| `lead_produtos` | id, lead_id, produto_id, produto_nome, quantidade, valor_unitario, valor_total, deleted_at | Multi-produto por lead. Soft delete. |
| `lead_producao` | id, lead_id, data_layout_virtual_aprovado, data_inicio, data_entrega, quantidade, anotacoes | Dados de produção do pedido. |
| `lead_arquivos` | id, lead_id, nome, url, tipo, tamanho, criado_em | Arquivos anexados ao lead. |
| `lead_timeline` | id, lead_id, tipo, titulo, descricao, usuario_id, criado_em | Histórico visual de eventos. |
| `lead_etapa_historico` | id, lead_id, etapa_id, etapa_nome, usuario_id, criado_em | Histórico de movimentação de etapas. |
| `adm_vendas` | id, lead_original_id, nome, empresa, etapa, status, valor_venda, produto_nome, responsavel_id, etapa_atualizada_em | Cards do Adm. de Vendas. |
| `adm_vendas_historico` | id, adm_venda_id, usuario_id, tipo, conteudo, criado_em | Histórico de cada card. |

### Tabelas WhatsApp (🔒 NÃO ALTERAR)

| Tabela | Campos Principais |
|---|---|
| `conversas_whatsapp` | id, lead_id, jid, status, ultima_mensagem_em |
| `mensagens_whatsapp` | id, conversa_id, tipo, conteudo, direcao, criado_em, media_url, media_key |
| `whatsapp_conversa_aliases` | id, conversa_id, jid_alias, tipo |

### Tabelas de Configuração

| Tabela | Função |
|---|---|
| `funis` | Funis de captação |
| `pipelines` | Associa funil a pipeline visual |
| `etapas` | Etapas de cada pipeline |
| `produtos` | Catálogo de produtos |
| `usuarios` | Contas do CRM |
| `metas` | Metas de vendedores |
| `comissao_regras` | Regras de comissionamento |
| `mensagens_padrao` | Biblioteca de scripts |
| `motivos_perda` | Motivos de perda configuráveis |
| `config_email_conta_azul` | Destinatários do Conta Azul |
| `automacoes` | Configurações de automação |

### Tabelas Derivadas / Suporte

| Tabela | Função |
|---|---|
| `comissoes` | Registros de comissão gerados |
| `atividades` | Tarefas vinculadas a leads |
| `logs` | Auditoria completa de ações |
| `audit_logs` | Log de auditoria alternativo |
| `conta_azul_emails_enviados` | Histórico de fichas enviadas |
| `importacoes_leads` | Registros de importações |
| `importacao_lead_linhas` | Linhas de cada importação |
| `notificacoes` | Notificações internas |
| `refresh_tokens` | Tokens de refresh JWT |

---

## 4. Buckets Supabase Storage

| Bucket | Conteúdo | Acesso |
|---|---|---|
| `whatsapp-midias` | 🔒 Áudios, imagens e documentos via WhatsApp | URLs assinadas temporárias |
| `lead-arquivos` *(ou similar)* | Arquivos anexados manualmente ao lead | Autenticado |

---

## 5. Variáveis de Ambiente Necessárias

> **Não incluir valores. Apenas nomes das variáveis.**

### Banco de Dados

| Variável | Finalidade |
|---|---|
| `DATABASE_PROVIDER` | `supabase` (produção) ou `sqlite` (local) |
| `DATABASE_URL` | URL do banco PostgreSQL (Supabase) |
| `DB_PATH` | Caminho do arquivo SQLite (dev local) |
| `SUPABASE_URL` | URL do projeto Supabase |
| `SUPABASE_ANON_KEY` | Chave anon do Supabase (cliente) |
| `SUPABASE_SERVICE_ROLE_KEY` | Chave service role do Supabase (admin) |

### Autenticação

| Variável | Finalidade |
|---|---|
| `JWT_ACCESS_SECRET` | Segredo para assinar tokens de acesso |
| `JWT_REFRESH_SECRET` | Segredo para assinar tokens de refresh |
| `JWT_ACCESS_EXPIRES` | Tempo de expiração do access token (ex: `15m`) |
| `JWT_REFRESH_EXPIRES` | Tempo de expiração do refresh token (ex: `7d`) |
| `SUPERADMIN_EMAIL` | E-mail do primeiro super admin |
| `SUPERADMIN_PASSWORD` | Senha do primeiro super admin |

### WhatsApp / Evolution API

| Variável | Finalidade |
|---|---|
| `EVOLUTION_API_URL` | URL base da Evolution API |
| `EVOLUTION_API_KEY` | Chave de autenticação da Evolution API |
| `EVOLUTION_INSTANCE` | Identificador da instância WhatsApp |
| `EVOLUTION_INSTANCE_NAME` | Nome da instância |
| `WHATSAPP_OFFICIAL_NUMBER` | Número oficial do WhatsApp da empresa |
| `WHATSAPP_WEBHOOK_SECRET` | Segredo para validar webhooks recebidos |
| `WEBHOOK_URL` | URL do webhook do CRM para a Evolution API |

### E-mail / SMTP

| Variável | Finalidade |
|---|---|
| `GMAIL_USER` | Usuário Gmail para referência |
| `GMAIL_APP_PASSWORD` | Senha de app Gmail (se SMTP ativo) |
| `SMTP_HOST` | Host SMTP |
| `SMTP_USER` | Usuário SMTP |
| `SMTP_FROM` | Remetente padrão de e-mails |

### Aplicação

| Variável | Finalidade |
|---|---|
| `NODE_ENV` | `production` ou `development` |
| `APP_URL` | URL pública do CRM |
| `BASE_URL` | URL base para links internos |
| `PUBLIC_APP_URL` | URL pública acessível externamente |
| `RAILWAY_PUBLIC_DOMAIN` | Domínio público no Railway |
| `WEBHOOK_PLANILHA_TOKEN` | Token para webhook de importação de planilha |

---

## 6. Rotas da API (completo)

### Auth

| Método | Rota | Controller | Permissão |
|---|---|---|---|
| POST | `/api/auth/login` | authCtrl.login | Público |
| POST | `/api/auth/refresh` | authCtrl.refresh | Público |
| POST | `/api/auth/logout` | authCtrl.logout | Autenticado |
| GET | `/api/auth/me` | authCtrl.me | Autenticado |
| POST | `/api/auth/trocar-senha` | authCtrl.trocarSenha | Público (valida senha_atual) |

### CEP

| Método | Rota | Função |
|---|---|---|
| GET | `/api/cep/:cep` | Consulta ViaCEP → BrasilAPI (fallback) |

### Leads

| Método | Rota | Função |
|---|---|---|
| GET | `/api/leads` | Listar leads (com filtros) |
| POST | `/api/leads` | Criar lead |
| GET | `/api/leads/:id` | Buscar lead |
| PATCH | `/api/leads/:id` | Atualizar lead |
| PATCH | `/api/leads/:id/mover` | Mover para etapa |
| PATCH | `/api/leads/:id/transferir` | Transferir responsável (GESTOR+) |
| DELETE | `/api/leads/:id` | Deletar lead (SUPER_ADMIN) |
| POST | `/api/leads/:id/mensagens` | Adicionar mensagem/nota |
| GET | `/api/leads/:id/historico` | Histórico do lead |
| POST | `/api/leads/:id/clonar` | Clonar lead |
| POST/DELETE | `/api/leads/:id/tags` | Gerenciar tags |
| GET | `/api/leads/alertas-recompra` | Alertas de recompra pendentes |

### Lead — Produtos

| Método | Rota | Função |
|---|---|---|
| GET | `/api/leads/:id/produtos` | Listar produtos do lead |
| POST | `/api/leads/:id/produtos` | Adicionar produto |
| PATCH | `/api/leads/:id/produtos/:itemId` | Atualizar produto |
| DELETE | `/api/leads/:id/produtos/:itemId` | Remover produto |

### Lead — Atividades

| Método | Rota | Função |
|---|---|---|
| GET | `/api/leads/:id/atividades` | Listar atividades |
| POST | `/api/leads/:id/atividades` | Criar atividade |
| GET | `/api/atividades/pendentes` | Atividades pendentes do usuário |
| GET | `/api/atividades/dashboard` | Painel de atividades |
| PATCH | `/api/atividades/:id` | Atualizar atividade |
| DELETE | `/api/atividades/:id` | Deletar atividade |

### Lead — Produção

| Método | Rota | Função |
|---|---|---|
| GET | `/api/leads/:id/producao` | Buscar dados de produção |
| POST/PATCH | `/api/leads/:id/producao` | Salvar/atualizar produção (upsert) |

### Lead — Arquivos

| Método | Rota | Função |
|---|---|---|
| GET | `/api/leads/:id/arquivos` | Listar arquivos |
| POST | `/api/leads/:id/arquivos` | Upload de arquivo |
| GET | `/api/leads/:id/arquivos/:arqId/download` | Download |
| POST | `/api/leads/:id/arquivos/:arqId/producao` | Vincular à produção |
| DELETE | `/api/leads/:id/arquivos/:arqId` | Excluir arquivo |

### Adm. de Vendas

| Método | Rota | Função |
|---|---|---|
| GET | `/api/adm-vendas` | Listar cards |
| GET | `/api/adm-vendas/:id` | Buscar card |
| POST | `/api/adm-vendas` | Criar card manual |
| PATCH | `/api/adm-vendas/:id` | Atualizar card (inclui etapa) |
| PATCH | `/api/adm-vendas/:id/etapa` | Mover etapa (drag-and-drop) |
| GET | `/api/adm-vendas/:id/historico` | Histórico do card |
| POST | `/api/adm-vendas/:id/historico` | Adicionar nota |

### Dashboard

| Método | Rota | Função |
|---|---|---|
| GET | `/api/dashboard/resumo` | KPIs gerais |
| GET | `/api/dashboard/funil-conversao` | Funil de conversão por etapa |
| GET | `/api/dashboard/ranking-vendedores` | Ranking por faturamento |

### Funis e Etapas

| Método | Rota | Função |
|---|---|---|
| GET/POST | `/api/funis` | Listar/criar funis |
| PATCH/DELETE | `/api/funis/:id` | Atualizar/deletar funil |
| GET/POST | `/api/etapas` | Listar/criar etapas |
| PATCH/DELETE | `/api/etapas/:id` | Atualizar/deletar etapa |

### Usuários

| Método | Rota | Função |
|---|---|---|
| GET/POST | `/api/usuarios` | Listar/criar usuários |
| PATCH/DELETE | `/api/usuarios/:id` | Atualizar/deletar usuário |

### Metas

| Método | Rota | Função |
|---|---|---|
| GET/POST | `/api/metas` | Listar/criar metas |
| POST | `/api/metas/:id/duplicar` | Duplicar meta |
| PATCH/DELETE | `/api/metas/:id` | Atualizar/deletar meta |

### Comissões

| Método | Rota | Função |
|---|---|---|
| GET | `/api/comissoes/painel` | Painel completo |
| GET | `/api/comissoes/calcular` | Calcular comissões do período |
| GET | `/api/comissoes/salarios` | Listar salários (GESTOR+) |
| GET/POST | `/api/comissoes/regras` | Listar/criar regras (POST: SUPER_ADMIN) |
| PATCH/DELETE | `/api/comissoes/regras/:id` | Atualizar/deletar regra (SUPER_ADMIN) |
| PATCH | `/api/comissoes/salario/:id` | Atualizar salário (GESTOR+) |
| PATCH | `/api/comissoes/:id/status` | Atualizar status de comissão |

### WhatsApp (🔒 Congelado)

| Método | Rota | Função |
|---|---|---|
| POST | `/api/whatsapp/webhook` | Receber eventos da Evolution API |
| GET | `/api/whatsapp/conversas` | Listar conversas |
| POST | `/api/whatsapp/conversas` | Criar/abrir conversa |
| GET | `/api/whatsapp/conversas/:id/mensagens` | Listar mensagens |
| POST | `/api/whatsapp/conversas/:id/mensagens` | Enviar mensagem de texto |
| POST | `/api/whatsapp/audio/send` | Enviar áudio |
| GET | `/api/whatsapp/audio/play/:msgId` | Reproduzir áudio (URL assinada) |
| GET | `/api/whatsapp/conversas/:id/arquivos` | Arquivos da conversa |
| POST | `/api/whatsapp/conversas/:id/arquivos` | Enviar arquivo |
| GET | `/api/whatsapp/mensagens/:msgId/arquivo` | Proxy arquivo recebido |
| GET | `/api/whatsapp/lead/:lead_id` | Conversa do lead |

### Conta Azul

| Método | Rota | Função |
|---|---|---|
| GET | `/api/conta-azul/destinatarios` | Listar destinatários |
| GET | `/api/conta-azul/historico/:leadId` | Histórico de envios do lead |
| POST | `/api/conta-azul/enviar/:leadId` | Registrar envio |
| POST | `/api/conta-azul/registrar-manual/:leadId` | Marcar como enviado manualmente |

### Admin

| Método | Rota | Função | Permissão |
|---|---|---|---|
| GET | `/api/admin/stats` | Estatísticas do sistema | SUPER_ADMIN |
| GET | `/api/admin/lixeira` | Leads deletados | GESTOR+ |
| POST | `/api/admin/restore` | Restaurar lead da lixeira | SUPER_ADMIN |
| GET/POST | `/api/admin/backups` | Listar/executar backup | SUPER_ADMIN |
| POST | `/api/admin/reset-dados-teste` | Reset controlado de dados de teste | SUPER_ADMIN + confirmação |

### Utilitários

| Método | Rota | Função |
|---|---|---|
| GET | `/api/health` | Health check do servidor |
| GET | `/api/audit` | Log de auditoria (GESTOR+) |

---

## 7. Fluxo de Autenticação

```
1. POST /api/auth/login { email, senha }
   → Retorna: { access_token, refresh_token, usuario }

2. Todas as rotas protegidas:
   Authorization: Bearer <access_token>
   → Middleware autenticar() valida JWT, popula req.usuario

3. Token expirado:
   POST /api/auth/refresh { refresh_token }
   → Retorna novo access_token

4. Hierarquia de roles (maior nivel engloba os menores):
   SUPER_ADMIN (3) > GESTOR (2) = SDR (2) > VENDEDOR (1)
```

---

## 8. Logs de Auditoria

O CRM registra automaticamente todas as ações relevantes:

- Criação, edição e exclusão de leads
- Movimentação de etapas
- Registro de vendas (ganho/perda)
- Clone para Adm. de Vendas e Carteira Recorrente
- Upload de arquivos
- Alteração de usuários

Logs armazenados em: tabela `logs` (Supabase) + `audit_logs`.

### Logs de rastreamento de automações (console)

Padrão de nomenclatura usado no CRM:

```
RESET_CRM_*, ADM_VENDAS_MOVE_*, ADM_VENDAS_CLONE_*
VENDA_VALIDACAO_*, GANHO_VALIDACAO_*
CEP_LOOKUP_*, CEP_NORMALIZED
WHATSAPP_MEDIA_*, WHATSAPP_AUDIO_*
LEAD_LISTAGEM_*, LEADS_LISTAR_*
ADM_VENDAS_API_LOAD_*, ADM_VENDAS_HISTORICO_*
RESET_CRM_BACKUP_*, RESET_CRM_SUCCESS
```

---

## 9. Migrations / Patches Aplicados

O banco passou pelos seguintes patches ao longo do desenvolvimento:

| Arquivo | Propósito |
|---|---|
| `supabase_migration.sql` | Migration base inicial |
| `supabase_patch_v3_vendas.sql` | Campos de venda |
| `supabase_patch_v6_lead_produtos.sql` | Multi-produto |
| `supabase_patch_v7_whatsapp_conversas.sql` | Estrutura WhatsApp |
| `supabase_patch_v11_etapa_historico.sql` | Histórico de etapas |
| `supabase_patch_v12_endereco_entrega.sql` | Endereço de entrega |
| `supabase_patch_v14_audio_whatsapp.sql` | Áudio WhatsApp |
| `supabase_patch_v15_arquivos_upload.sql` | Upload de arquivos |
| `supabase_patch_v16_timeline.sql` | Timeline visual |
| `supabase_patch_v17_importacao_excel.sql` | Importação de planilha |
| `supabase_patch_v21_whatsapp_aliases.sql` | Aliases WhatsApp (LID) |
| `supabase_patch_v22_conta_azul_destinatarios.sql` | Conta Azul |
| `supabase_patch_v26_sdr.sql` | Perfil SDR |
| `supabase_patch_v28_layout_virtual_schema.sql` | Data layout virtual |
| `supabase_patch_v36_cnpj_lead.sql` | Campo CNPJ |
| `supabase_patch_v44_audio_storage.sql` | Storage de áudios |
| `supabase_patch_v50_documento_recebido_whatsapp.sql` | Documentos recebidos via WA |
| `supabase_patch_v51_adm_vendas_schema_fix.sql` | Fix FK Adm. de Vendas |

---

## 10. Pontos Congelados (NÃO ALTERAR)

| Componente | Arquivos | Motivo |
|---|---|---|
| WhatsApp texto | `whatsappController.js`, `whatsapp.js` | Funcionando. Crítico para a operação. |
| WhatsApp áudio | `whatsappAudioController.js`, `whatsapp-audio.js`, `audioConverter.js` | Funcionando. |
| WhatsApp arquivos | `arquivosWhatsappController.js` | Funcionando. |
| Evolution API | `evolutionApiService.js` | Integração crítica. |
| Webhook WhatsApp | Rota `POST /api/whatsapp/webhook` | Recebe eventos em tempo real. |
| Tabelas WhatsApp | `conversas_whatsapp`, `mensagens_whatsapp`, `whatsapp_conversa_aliases` | Estrutura estável. |
| Bucket `whatsapp-midias` | Supabase Storage | Mídias em produção. |
| Clone → Adm. de Vendas | `admVendasCloneService.js` | Automação funcionando. |
| Clone → Carteira Recorrente | `admVendasController.js._clonarParaCarteiraRecorrente` | Automação funcionando. |

---

## 11. Documentos de Congelamento

| Arquivo | Conteúdo |
|---|---|
| `docs/WHATSAPP_ESTAVEL_CONGELADO.md` | Declaração oficial de congelamento do WhatsApp |
| `docs/WHATSAPP_ESTAVEL_NAO_ALTERAR.md` | Regras de não alteração |
| `docs/WHATSAPP_MIDIAS_ESTAVEL_CONGELADO.md` | Congelamento específico do módulo de mídias |
| `docs/WHATSAPP_VERSAO_ESTAVEL_2026-08-12.md` | Versão estável registrada em 12/08/2026 |
| `docs/CHECKLIST_WHATSAPP_ANTES_DE_COMMIT.md` | Checklist de segurança antes de qualquer commit |
| `docs/VERSAO_OFICIAL_INICIO_OPERACAO_REAL.md` | Declaração de início da operação real |
| `docs/INVENTARIO_OFICIAL_CRM_PROSPEKT.md` | Este inventário |

---

## 12. Validação de Integridade

Comandos para verificar saúde do projeto antes de qualquer deploy:

```bash
# Verificar sintaxe dos arquivos principais
node --check src/routes/api.js
node --check src/controllers/leadsController.js
node --check src/controllers/admVendasController.js
node --check src/controllers/adminController.js

# Verificar que arquivos congelados não foram alterados
git diff -- src/controllers/whatsappController.js
git diff -- src/controllers/whatsappAudioController.js
git diff -- public/js/whatsapp.js
git diff -- public/js/whatsapp-audio.js
git diff -- src/services/evolutionApiService.js

# Verificar status geral
git status
git diff --stat
```

Resultado esperado após qualquer commit:
- `node --check` → sem erros
- `git diff` nos arquivos WhatsApp → vazio (nenhuma alteração)

---

*Mapa Técnico gerado em: 2026-08-14*
*Baseado em análise direta do código-fonte do repositório.*
