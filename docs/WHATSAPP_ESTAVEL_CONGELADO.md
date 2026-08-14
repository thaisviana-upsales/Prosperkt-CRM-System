# 🔒 WHATSAPP ESTÁVEL — VERSÃO CONGELADA

> **ATENÇÃO:** Este arquivo documenta o congelamento oficial da integração WhatsApp do CRM Prospekt.
> Qualquer alteração nos arquivos listados abaixo requer autorização explícita da usuária com a frase exata:
> **"autorizo mexer no WhatsApp estável"**

---

## 1. Data do Congelamento

**Data:** 2026-08-13
**Hora:** ~17:29 (BRT / UTC-3)
**Commit de referência:** `efb22f2` (branch `main`)

---

## 2. Status — Funcionalidades Confirmadas como Funcionando

| Funcionalidade | Status |
|---|---|
| Envio de mensagem de texto | ✅ CONGELADO |
| Recebimento de mensagem de texto | ✅ CONGELADO |
| Envio de áudio pelo CRM | ✅ CONGELADO |
| Recebimento de áudio de contato | ✅ CONGELADO |
| Reprodução de áudio no CRM (player) | ✅ CONGELADO |
| Envio de arquivo/documento pelo CRM | ✅ CONGELADO — *adicionado em 2026-08-14* |
| **Recebimento de arquivo/documento do cliente** | ✅ **CONGELADO — adicionado em 2026-08-14** |
| **Recebimento de imagem do cliente** | ✅ **CONGELADO — adicionado em 2026-08-14** |
| **Exibição do arquivo recebido no CRM** | ✅ **CONGELADO — adicionado em 2026-08-14** |
| **Download/abertura do arquivo recebido** | ✅ **CONGELADO — adicionado em 2026-08-14** |
| **Arquivo salvo permanentemente no Supabase** | ✅ **CONGELADO — adicionado em 2026-08-14** |
| Abertura de conversa correta do lead | ✅ CONGELADO |
| Envio e recebimento na mesma conversa | ✅ CONGELADO |
| Lista lateral de conversas (sidebar) | ✅ CONGELADO |
| Abertura via URL com lead_id e phone | ✅ CONGELADO |

> **Atualização 2026-08-14:** Recebimento de arquivos pelo WhatsApp também está estável e congelado.
> Commit de referência para o novo congelamento: `4ad9618`

---

## 3. Arquivos Congelados

Os seguintes arquivos **NÃO PODEM SER ALTERADOS** sem autorização explícita:

### Backend
- `src/controllers/whatsappController.js`
- `src/controllers/whatsappAudioController.js`
- `src/controllers/arquivosWhatsappController.js` ← *adicionado em 2026-08-14*
- `src/services/evolutionApiService.js`
- `src/routes/api.js` — **somente as rotas:** `/whatsapp`, `/whatsapp/audio`, `/whatsapp/media`, `/whatsapp/arquivo`, `/whatsapp/arquivos`, `/whatsapp/webhook`

### Frontend
- `public/js/whatsapp.js`
- `public/js/whatsapp-audio.js`
- `public/whatsapp.html` — **somente:** scripts, IDs, botões, input, player e estrutura funcional do chat

### Banco de Dados / Storage
- Qualquer migration SQL relacionada a:
  - `conversas_whatsapp`
  - `mensagens_whatsapp`
  - `whatsapp_conversa_aliases`
  - `lead_arquivos`
  - storage de áudio/mídia WhatsApp (bucket `whatsapp-midias`)

---

## 4. Funcionalidades Protegidas

É **PROIBIDO** alterar qualquer código que impacte:

- Envio de mensagens de texto
- Recebimento de mensagens de texto
- Envio de áudio
- Recebimento de áudio
- Player / reprodução de áudio no CRM
- Webhook WhatsApp (Evolution API)
- Normalização de telefone
- Resolução de conversa (algoritmo de match por lead_id / phone)
- Alias / LID (identificação de contato WhatsApp)
- Criação e abertura de conversa
- Supabase Storage de mídias (upload, download, signed URL)
- Bucket de áudio (`whatsapp-midias`)
- Rotas de WhatsApp no Express
- Autenticação das rotas de WhatsApp
- Controller de WhatsApp
- Controller de áudio
- Serviço Evolution API

---

## 5. Regra Permanente

> **Nenhum prompt futuro pode alterar esta integração sem autorização explícita da usuária.**

Qualquer solicitação de mudança que afete os arquivos ou funcionalidades listados acima deve ser **recusada ou pausada** até que a usuária diga explicitamente:

> *"autorizo mexer no WhatsApp estável"*

Esta frase é a **única forma válida de desbloqueio**.

---

## 6. Procedimento de Verificação Obrigatório

**Antes de qualquer alteração futura no CRM, executar:**

```bash
git diff --stat
```

**Se algum arquivo congelado aparecer no diff, verificar:**

```bash
git diff -- src/controllers/whatsappController.js
git diff -- src/controllers/whatsappAudioController.js
git diff -- src/routes/api.js
git diff -- src/services/evolutionApiService.js
git diff -- public/js/whatsapp.js
git diff -- public/js/whatsapp-audio.js
```

---

## 7. Procedimento de Reversão de Emergência

Se qualquer arquivo congelado for alterado **sem autorização**, reverter imediatamente:

```bash
# Reverter arquivo específico para o commit de congelamento
git checkout efb22f2 -- <caminho-do-arquivo>

# Exemplo — reverter whatsapp.js:
git checkout efb22f2 -- public/js/whatsapp.js
```

**Commit de congelamento seguro:** `efb22f2`

---

## 8. O que PODE ser alterado no futuro (sem autorização especial)

Apenas ajustes **puramente visuais** que não alterem função:

| Permitido | Proibido mesmo em ajustes visuais |
|---|---|
| Cor | IDs de elementos |
| Espaçamento | Listeners / event handlers |
| Tamanho visual | Funções JavaScript |
| Borda / sombra | Endpoints de API |
| Alinhamento | Payloads de requisição |
| Aparência da lista | Nomes de variáveis funcionais |
| Aparência dos balões | Ordem dos scripts |
| Responsividade visual | Estrutura do input de mensagem |
| — | Botão de envio / botão de áudio |
| — | Player de áudio |

---

## 9. Arquitetura do Fluxo de Áudio (referência)

```
Envio:
  Browser (MediaRecorder) → POST /api/whatsapp/audio/send
    → Supabase Storage (whatsapp-midias)
    → Evolution API (sendWhatsAppAudio)
    → DB: mensagens_whatsapp (storage_path, arquivo_url)
    → Frontend: data-src=/api/whatsapp/audio/play/:msgId

Recebimento:
  Evolution webhook → POST /api/whatsapp/webhook
    → DB: mensagens_whatsapp (arquivo_url = Evolution mediaUrl)
    → Clique no player: event delegation (CSP-safe) → WAAudio.toggle()
    → GET /api/whatsapp/audio/play/:msgId → servirAudioAssinado
    → Fallbacks: storage_path → signed URL → relative path → Evolution API

CSP Fix crítico:
  onclick inline BLOQUEADO pelo servidor (script-src-attr: none)
  Solução permanente: addEventListener via event delegation no #wa-messages
```

---

*Documento criado em 2026-08-13 | Commit de congelamento: `efb22f2` | branch `main`*
