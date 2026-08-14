# VERSÃO OFICIAL — INÍCIO DA OPERAÇÃO REAL
## PROSPEKT CRM — Prospekt Personalizados

---

## Identificação

| Campo | Valor |
|---|---|
| **Sistema** | PROSPEKT CRM |
| **Versão** | 1.0.0 — Operação Real |
| **Data do reset** | 2026-08-14 |
| **Hora (BRT)** | ~18h30 |
| **Executado por** | SUPER_ADMIN |
| **Ambiente** | Railway + Supabase (Produção) |

---

## Declaração

> **A partir desta data, todos os dados inseridos no CRM são REAIS.**
>
> Todos os registros anteriores a esta data eram dados de teste e foram zerados/arquivados conforme procedimento documentado neste arquivo.
>
> Esta versão é considerada **OFICIAL, ESTÁVEL E EM OPERAÇÃO REAL**.

---

## O que foi zerado (dados de teste)

| Tabela | Ação | Finalidade |
|---|---|---|
| `leads` | Soft delete (`deleted_at + status=arquivado`) | Leads de teste invisíveis na UI |
| `adm_vendas` | Soft cancel (`status=cancelado`) | Cards Adm. de Vendas de teste invisíveis |
| `adm_vendas_historico` | Hard delete | Histórico de teste removido |
| `conta_azul_emails_enviados` | Hard delete | Registros de e-mail de teste removidos |
| `comissoes` | Hard delete | Comissões de teste removidas |
| `atividades` | Hard delete | Atividades de teste removidas |
| `importacoes_leads` | Hard delete | Importações de teste removidas |

> Um backup JSON completo foi criado em `data/backups/reset-dados-teste-*.json` antes da limpeza.

---

## O que foi preservado (estrutura permanente)

| Componente | Status |
|---|---|
| Funis e etapas do pipeline | ✅ Preservados |
| Produtos | ✅ Preservados |
| Usuários e permissões | ✅ Preservados |
| Regras de comissão | ✅ Preservadas |
| Metas configuradas | ✅ Preservadas |
| Biblioteca de mensagens | ✅ Preservada |
| Configurações de e-mail (Conta Azul) | ✅ Preservadas |
| Configurações visuais | ✅ Preservadas |
| Integrações | ✅ Preservadas |

---

## Status das funcionalidades congeladas

### 🔒 WhatsApp — CONGELADO E FUNCIONAL

| Funcionalidade | Status |
|---|---|
| Envio de mensagem de texto | ✅ Funcionando |
| Recebimento de mensagem de texto | ✅ Funcionando |
| Envio de áudio | ✅ Funcionando |
| Recebimento de áudio | ✅ Funcionando |
| Reprodução de áudio no CRM | ✅ Funcionando |
| Envio de arquivo/documento pelo CRM | ✅ Funcionando |
| Recebimento de arquivo/documento/imagem | ✅ Funcionando |
| Exibição e download de arquivo no CRM | ✅ Funcionando |
| Conversa correta do lead | ✅ Funcionando |

**Arquivos congelados (NÃO ALTERAR SEM AUTORIZAÇÃO EXPLÍCITA):**
- `src/controllers/whatsappController.js`
- `src/controllers/whatsappAudioController.js`
- `public/js/whatsapp.js`
- `public/js/whatsapp-audio.js`
- `src/services/evolutionApiService.js`
- Bucket `whatsapp-midias`

---

### 🔒 Regra de Clone para Adm. de Vendas — CONGELADA E FUNCIONAL

> Quando qualquer lead chegar na etapa `Vendas` em qualquer funil (exceto no próprio `Adm. de Vendas`), o lead é clonado automaticamente para `Adm. de Vendas` na etapa `Acompanhamento do Pedido`.

**Função congelada:** `clonarDeLeadGanho()` em `admVendasController.js`

---

### 🔒 Movimentação de Cards no Adm. de Vendas — CORRIGIDA E FUNCIONAL

Cards podem ser movidos por:
- Drag-and-drop entre colunas
- Seleção de etapa dentro do card/modal

Etapas: Acompanhamento do Pedido → Compras / Chegada de Materiais → Produção → Manuseio → Transporte → Venda Concluída

---

## Regra para novos dados

> **TODOS os leads, vendas e registros criados a partir desta data são DADOS REAIS.**
>
> Não criar mais leads de teste no ambiente de produção.
>
> Para testes, utilizar ambiente separado ou criar lead com nome claramente identificado como teste (ex: "TESTE — NÃO USAR").

---

## Procedimento de reset (documentação técnica)

Para executar um novo reset no futuro (se necessário):

```
POST /api/admin/reset-dados-teste
Authorization: Bearer <token SUPER_ADMIN>
Content-Type: application/json

{
  "confirmacao": "RESETAR_DADOS_DE_TESTE_CRM"
}
```

**Pré-requisitos:**
- Usuário autenticado com role `SUPER_ADMIN`
- Confirmação exata no body
- Backup automático criado antes de qualquer limpeza

---

*Documento gerado automaticamente pelo PROSPEKT CRM em 2026-08-14.*
*Qualquer alteração neste documento deve ser feita manualmente e com registro de data.*
