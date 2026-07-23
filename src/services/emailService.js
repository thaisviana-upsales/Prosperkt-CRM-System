/**
 * PROSPEKT CRM — Email Service
 * Envio de e-mail via Nodemailer + SMTP.
 * Variáveis de ambiente (Railway):
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 */

const nodemailer = require('nodemailer');
let _transporter = null;

function getTransporter() {
  if (_transporter) return _transporter;
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
  _transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: parseInt(SMTP_PORT || '587'),
    secure: parseInt(SMTP_PORT || '587') === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    tls: { rejectUnauthorized: false },
  });
  return _transporter;
}

/**
 * @param {{ to: string|string[], subject: string, html: string, text?: string }}
 * @returns {{ ok: boolean, messageId?: string, erro?: string }}
 */
async function enviarEmail({ to, subject, html, text }) {
  const transporter = getTransporter();
  if (!transporter) {
    const msg = 'Envio de e-mail não configurado. Configure SMTP_HOST, SMTP_USER e SMTP_PASS no Railway.';
    console.error('[emailService]', msg);
    return { ok: false, erro: msg };
  }
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  const toArr = Array.isArray(to) ? to : [to];
  try {
    const info = await transporter.sendMail({
      from, to: toArr.join(', '), subject, html,
      text: text || html.replace(/<[^>]+>/g, ''),
    });
    console.log('[emailService] Enviado:', info.messageId, '→', toArr.join(', '));
    return { ok: true, messageId: info.messageId };
  } catch (e) {
    console.error('[emailService] Erro ao enviar:', e.message);
    return { ok: false, erro: e.message };
  }
}

module.exports = { enviarEmail };
