# WhatsApp CRM — Versão Estável Congelada

Data: 12/08/2026
Status: **Estável**
Instância: Prospekt_v3
Número oficial atual: 5511987994910

---

## Funcionalidades confirmadas

- Envio de mensagem pelo CRM funcionando.
- Recebimento de mensagem pelo CRM funcionando.
- Mensagens enviadas e recebidas aparecem na mesma conversa.
- Leads novos conseguem abrir conversa.
- Resposta do cliente não duplica conversa.
- Resposta do cliente não fica mais presa em conversa LID oculta.
- Lista lateral e painel da conversa usam a mesma conversa_id.

---

## Commits desta versão estável

| Commit   | Descrição |
|----------|-----------|
| 3f7dd19  | fix: corrige 3 falhas no resolverConversa — Passo 2 e Passo 6 |
| a5d47c5  | fix: recebimento — fallback por envio recente + logs diagnóstico |
| 78161e8  | fix(pipeline): restaura renderKanban + botão WA em leads órfãos |
| d17e576  | fix(webhook): telefone NOT NULL + candidata ambígua — descarte silencioso |

---

## Regra de proteção

NÃO ALTERAR sem autorização explícita:

- Evolution API
- QR Code
- Instância Prospekt_v3
- Webhook WhatsApp (/api/whatsapp/webhook)
- Autenticação webhook (WEBHOOK_SECRET)
- Envio de mensagem (enviarMensagem, enviarTexto, enviarMidia)
- Recebimento de mensagem (webhookReceberMensagem)
- Resolver de conversa (resolverConversaWhatsapp)
- Alias LID (registrarAlias, tabela whatsapp_conversa_aliases)
- Normalização de telefone (normalizePhoneBR, normalizePhone)
- Seleção de conversa_id no frontend
- Tela Conversas (whatsapp.html, whatsapp.js)
- API de mensagens (/api/whatsapp/mensagens)
- Lógica de conversa canônica

---

## Regra para futuras alterações

Qualquer nova funcionalidade (áudio, imagem, anexos, scripts) deve ser implementada
de forma isolada, sem alterar o fluxo de texto já funcional.

### Checklist obrigatório antes de qualquer mudança futura

1. Envio de texto pelo CRM funciona.
2. Recebimento de texto pelo WhatsApp funciona.
3. Mensagem recebida aparece na mesma conversa (não em PENDENTE_IDENTIFICACAO).
4. Não cria conversa duplicada.
5. Não salva em conversa LID oculta (visivel=false).
6. Número oficial (5511987994910) não aparece como contato de cliente.
7. LID não vira telefone de lead.

---

## Arquitetura do fluxo (referência)

Evolution API (Prospekt_v3)
  → MESSAGES_UPSERT
CRM Webhook (/api/whatsapp/webhook)
  → validação WEBHOOK_SECRET
normalizarPayloadWA()         — extrai tel, LID, fromMe, conteudo
normalizePhoneBR(remoteJid)   — retorna null para LID, oficial, timestamp
  →
resolverConversaWhatsapp()
  Passo 0: alias_remote_jid / alias_lid / alias_telefone
  Passo 1: LID em dados_extras (LIKE + JSONB)
  Passo 1b: fallback por mensagem enviada recente (72h) — candidata mais recente
  Passo 2: conversa por lead_id (ABERTA, não FECHADA, não PENDENTE)
  Passo 4: conversa por telefone normalizado
  Passo 7: PENDENTE_IDENTIFICACAO como último recurso
  →
INSERT mensagens_whatsapp (com conversa_id resolvido)

---

## Proteção de LID

- LID: identificador interno WhatsApp Multi-Device (ex: 205445599911955@lid)
- Regra: 14+ dígitos sem prefixo 55 → rejeitado como telefone real
- Nunca salvo como telefone de conversa ABERTA
- PENDENTE_IDENTIFICACAO usa telefone='LID:NUMERO' e visivel=false
- Tabela whatsapp_conversa_aliases vincula LID → conversa_id canônica

---

Documento gerado em 12/08/2026 após validação de ponta a ponta do fluxo.
