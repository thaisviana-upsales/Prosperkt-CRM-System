/**
 * PROSPEKT CRM — Email Service
 * Envio de e-mail via Nodemailer.
 *
 * Suporta duas formas de configuração (Railway env vars):
 *
 *  MODO 1 — Gmail (recomendado para Prospekt):
 *    GMAIL_USER       = conta@prospektpersonalizados.com.br
 *    GMAIL_APP_PASSWORD = xxxx xxxx xxxx xxxx   (Senha de App do Google — 16 chars)
 *
 *  MODO 2 — SMTP genérico (qualquer provedor):
 *    SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 *
 *  A Senha de App do Google NÃO é a senha real da conta.
 *  Gere em: Conta Google → Segurança → Verificação em 2 etapas → Senhas de App.
 */

const nodemailer = require('nodemailer');
let _transporter = null;

function getTransporter() {
  if (_transporter) return _transporter;

  const {
    // Modo Gmail
    GMAIL_USER, GMAIL_APP_PASSWORD,
    // Modo SMTP genérico
    SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS,
  } = process.env;

  // ── Modo Gmail ──────────────────────────────────────────────────────────────
  if (GMAIL_USER && GMAIL_APP_PASSWORD) {
    _transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: GMAIL_USER,
        pass: GMAIL_APP_PASSWORD,   // Senha de App (16 chars), NÃO a senha real
      },
    });
    console.log('[emailService] Modo Gmail configurado:', GMAIL_USER);
    return _transporter;
  }

  // ── Modo SMTP genérico ──────────────────────────────────────────────────────
  if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
    _transporter = nodemailer.createTransport({
      host:   SMTP_HOST,
      port:   parseInt(SMTP_PORT || '587'),
      secure: parseInt(SMTP_PORT || '587') === 465,
      auth:   { user: SMTP_USER, pass: SMTP_PASS },
      tls:    { rejectUnauthorized: false },
    });
    console.log('[emailService] Modo SMTP genérico configurado:', SMTP_HOST, SMTP_USER);
    return _transporter;
  }

  // Nenhum modo configurado
  console.warn('[emailService] ⚠ Nenhuma configuração de e-mail encontrada. Configure GMAIL_USER + GMAIL_APP_PASSWORD no Railway.');
  return null;
}

/**
 * Envia e-mail.
 * @param {{ to: string|string[], subject: string, html: string, text?: string }}
 * @returns {{ ok: boolean, messageId?: string, erro?: string }}
 */
async function enviarEmail({ to, subject, html, text }) {
  const transporter = getTransporter();
  if (!transporter) {
    const msg = 'E-mail não configurado. Adicione GMAIL_USER e GMAIL_APP_PASSWORD no Railway.';
    console.error('[emailService]', msg);
    return { ok: false, erro: msg };
  }

  const from  = process.env.SMTP_FROM || process.env.GMAIL_USER || process.env.SMTP_USER;
  const toArr = Array.isArray(to) ? to : [to];

  try {
    const info = await transporter.sendMail({
      from,
      to:      toArr.join(', '),
      subject,
      html,
      text:    text || html.replace(/<[^>]+>/g, ''),
    });
    console.log('[emailService] ✅ Enviado:', info.messageId, '→', toArr.join(', '));
    return { ok: true, messageId: info.messageId };
  } catch(e) {
    console.error('[emailService] ❌ Erro ao enviar:', e.message);
    return { ok: false, erro: e.message };
  }
}

/**
 * Verifica se e-mail está configurado (para exibir aviso na UI antes de tentar).
 */
function emailConfigurado() {
  const { GMAIL_USER, GMAIL_APP_PASSWORD, SMTP_HOST, SMTP_USER, SMTP_PASS } = process.env;
  return (!!GMAIL_USER && !!GMAIL_APP_PASSWORD) || (!!SMTP_HOST && !!SMTP_USER && !!SMTP_PASS);
}

module.exports = { enviarEmail, emailConfigurado };
