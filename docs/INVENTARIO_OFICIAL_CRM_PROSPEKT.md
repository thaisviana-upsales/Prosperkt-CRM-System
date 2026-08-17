# Inventário Oficial — CRM Prospekt
**Data:** 2026-08-14 | **Versão:** 1.0 — Início da Operação Real

---

## 1. Resumo Executivo

O **CRM Prospekt** é um sistema de gestão de relacionamento com clientes desenvolvido sob medida para a **Prospekt Personalizados**. Ele cobre todo o ciclo comercial: da chegada de um lead até a conclusão operacional do pedido, passando por vendas, pós-venda, gestão de equipe e integração nativa com WhatsApp.

O sistema opera em ambiente de nuvem (Railway + Supabase) com banco de dados PostgreSQL, suporte a múltiplos funis de captação, pipeline Kanban visual, módulo de Administração de Vendas, comunicação WhatsApp integrada, comissões, metas e geração automática de documentos para o Conta Azul.

---

## 2. Mapa Geral dos Módulos

| Módulo | Objetivo | Principais Funções | Status |
|---|---|---|---|
| **Dashboard** | Indicadores de desempenho | Faturamento, leads, conversão, ranking de vendedores, funil de conversão | ✅ Ativo |
| **Pipeline / CRM** | Gestão visual de leads | Kanban por funil, drag-and-drop, card de lead completo, histórico | ✅ Ativo |
| **Adm. de Vendas** | Pós-venda operacional | Rastreamento do pedido da venda até a entrega, por etapas | ✅ Ativo |
| **Conversas WhatsApp** | Comunicação integrada | Texto, áudio, arquivos — bidirecional pelo CRM | 🔒 Congelado |
| **Funis** | Configuração de origens | CRUD de funis e etapas | ✅ Ativo |
| **Usuários** | Gestão de equipe | Criar, editar, permissões, perfis | ✅ Ativo |
| **Metas** | Metas de vendas | Meta por vendedor, faturamento e outros tipos | ✅ Ativo |
| **Comissões** | Comissionamento | Regras por faixa, salário fixo, bônus por meta | ✅ Ativo |
| **Biblioteca de Mensagens** | Scripts comerciais | Mensagens padrão categorizadas, preview, reordenação | ✅ Ativo |
| **Automações** | Cadências de follow-up | Leads parados, SLA de contato, tags automáticas | ✅ Ativo |
| **Importação** | Carga de leads em massa | Upload de planilha Excel/CSV | ✅ Ativo |
| **Conta Azul** | Envio de dados de venda | Download da ficha, Gmail, cópia de conteúdo | ✅ Ativo |
| **Produtos** | Catálogo de produtos | CRUD de produtos com cor e preço | ✅ Ativo |
| **Logs / Auditoria** | Rastreabilidade | Histórico de todas as ações, lixeira de leads | ✅ Ativo |
| **Backups** | Proteção de dados | Automático diário/semanal/mensal em JSON | ✅ Ativo |
| **Admin** | Ferramentas SUPER_ADMIN | Reset de dados, estatísticas, restauração da lixeira | ✅ Ativo |

---

## 3. Funis e Etapas

### 3.1 Funis Comerciais (com etapas padrão)

Cada funil comercial possui o **mesmo conjunto de 12 etapas** em ordem:

| # | Etapa | Probabilidade | Tipo |
|---|---|---|---|
| 1 | Lead Recebido | 10% | Normal |
| 2 | Contato Realizado | 25% | Normal |
| 3 | Lead Desqualificado | 5% | Perdido |
| 4 | Lead Qualificado SDR | 30% | Normal |
| 5 | Orçamento Enviado | 55% | Normal |
| 6 | Orçamento Aprovado | 70% | Normal |
| 7 | Layout Virtual | 75% | Normal |
| 8 | Amostra Física | 80% | Normal |
| 9 | Amostra Aprovada | 90% | Normal |
| 10 | Follow-Up | 50% | Normal |
| 11 | **Vendas** | 100% | **Ganho** ← Gera venda + clone Adm. |
| 12 | Perdidos | 0% | Perdido |

**Funis comerciais ativos:**

