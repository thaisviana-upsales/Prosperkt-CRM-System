# Checklist obrigatório — WhatsApp

> Execute antes de qualquer commit/push/deploy que toque em arquivos de WhatsApp.

---

## Pergunta de bloqueio

Responda SIM ou NÃO para cada item:

- [ ] Alterei `public/js/whatsapp.js`?
- [ ] Alterei `src/controllers/whatsappController.js`?
- [ ] Alterei rotas de WhatsApp (`src/routes/whatsapp.js`)?
- [ ] Alterei webhook (endpoint ou lógica de recebimento)?
- [ ] Alterei normalização de telefone (`normalizePhone`, `normalizePhoneBR`)?
- [ ] Alterei resolver de conversa (`resolverConversa`, `buscarOuCriarConversa`)?
- [ ] Alterei alias LID (`registrarAlias`, `whatsapp_conversa_aliases`)?
- [ ] Alterei envio de mensagem (`enviarMensagem`, `enviarTexto`, `enviarAudio`)?
- [ ] Alterei recebimento de mensagem (`webhookReceberMensagem`)?
- [ ] Alterei `src/services/evolutionApiService.js`?

---

## Se qualquer resposta for SIM → executar teste manual obrigatório

### Roteiro de teste (em ordem):

1. Abrir o CRM em produção.
2. Selecionar uma conversa de lead real.
3. **Enviar texto** pelo CRM.
4. **Confirmar** que o WhatsApp do lead recebeu.
5. **Responder** pelo WhatsApp.
6. **Confirmar** que a resposta apareceu no CRM.
7. **Confirmar** que apareceu na **mesma conversa** (não criou duplicata).
8. **Confirmar** que não criou conversa LID oculta (verificar lista de conversas).

### Resultado esperado:

- ✅ Texto enviado
- ✅ Texto recebido pelo WhatsApp
- ✅ Resposta chegou no CRM
- ✅ Mesma conversa — sem duplicata
- ✅ Sem conversa LID oculta

**Se qualquer item falhar → reverter imediatamente e abrir issue.**

---

## Comando de verificação rápida

```bash
npm run check:whatsapp
```

---

## Referência

- Commit estável: `3efa4df`
- Tag: `whatsapp-texto-estavel-2026-08-12`
- Documento de proteção: `docs/WHATSAPP_ESTAVEL_NAO_ALTERAR.md`
