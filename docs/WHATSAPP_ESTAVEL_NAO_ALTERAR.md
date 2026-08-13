# WhatsApp CRM — Versão Estável Congelada

Data de congelamento: 12/08/2026
Commit estável: 3efa4df — "docs: registra versão estável do WhatsApp — congelamento 12/08/2026"
Status: FUNCIONANDO
Instância: Prospekt_v3
Número oficial atual: 5511987994910

---

## ⛔ REGRA ABSOLUTA

**Não alterar sem autorização explícita da Thais:**

- envio de texto WhatsApp
- recebimento de texto WhatsApp
- webhook WhatsApp
- Evolution API
- instância Prospekt_v3
- QR Code
- resolver de conversa
- alias LID
- normalização de telefone
- conversa_id
- seleção de conversa
- `public/js/whatsapp.js`
- `src/controllers/whatsappController.js`
- API de conversas
- API de mensagens WhatsApp

---

## ✅ Estado confirmado nesta versão

- CRM envia mensagem de texto ✅
- WhatsApp recebe ✅
- Cliente responde ✅
- CRM recebe a resposta ✅
- Resposta aparece na **mesma conversa** ✅
- Não duplica conversa ✅
- Não cria conversa LID oculta ✅
- Leads novos abrem conversa corretamente ✅

---

## 🧪 Testes obrigatórios antes de qualquer alteração futura

Antes de qualquer commit que toque em WhatsApp, validar:

1. CRM envia texto.
2. WhatsApp recebe texto.
3. Cliente responde.
4. CRM recebe a resposta.
5. Resposta aparece na mesma conversa.
6. Não cria conversa duplicada.
7. Não cria conversa LID oculta.
8. Lead novo abre conversa corretamente.

**Sem esses 8 testes passando, não há autorização para merge/deploy.**

---

## 📋 Regra para novas funcionalidades

Áudio, imagem, mídia, layout, scripts ou qualquer melhoria futura **deve ser implementada sem tocar no fluxo de texto estável**.

Se uma alteração quebrar texto, **ela deve ser revertida imediatamente**.

Para verificar arquivos sensíveis antes de qualquer deploy, rodar:

```bash
npm run check:whatsapp
```

---

## 🏷️ Tag da versão estável

```bash
git tag whatsapp-texto-estavel-2026-08-12
git push origin whatsapp-texto-estavel-2026-08-12
```

---

## ⚙️ Arquivos críticos protegidos

| Arquivo | Função |
|---|---|
| `src/controllers/whatsappController.js` | Webhook, envio, recebimento, resolver |
| `public/js/whatsapp.js` | Frontend da tela Conversas |
| `src/routes/whatsapp.js` | Rotas da API |
| `src/services/evolutionApiService.js` | Comunicação com Evolution API |
| `src/services/whatsappService.js` | Serviço WhatsApp |