| Funil | Cor | Observação |
|---|---|---|
| Indicação | Verde | Principal canal comercial |
| Instagram - Direct | Rosa | Leads do Direct do Instagram |
| Google Ads | Vermelho | Leads de campanhas Google |
| Meta Ads | Azul Facebook | Leads de campanhas Meta |
| Parcerias | Âmbar | Canal de parceiros |
| WhatsApp | Verde WA | Leads via WhatsApp |
| Site | Roxo | Leads via site |
| Evento | Laranja | Leads de eventos |
| LinkedIn | Azul LinkedIn | Leads profissionais |

---

### 3.2 Carteira Recorrente

Funil especial para gestão de clientes que já compraram e podem comprar novamente.

| # | Etapa | Probabilidade |
|---|---|---|
| 0 | BASE-Antiga | 0% — organização interna, não conta no dashboard |
| 1 | Previsão Carteira 15-30 dias | 10% |
| 2 | Previsão Carteira 30-60 dias | 10% |
| 3 | Previsão Carteira 60-90 dias | 15% |
| 4 | Previsão Carteira 3 - 6 meses | 20% |
| 5 | Previsão Carteira 6 - 9 meses | 20% |
| 6 | Previsão Carteira 9 - 18 meses | 25% |
| 7 | Previsão Carteira +18 meses | 25% |
| 8 | Orçamento Enviado | 55% |
| 9 | Orçamento Aprovado | 70% |
| 10 | Layout Virtual | 75% |
| 11 | Amostra Física | 80% |
| 12 | Amostra Aprovada | 90% |
| 13 | Follow-Up | 50% |
| 14 | **Vendas** | 100% — **Ganho** |

**Regra de entrada:** Clone automático criado pelo Adm. de Vendas ao marcar a venda como "Venda Concluída". A etapa de entrada é definida pela previsão de próxima compra informada pelo operador.

---

### 3.3 Adm. de Vendas

Módulo operacional de pós-venda. Não é um funil comercial — é um painel de acompanhamento de pedidos.

| # | Etapa | Descrição |
|---|---|---|
| 1 | Acompanhamento do Pedido | Entrada automática após venda comercial |
| 2 | Compras / Chegada de Materiais | Aguardando insumos |
| 3 | Produção | Em fabricação |
| 4 | Manuseio | Finalização do produto |
| 5 | Transporte | Em entrega |
| 6 | Venda Concluída | Encerrado — dispara clone para Carteira Recorrente |

---

## 4. Fluxos Comerciais

### Fluxo Principal: Lead → Venda

```
1. Lead entra em qualquer funil comercial (ex: Indicação, Google Ads)
2. Vendedor (ou SDR) atualiza etapa no pipeline (drag-and-drop ou modal)
3. Lead avança pelas etapas: Lead Recebido → Contato → SDR → Orçamento → ...
4. Ao chegar em "Vendas":
   a. Sistema exige campos obrigatórios:
      - Produto (nome + quantidade + valor)
      - Valor total da venda
      - Forma de pagamento
      - CEP de entrega + endereço completo
   b. Venda é registrada (status = GANHO)
   c. Clone automático criado em Adm. de Vendas na etapa "Acompanhamento do Pedido"
   d. Histórico/timeline registrado no lead e no Adm. de Vendas
5. Dashboard atualiza indicadores automaticamente
```

### Fluxo de Perda/Desqualificação

```
- Lead pode ser marcado como "Perdido" em qualquer etapa
- Motivo de perda é registrado no histórico
- Lead sai do pipeline ativo
- Se a perda acontecer ANTES de "Vendas", não gera venda nem clone
- Automação: leads parados > 7 dias podem ser movidos para Perdidos automaticamente
```

---

## 5. Fluxos de Adm. de Vendas

```
1. Venda concluída no pipeline comercial
2. Clone automático criado em "Acompanhamento do Pedido"
   (idempotente: não duplica se já existe card do mesmo lead no mesmo dia)
3. Operador avança o card pelas etapas de produção
   - Via drag-and-drop entre colunas
   - Via modal do card (seleção de etapa + salvar)
4. Ao chegar em "Venda Concluída":
   a. Requer previsão de próxima compra do cliente
   b. Clone criado automaticamente na Carteira Recorrente
      na etapa correspondente à previsão informada
   c. Histórico registrado
5. Card muda status para "concluido" e sai da visão "ativo"
```

