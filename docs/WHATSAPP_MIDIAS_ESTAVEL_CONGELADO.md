# 🔒 WHATSAPP MÍDIAS — RECEBIMENTO ESTÁVEL E CONGELADO

> **ATENÇÃO MÁXIMA:** Este documento registra o congelamento oficial do recebimento de
> arquivos/documentos/imagens via WhatsApp no CRM Prospekt.
>
> Qualquer alteração nos arquivos listados abaixo requer autorização explícita da usuária
> com a frase exata:
>
> **"autorizo mexer no WhatsApp estável"**

---

## 1. Data do Congelamento

| Campo | Valor |
|---|---|
| **Data** | 2026-08-14 |
| **Hora** | ~16:33 BRT (UTC-3) |
| **Commit de referência** | `4ad9618` (branch `main`) |
| **Deploy** | Railway — Prosperkt-CRM-System production |

---

## 2. Status — Funcionalidades Confirmadas como Funcionando

| Funcionalidade | Status |
|---|---|
| Envio de mensagem de texto | ✅ CONGELADO |
| Recebimento de mensagem de texto | ✅ CONGELADO |
| Envio de áudio pelo CRM | ✅ CONGELADO |
| Recebimento de áudio do cliente | ✅ CONGELADO |
| Reprodução de áudio no CRM (player) | ✅ CONGELADO |
| Envio de arquivo/documento pelo CRM | ✅ CONGELADO |
| Recebimento de arquivo/documento enviado pelo cliente | ✅ CONGELADO |
| Recebimento de imagem enviada pelo cliente | ✅ CONGELADO |
| Exibição do arquivo recebido no chat CRM | ✅ CONGELADO |
| Download/abertura do arquivo recebido | ✅ CONGELADO |
| Arquivos salvos permanentemente no Supabase Storage | ✅ CONGELADO |
| Sincronização de mídia via Evolution API | ✅ CONGELADO |
| Conversa correta do lead | ✅ CONGELADO |
| Envio e recebimento na mesma conversa | ✅ CONGELADO |

---

## 3. Arquivos Congelados (NÃO ALTERAR SEM AUTORIZAÇÃO)

### Backend
```
src/controllers/whatsappController.js
src/controllers/whatsappAudioController.js
src/controllers/arquivosWhatsappController.js
src/services/evolutionApiService.js
src/routes/api.js  ← somente rotas: /whatsapp, /whatsapp/audio, /whatsapp/media,
                                      /whatsapp/arquivo, /whatsapp/arquivos, /whatsapp/webhook
```

### Frontend
```
public/js/whatsapp.js
public/js/whatsapp-audio.js
public/whatsapp.html  ← somente: scripts, IDs, botões, input, player, anexos, estrutura do chat
```

### Banco de Dados / Migrations SQL
```
src/database/supabase_patch_v44_audio_storage.sql
src/database/supabase_patch_v50_documento_recebido_whatsapp.sql
— qualquer migration relacionada a:
    - conversas_whatsapp
    - mensagens_whatsapp
    - whatsapp_conversa_aliases
    - mídias WhatsApp (bucket whatsapp-midias)
    - storage de áudio/documento/imagem WhatsApp
```

### Supabase Storage
```
bucket: whatsapp-midias
paths:  audio/*, docs/*, imagens/*
```

---

## 4. Funcionalidades Protegidas — O que NÃO pode ser alterado

É **ABSOLUTAMENTE PROIBIDO** alterar qualquer código que impacte:

- Envio de mensagens de texto
- Recebimento de mensagens de texto
- Envio de áudio
- Recebimento de áudio
- Player / reprodução de áudio no CRM
- Envio de arquivo/documento pelo CRM
- Recebimento de arquivo/documento/imagem do cliente
- Download / abertura de arquivos recebidos
- Download / sincronização de mídias via Evolution (getBase64FromMediaMessage)
- Renderização de arquivos recebidos no chat
- Webhook (Evolution API → CRM)
- Normalização de telefone
- Resolver de conversa (algoritmo de match por lead_id / phone)
- Alias / LID (identificação de contato WhatsApp)
- Criação e abertura de conversa
- Supabase Storage de mídias (upload, download, signed URL)
- Bucket whatsapp-midias
- Rotas de WhatsApp no Express
- Autenticação das rotas de WhatsApp
- Controller de WhatsApp (whatsappController.js)
- Controller de áudio (whatsappAudioController.js)
- Controller de arquivos recebidos (arquivosWhatsappController.js)
- Serviço Evolution API (evolutionApiService.js)
- Payload de getBase64FromMediaMessage
- Uso de remoteJid, LID, key.id, messageId, dados_extras
- Storage path e signed URL de mídias

---

## 5. Regra de Autorização Explícita

> **Nenhum prompt futuro pode alterar esta integração sem autorização explícita da usuária.**

