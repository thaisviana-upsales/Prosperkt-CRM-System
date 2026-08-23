# Prosperkt CRM — Regras de Proteção do Agente

## ⚠️ VERSÃO ESTÁVEL BLOQUEADA

**Tag git:** `v-stable-whatsapp-enviando-2026-08-21`
**Commit:** `d0d0653`
**Data:** 2026-08-21

Esta versão foi confirmada com envio e recebimento funcionando (HTTP 201 confirmado para Ani NWB).

**Tag anterior:** `v-stable-whatsapp-instagram-direct-2026-08-18` (commit `6d8a367`)

---

## 🚫 INSTÂNCIA EVOLUTION API — PROTEÇÃO ABSOLUTA

**Instância ativa:** `Prospekt_v3`
**Status confirmado:** Conectada e enviando mensagens (2026-08-21 17:24)
**Webhook configurado:** `https://prosperkt-crm-system-production.up.railway.app/api/whatsapp/webhook`

### PROIBIDO — NUNCA EXECUTAR SEM AUTORIZAÇÃO EXPLÍCITA DO USUÁRIO:
- `DELETE /instance/logout/Prospekt_v3`
- `DELETE /instance/delete/Prospekt_v3`
- `POST /instance/create` (criar nova instância)
- Qualquer chamada que modifique ou remova a instância `Prospekt_v3`
- Qualquer curl ou script que chame os endpoints acima

### PROIBIDO — NUNCA ALTERAR:
- `EVOLUTION_API_KEY` no Railway (valor: `92b30e1kk99k4kd874k0n`)
- `EVOLUTION_INSTANCE` no Railway (valor: `Prospekt_v3`)
- A configuração do webhook da instância

### SE A SESSÃO PARECER QUEBRADA:
1. Verificar connectionState via curl APENAS para diagnóstico
2. NUNCA fazer logout automaticamente
3. NUNCA recriar a instância sem autorização explícita
4. Reportar ao usuário e aguardar instrução

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