---

## 6. Automações Ativas

| Automação | Gatilho | Condição | Ação | Arquivo |
|---|---|---|---|---|
| **Clone → Adm. de Vendas** | Lead movido para etapa "Vendas" (qualquer funil comercial) | Etapa `is_ganho=1` ou nome contém "venda/vendas/ganho/fechamento" | Cria card em `adm_vendas` na etapa "Acompanhamento do Pedido" | `admVendasCloneService.js` |
| **Clone → Carteira Recorrente** | Adm. de Vendas marcado como "Venda Concluída" | Etapa `concluido` + previsão de próxima compra preenchida | Cria lead na Carteira Recorrente na etapa correspondente à previsão | `admVendasController.js` + `leadsController.js` |
| **Stale Leads — Sem resposta** | Rotina automática (a cada hora) | Lead parado > 7 dias em "Contato Realizado" | Move para "Lead Desqualificado" + tag "sem resposta" | `automacaoLeadsService.js` |
| **Stale Leads — Esfriou** | Rotina automática (a cada hora) | Lead parado > 7 dias em "Orçamento Enviado" / "Amostra Física" | Move para "Follow-Up" + tag "esfriou após contato" | `automacaoLeadsService.js` |
| **Stale Leads — Perdido por inatividade** | Rotina automática (a cada hora) | Lead já tagueado reincide (parado > 7 dias novamente) | Move para "Perdidos" + tag "perdido por inatividade" | `automacaoLeadsService.js` |
| **SLA Contato 1** | Criação de lead | Lead novo sem histórico de contato | Envia mensagem automática de boas-vindas via WhatsApp | `automacaoLeadsService.js` |
| **Alerta de Recompra** | Dashboard / API | Data prevista de próxima compra se aproxima | Exibe alerta no CRM para o vendedor | `leadsController.js` |
| **Backup Automático** | Rotina (cron interno) | Diário às 3h, semanal às 2ª feira, mensal dia 1 | Exporta JSON do Supabase para `data/backups/` | `backupService.js` |
| **Seed de Funis/Produtos** | Startup do servidor | Banco vazio | Cria funis, etapas e produtos padrão | `funisController.js`, `produtosController.js` |
| **Migração de Dados Históricos** | Startup do servidor | Execução única (idempotente) | Migra dados de etapa para `lead_timeline` e `lead_etapa_historico` | `etapaHistoricoService.js` |

---

## 7. Integrações

| Integração | Objetivo | Status | Variáveis de Ambiente |
|---|---|---|---|
| **WhatsApp / Evolution API** | Envio e recebimento de mensagens, áudios e arquivos | 🔒 Congelado e Funcionando | `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE_NAME`, `WHATSAPP_OFFICIAL_NUMBER`, `WHATSAPP_WEBHOOK_SECRET` |
| **Supabase** | Banco de dados PostgreSQL + Storage de mídias | ✅ Ativo | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| **Railway** | Plataforma de deploy e hospedagem | ✅ Ativo | `RAILWAY_PUBLIC_DOMAIN`, `APP_URL` |
| **Conta Azul** | Envio de fichas de venda para lançamento | ✅ Ativo (fluxo manual) | Configurado via tela de destinatários |
| **CEP / ViaCEP + BrasilAPI** | Consulta automática de endereço por CEP | ✅ Ativo | Nenhuma (APIs públicas) |
| **Gmail** | Abertura de e-mail pré-preenchido (Conta Azul) | ✅ Ativo (fluxo manual) | `GMAIL_USER` (para referência) |

---

## 8. WhatsApp — Módulo Congelado

> ⚠️ **ESTE MÓDULO ESTÁ CONGELADO. NÃO ALTERAR SEM AUTORIZAÇÃO EXPLÍCITA DO SUPER ADMIN.**

### Funcionalidades Implementadas e Funcionando

