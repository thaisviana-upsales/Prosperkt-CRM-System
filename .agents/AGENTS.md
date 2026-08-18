# Prosperkt CRM — Regras de Proteção do Agente

## ⚠️ VERSÃO ESTÁVEL BLOQUEADA

**Tag git:** `v-stable-whatsapp-instagram-direct-2026-08-18`
**Commit:** `6d8a367`
**Data:** 2026-08-18

Esta versão foi confirmada pelo usuário como funcionando corretamente.

---

## 🔒 BLOCOS PROTEGIDOS — NÃO ALTERAR SEM AUTORIZAÇÃO EXPLÍCITA

### WhatsApp — Envio (BLOQUEADO)
Os seguintes fluxos estão funcionando e NÃO podem ser alterados:
- Envio de mensagem de texto
- Envio de áudio
- Envio de arquivos/imagens
- Qualquer lógica nos endpoints `POST /api/whatsapp/conversas/:id/mensagens`

### WhatsApp — Recebimento de leads existentes (BLOQUEADO)
- Fluxo de recebimento de texto para leads já cadastrados no CRM
- Fluxo de recebimento de áudio para leads já cadastrados
- Fluxo de recebimento de arquivos para leads já cadastrados
- Player de áudio (frontend e backend)
- Download de mídias do bucket `whatsapp-midias`

### Infraestrutura (BLOQUEADO)
- `src/services/evolutionApiService.js` — NÃO alterar sem autorização explícita
- Variáveis de ambiente (`.env`, Railway vars): `WHATSAPP_OFFICIAL_NUMBER`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE`
- Bucket `whatsapp-midias` no Supabase Storage

### Frontend WhatsApp (BLOQUEADO)
- `public/js/whatsapp.js` — NÃO alterar sem autorização explícita
- Player de áudio no frontend

---

## ✅ COMPORTAMENTO ATUAL FUNCIONAL DOCUMENTADO

### Número desconhecido manda mensagem inbound:
1. Sistema cria lead automaticamente no funil **"Instagram - Direct"**
2. Etapa: **"Lead Recebido"**
3. Nome do lead: telefone formatado (`+55 11 99999-9999`) — NUNCA pushName
4. Conversa criada como ABERTA (visível no CRM)
5. Próximas mensagens do mesmo número caem na mesma conversa

### Identificação de conversa existente — SOMENTE por:
- Alias LID/JID exato (tabela `whatsapp_conversa_aliases`)
- telefone normalizado exato
- lead_id vinculado
- remoteJid exato

### PROIBIDO correlacionar por:
- nome do contato
- pushName
- empresa
- heurística de candidata única
- último envio recente (exceto fallback legado — não remover sem teste)

---

## 🚫 HEURÍSTICOS DESATIVADOS (NÃO REATIVAR)

| Heurístico | Status | Motivo |
|---|---|---|
| Candidata única (`semLid.length === 1`) | DESATIVADO | Causava mensagens erradas em conversas |
| Correlação por nome_contato (Step 6) | DESATIVADO | Causava roteamento incorreto |
| Step 5 Evolution API sem lead_id | BLOQUEADO | Exige `.not('lead_id','is',null)` |

---

## 📋 REGRAS PARA FUTURAS ALTERAÇÕES

1. **Antes de alterar qualquer arquivo de WhatsApp**, confirmar com o usuário qual fluxo específico pode ser tocado.
2. **Sempre fazer git tag** antes de iniciar mudanças significativas.
3. **Nunca alterar** `evolutionApiService.js` sem autorização explícita do usuário.
4. **Nunca alterar** o fluxo de envio (`POST /mensagens`) sem autorização explícita.
5. **Para reverter** para esta versão estável: `git checkout v-stable-whatsapp-instagram-direct-2026-08-18`