Qualquer solicitação de mudança que afete os arquivos ou funcionalidades listados acima deve
ser **recusada imediatamente** ou pausada até que a usuária diga explicitamente:

> "autorizo mexer no WhatsApp estável"

Esta frase é a **única forma válida de desbloqueio.**

Se o pedido vier de forma implícita ou indireta (ex.: "melhore o desempenho do chat",
"refatore o controller", "simplifique o webhook"), deve ser **recusado** da mesma forma.

---

## 6. Verificação Obrigatória — Antes de Qualquer Alteração no CRM

**Executar antes de qualquer commit que toque em qualquer arquivo:**

```bash
git diff --stat
```

**Executar verificação específica dos congelados:**

```bash
git diff -- src/controllers/whatsappController.js
git diff -- src/controllers/whatsappAudioController.js
git diff -- src/controllers/arquivosWhatsappController.js
git diff -- src/services/evolutionApiService.js
git diff -- src/routes/api.js
git diff -- public/js/whatsapp.js
git diff -- public/js/whatsapp-audio.js
```

**Resultado esperado para cada arquivo:** nenhuma saída (sem alterações).

---

## 7. Procedimento de Reversão de Emergência

Se qualquer arquivo congelado for alterado **sem autorização**, reverter imediatamente:

```bash
# Reverter arquivo específico para o commit de congelamento
git checkout 4ad9618 -- <caminho-do-arquivo>

# Exemplos:
git checkout 4ad9618 -- src/controllers/whatsappController.js
git checkout 4ad9618 -- src/controllers/arquivosWhatsappController.js
git checkout 4ad9618 -- public/js/whatsapp.js
```

**Commit de congelamento seguro:** `4ad9618`

---

## 8. O que PODE ser alterado — Sem autorização especial

Apenas ajustes **puramente visuais** que não alterem função:

| PERMITIDO | PROIBIDO mesmo em ajustes visuais |
|---|---|
| Cor de balões | IDs de elementos |
| Espaçamento | Listeners / event handlers |
| Tamanho visual | Funções JavaScript |
| Borda / sombra | Endpoints de API |
| Alinhamento | Payloads de requisição |
| Aparência da lista | Nomes de variáveis funcionais |
| Aparência dos balões | Ordem dos scripts no HTML |
| Responsividade visual | Estrutura do input de mensagem |
| — | Botão de envio / botão de áudio / botão de anexo |
| — | Player de áudio |
| — | Lógica de download de arquivos |

---

## 9. Arquitetura do Fluxo de Arquivos Recebidos (referência)

```
Cliente envia PDF pelo WhatsApp
    ↓
Evolution processa → dispara webhook → POST /api/whatsapp/webhook
    ↓ (whatsappController.js)
INSERT mensagens_whatsapp:
  tipo: 'arquivo' (mapeado de 'documento' para passar CHECK constraint)
  evolution_message_id: key.id do WhatsApp
  arquivo_url: midiaUrl ou null
    ↓ (fire-and-forget — NÃO bloqueia webhook)
  Aguarda 2s → getBase64Media(evolution_message_id, remoteJid)
    ↓ Evolution decripta → bytes válidos
  Upload: sb.storage.from('whatsapp-midias').upload('docs/{msgId}/{filename}')
    ↓
  UPDATE mensagens_whatsapp SET storage_path, storage_bucket, mime_type

Usuário clica "Baixar" no CRM:
  GET /api/whatsapp/mensagens/:msgId/arquivo
    ↓ (arquivosWhatsappController.js — proxy 4 camadas)
  Layer 0: storage_path → sb.storage.download() → PDF permanente [PREFERIDO]
  Layer 2: evolution_message_id → getBase64FromMediaMessage → bytes decriptados
  Layer 1: arquivo_url → URL direta (fallback msgs antigas)
  Layer 3: 404 com mensagem clara ao usuário
```

---

## 10. Dados Técnicos — Não Alterar

| Parâmetro | Valor atual | Status |
|---|---|---|
| Bucket Supabase | whatsapp-midias | CONGELADO |
| Storage path documentos | docs/{evolution_message_id}/{filename} | CONGELADO |
| CHECK constraint tipo | texto, audio, imagem, video, arquivo, documento, sticker, localizacao, contato, sistema | CONGELADO |
| Mapeamento tipo DB | 'documento' → 'arquivo' | CONGELADO |
| fromMe para msgs recebidas | false | CONGELADO |
| remoteJid format | {telNumeros}@s.whatsapp.net | CONGELADO |
| Fire-and-forget delay | 2000ms (para Evolution indexar) | CONGELADO |

---

*Documento criado em 2026-08-14 | Commit de congelamento: 4ad9618 | branch main*
*Funcionalidade: WhatsApp texto + áudio + envio de arquivos + recebimento de arquivos — TUDO ESTÁVEL*