| Funcionalidade | Status |
|---|---|
| Envio de mensagem de texto pelo CRM | ✅ Funcionando |
| Recebimento de mensagem de texto no CRM | ✅ Funcionando |
| Envio de áudio pelo CRM | ✅ Funcionando |
| Recebimento de áudio no CRM | ✅ Funcionando |
| Reprodução de áudio diretamente no CRM | ✅ Funcionando |
| Envio de arquivo/documento pelo CRM | ✅ Funcionando |
| Recebimento de arquivo/documento/imagem no CRM | ✅ Funcionando |
| Abertura/download do arquivo recebido | ✅ Funcionando |
| Conversa vinculada ao lead correto | ✅ Funcionando |
| Envio e recebimento dentro da mesma conversa | ✅ Funcionando |

### Arquitetura

- **Integração:** Evolution API (v2)
- **Webhook:** `POST /api/whatsapp/webhook` — recebe eventos em tempo real
- **Storage de mídias:** Bucket `whatsapp-midias` no Supabase Storage
- **Resolução de alias/LID:** `whatsapp_conversa_aliases` — associa JIDs alternativos ao lead
- **Normalização de telefone:** Função interna que padroniza formatos BR (55 + DDD + número)

### Arquivos Congelados

- `src/controllers/whatsappController.js`
- `src/controllers/whatsappAudioController.js`
- `src/services/evolutionApiService.js`
- `public/js/whatsapp.js`
- `public/js/whatsapp-audio.js`
- `public/whatsapp.html`
- Bucket: `whatsapp-midias`
- Tabelas: `conversas_whatsapp`, `mensagens_whatsapp`, `whatsapp_conversa_aliases`

---

## 9. Card do Lead — Abas e Campos

### Aba 1 — Dados

| Campo | Obrigatório | Descrição |
|---|---|---|
| Nome | ✅ | Nome do cliente/lead |
| Empresa | — | Razão social ou nome comercial |
| Telefone | — | Usado para abrir conversa WhatsApp |
| E-mail | — | E-mail do cliente |
| CNPJ | — | Documento fiscal |
| Origem | — | Canal de entrada (funil) |
| Tags | — | Etiquetas livres |
| Responsável | — | Vendedor responsável |

### Aba 2 — Informações

| Campo | Descrição |
|---|---|
| Observações | Anotações livres sobre o lead |
| Histórico/Timeline | Linha do tempo de todos os eventos (etapas, notas, vendas, clones) |
| Atividades | Tarefas/compromissos vinculados ao lead |

### Aba 3 — Venda

| Campo | Obrigatório para Ganho | Descrição |
|---|---|---|
| Produto(s) | ✅ | Multi-produto: nome, quantidade, valor unitário |
| Valor total | ✅ | Soma automática dos produtos |
| Forma de pagamento | ✅ | Ex: PIX, boleto, cartão, parcelado |
| Quantidade de parcelas | — | Para pagamento parcelado |
| CEP de entrega | ✅ | 8 dígitos — busca automática de endereço |
| Logradouro / Rua | ✅ | Preenchido automaticamente pelo CEP |
| Número | ✅ | Número do endereço |
| Complemento | — | Opcional |
| Referência | — | Opcional |
| Bairro | ✅ | Preenchido automaticamente |
| Cidade | ✅ | Preenchida automaticamente |
| UF | — | Estado |
| Previsão de próxima compra | — | Usada ao concluir venda no Adm. (define etapa na Carteira) |

### Aba 4 — Produção

| Campo | Descrição |
|---|---|
| Data de Layout Virtual Aprovado | Registrada automaticamente quando chega na etapa "Layout Virtual" |
| Data de início de produção | Manual |
| Data de entrega prevista | Manual |
| Quantidade | Quantidade do pedido |
| Anotações | Notas de produção |

### Aba 5 — Arquivos

- Upload de arquivos anexados ao lead (PDF, imagens, documentos)
- Download/visualização de arquivos
- Possibilidade de vincular arquivo diretamente à produção
- Arquivos recebidos via WhatsApp aparecem automaticamente aqui

### Aba 6 — Conta Azul

- Compilação automática dos dados da venda em um documento estruturado
- 4 ações disponíveis:
  1. **Abrir Gmail** — abre o cliente Gmail com destinatários, assunto e corpo pré-preenchidos
  2. **Baixar ficha (.txt)** — download do documento completo
  3. **Copiar conteúdo** — copia para a área de transferência
  4. **Marcar como enviado** — registra no histórico

---

## 10. Regras de Venda

### Campos obrigatórios para mover lead para "Vendas"

1. **Produto** — ao menos 1 produto com nome, quantidade > 0 e valor > 0
2. **Valor da venda** — total calculado automaticamente, deve ser > 0
3. **Forma de pagamento** — não pode ficar em branco
4. **Endereço de entrega completo:**
   - CEP (8 dígitos)
   - Logradouro/rua
   - Número
   - Bairro
   - Cidade

> Campos opcionais: complemento, referência, UF

### Validação de bloqueio

- O sistema bloqueia o movimento para "Vendas" se qualquer campo obrigatório estiver faltando
- Retorna lista de `campos_faltando` para o usuário corrigir
- Bloqueio aplicado tanto no drag-and-drop quanto na seleção de etapa pelo modal

### Efeitos da venda registrada

1. Lead: `status = GANHO`, `ganho_em = NOW()`
2. Timeline do lead: evento "VENDA_REGISTRADA" com valor e forma de pagamento
3. Adm. de Vendas: clone criado automaticamente (idempotente por dia)
4. Dashboard: faturamento e taxa de conversão atualizados

---

## 11. Dashboard e Indicadores

### Indicadores do Painel Principal

| Indicador | Origem | Filtros disponíveis |
|---|---|---|
| Total de leads | Tabela `leads` | Período, funil, vendedor |
| Leads ganhos (vendas) | `status = GANHO` | Período, funil, vendedor |
| Leads perdidos | `status = PERDIDO` | Período, funil, vendedor |
| Leads abertos | Status ativo | Período, funil, vendedor |
| Faturamento total | Soma de `valor_venda` nos ganhos | Período, funil, vendedor |
| Ticket médio | Faturamento ÷ Ganhos | Período, funil, vendedor |
| Taxa de conversão | (Ganhos ÷ Total) × 100 | Período, funil, vendedor |
| Ranking de vendedores | Por faturamento e ganhos | Período |
| Funil de conversão | Leads por etapa | Funil |
| Atividades pendentes | Tabela `atividades` | Por usuário |
| Alertas de recompra | `previsao_proxima_compra` | Próximos vencimentos |

### KPIs do Adm. de Vendas (tela própria)

- Total de cards ativos
- Faturamento dos ativos
- Cards concluídos
- Cards em produção
- Filtros: etapa, responsável, período, status

### Período de análise do Dashboard

- Tipos: `criado_em`, `ganho_em`, `perdido_em`
- Filtros: hoje, semana, mês, trimestre, semestre, ano, personalizado

---

## 12. Usuários e Permissões

### Perfis disponíveis

| Perfil | Nível | Descrição |
|---|---|---|
| `SUPER_ADMIN` | 3 | Acesso total. Único que pode executar ações administrativas destrutivas |
| `GESTOR` | 2 | Vê todos os leads, pode transferir leads, editar salários, criar motivos de perda |
| `SDR` | 2 | Mesmo nível que GESTOR mas focado em qualificação. Vê todos os leads |
| `VENDEDOR` | 1 | Vê apenas seus próprios leads. Não pode voltar etapa, não pode deletar |

### Restrições por perfil

| Ação | SUPER_ADMIN | GESTOR | SDR | VENDEDOR |
|---|---|---|---|---|
| Ver todos os leads | ✅ | ✅ | ✅ | ❌ (só os seus) |
| Transferir lead | ✅ | ✅ | ❌ | ❌ |
| Deletar lead | ✅ | ❌ | ❌ | ❌ |
| Criar regras de comissão | ✅ | ❌ | ❌ | ❌ |
| Editar salário | ✅ | ✅ | ❌ | ❌ |
| Criar motivos de perda | ✅ | ✅ | ❌ | ❌ |
| Voltar etapa anterior no Adm. Vendas | ✅ | ✅ | ❌ | ❌ |
| Acessar logs de auditoria | ✅ | ✅ | ❌ | ❌ |
| Executar reset de dados | ✅ | ❌ | ❌ | ❌ |
| Gerenciar produtos | ✅ | ✅ | ❌ | ❌ |
| Configurar integração WhatsApp | ✅ | ❌ | ❌ | ❌ |
| Fazer backup manual | ✅ | ❌ | ❌ | ❌ |

---

## 13. Metas, Comissões e Salários

### Metas

- Configuradas por tipo: `FATURAMENTO`, `LEADS`, `GANHOS`, `CONVERSÃO`
- Por período: mensal, semanal, etc.
- Vinculadas a vendedor específico ou equipe
- Usadas para calcular bônus nas comissões
- Tela: `metas.html`

### Comissões

- Regras configuradas por faixas de valor de venda
- Podem ser específicas por vendedor ou por funil
- Percentual de comissão variável por faixa
- **Bônus por meta:** percentual adicional quando a meta de faturamento é atingida
- **Salário fixo:** configurado por usuário, somado à comissão
- **Total a receber = salário fixo + comissão + bônus de meta**
- Tela: `comissoes.html`

### Salários

- Campo `salario_fixo` no cadastro de usuário
- Editável por GESTOR ou SUPER_ADMIN
- Exibido no painel de comissões

---

## 14. Conta Azul

### Objetivo

Facilitar o envio das informações da venda para os responsáveis pelo lançamento no sistema financeiro Conta Azul.

### Fluxo implementado (manual)

1. Usuário abre a aba "Conta Azul" no card do lead
2. CRM compila automaticamente todos os dados da venda:
   - Cliente, empresa, CNPJ
   - Produto(s), quantidade, valores
   - Forma de pagamento, parcelas
   - Endereço de entrega
   - Vendedor responsável
3. Usuário tem 4 opções:
   - **Abrir Gmail** — abre Gmail web com destinatários, assunto e corpo pré-preenchidos
   - **Baixar ficha (.txt)** — arquivo com todos os dados formatados
   - **Copiar conteúdo** — copia para área de transferência
   - **Marcar como enviado** — registra no histórico do lead

> **Observação:** O CRM não envia o e-mail automaticamente. O envio é manual pelo usuário.

### Destinatários

Configurados pelo SUPER_ADMIN na tela de Conta Azul. Múltiplos e-mails suportados.

---

## 15. Arquivos e Produção

### Upload de arquivos no card do lead

- Arquivos enviados pelo WhatsApp aparecem automaticamente no lead
- Upload manual de qualquer arquivo (PDF, imagem, planilha, etc.)
- Download e visualização pelo CRM
- Possibilidade de vincular arquivo à produção do pedido

### Aba Produção

Campos específicos para controle de fabricação do pedido:

| Campo | Tipo | Observação |
|---|---|---|
| Data de layout virtual aprovado | Automático | Preenchido ao atingir etapa "Layout Virtual" |
| Data de início de produção | Manual | Informada pelo operador |
| Data de entrega | Manual | Previsão de entrega |
| Quantidade | Número | Quantidade do pedido |
| Anotações | Texto livre | Notas de produção |

---

## 16. Tabelas e Rotas Principais

### Tabelas operacionais (principais)

| Tabela | Finalidade |
|---|---|
| `leads` | Lead principal — todos os dados do cliente |
| `lead_produtos` | Produtos vinculados ao lead (multi-produto) |
| `lead_producao` | Dados de produção do pedido |
| `lead_arquivos` | Arquivos anexados ao lead |
| `lead_timeline` | Histórico visual de eventos do lead |
| `lead_etapa_historico` | Histórico de movimentações de etapa |
| `adm_vendas` | Cards de pós-venda operacional |
| `adm_vendas_historico` | Histórico de cada card do Adm. de Vendas |
| `conversas_whatsapp` | Conversas do WhatsApp |
| `mensagens_whatsapp` | Mensagens individuais |
| `whatsapp_conversa_aliases` | Mapeamento de JIDs/aliases de conversas |
| `usuarios` | Contas de acesso ao CRM |
| `funis` | Configuração dos funis |
| `etapas` | Etapas de cada funil/pipeline |
| `pipelines` | Associa funil a pipeline visual |
| `produtos` | Catálogo de produtos |
| `metas` | Metas de vendedores |
| `comissao_regras` | Regras de comissionamento |
| `comissoes` | Registros de comissão gerados |
| `atividades` | Tarefas/compromissos vinculados a leads |
| `mensagens_padrao` | Biblioteca de scripts/mensagens |
| `motivos_perda` | Motivos cadastrados para perda de lead |
| `conta_azul_emails_enviados` | Registro de fichas enviadas ao Conta Azul |
| `config_email_conta_azul` | Destinatários de e-mail do Conta Azul |
| `logs` | Log de auditoria de todas as ações |
| `importacoes_leads` | Importações de planilha realizadas |

### Rotas principais por módulo

| Módulo | Método | Endpoint | Função |
|---|---|---|---|
| Auth | POST | `/api/auth/login` | Login |
| Auth | POST | `/api/auth/refresh` | Renovar token |
| Auth | GET | `/api/auth/me` | Dados do usuário logado |
| Leads | GET | `/api/leads` | Listar leads |
| Leads | POST | `/api/leads` | Criar lead |
| Leads | PATCH | `/api/leads/:id/mover` | Mover etapa |
| Leads | GET | `/api/leads/:id/historico` | Histórico do lead |
| Adm. Vendas | GET | `/api/adm-vendas` | Listar cards |
| Adm. Vendas | PATCH | `/api/adm-vendas/:id/etapa` | Mover etapa |
| Dashboard | GET | `/api/dashboard/resumo` | Indicadores gerais |
| WhatsApp | POST | `/api/whatsapp/webhook` | Receber eventos |
| WhatsApp | POST | `/api/whatsapp/audio/send` | Enviar áudio |
| CEP | GET | `/api/cep/:cep` | Consultar endereço |
| Admin | POST | `/api/admin/reset-dados-teste` | Reset controlado |

---

## 17. Funcionalidades Congeladas

| Funcionalidade | Motivo | Arquivos envolvidos |
|---|---|---|
| WhatsApp — texto, áudio, arquivos | Funcionando corretamente. Qualquer alteração pode quebrar a comunicação. | `whatsappController.js`, `whatsappAudioController.js`, `evolutionApiService.js`, `whatsapp.js`, `whatsapp-audio.js` |
| Regra de clone → Adm. de Vendas | Funcionando corretamente. Cria automaticamente o card operacional. | `admVendasCloneService.js`, `leadsController.js` |
| Regra de clone → Carteira Recorrente | Funcionando corretamente. Dispara após "Venda Concluída" no Adm. | `admVendasController.js`, `leadsController.js` |
| Tabelas WhatsApp no banco | Estrutura de conversas estável. | `conversas_whatsapp`, `mensagens_whatsapp`, `whatsapp_conversa_aliases` |

**Documento de referência:** `docs/WHATSAPP_ESTAVEL_CONGELADO.md`

---

## 18. Pontos de Atenção

| Ponto | Descrição | Risco |
|---|---|---|
| Planilha de leads | Polling da planilha está desativado (comentado no código). Importação funciona apenas pelo upload manual. | Baixo — funcionalidade opcional |
| SLA Contato 1 | Automação configurada mas depende de WhatsApp conectado e número configurado. | Médio — requer validação |
| Automações de leads parados | Rodam a cada hora. Se o WhatsApp estiver desconectado, o SLA pode falhar silenciosamente. | Médio |
| Funil "Tráfego Pago" | Existia anteriormente, foi inativado. Pode existir no banco como inativo. | Baixo |
| SQLite (fallback) | Sistema suporta SQLite para desenvolvimento local. Em produção usa apenas Supabase. | Nenhum |

---

## 19. Conclusão

O **CRM Prospekt** é um sistema robusto, personalizado e operando em produção com os seguintes destaques:

- **10 funis de captação** com etapas padronizadas e regras automáticas
- **Pipeline visual Kanban** com drag-and-drop e validação de venda
- **WhatsApp bidirecional** integrado nativamente (texto, áudio, arquivos)
- **Adm. de Vendas** como módulo de pós-venda com rastreamento até a entrega
- **Carteira Recorrente** para recompra automatizada e gerenciada
- **Comissões e metas** com cálculo automático por faixas e bônus
- **Backup automático** diário, semanal e mensal
- **Permissões granulares** por perfil de usuário
- **Auditoria completa** de todas as ações

**A partir de 2026-08-14, o CRM opera com dados reais.**
