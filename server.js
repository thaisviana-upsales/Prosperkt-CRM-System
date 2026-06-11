/**
 * PROSPEKT CRM — Server Entry Point
 */

require('dotenv').config();
const express     = require('express');
const helmet      = require('helmet');
const cors        = require('cors');
const morgan      = require('morgan');
const cookieParser = require('cookie-parser');
const path        = require('path');

const apiRoutes = require('./src/routes/api');
const { initProvider } = require('./src/database/dbProvider');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─────────────────────────────────────────────────────────────────────────────
// Security headers
// ─────────────────────────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc:   ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc:    ["'self'", 'https://fonts.gstatic.com'],
      scriptSrc:  ["'self'", "'unsafe-inline'"],
      imgSrc:     ["'self'", 'data:', 'https:'],
    },
  },
}));

// ─────────────────────────────────────────────────────────────────────────────
// CORS
// ─────────────────────────────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? process.env.CORS_ORIGIN || false
    : true,
  credentials: true,
}));

// ─────────────────────────────────────────────────────────────────────────────
// Request parsing
// ─────────────────────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser(process.env.COOKIE_SECRET));

// ─────────────────────────────────────────────────────────────────────────────
// Logging
// ─────────────────────────────────────────────────────────────────────────────
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// ─────────────────────────────────────────────────────────────────────────────
// API Routes
// ─────────────────────────────────────────────────────────────────────────────
app.use('/api', apiRoutes);

// ─────────────────────────────────────────────────────────────────────────────
// Static files (frontend)
// ─────────────────────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public'), {
  // CSS/JS/HTML: sempre revalida com o servidor (sem cache agressivo)
  // Isso garante que novos deploys chegam sem hard refresh
  setHeaders(res, filePath) {
    if (/\.(css|js|html)$/.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    } else if (/\.(png|jpg|jpeg|webp|svg|ico|woff2?)$/.test(filePath)) {
      // Imagens/fontes: pode cachear por 7 dias (raramente mudam)
      res.setHeader('Cache-Control', 'public, max-age=604800');
    }
  },
}));

// SPA fallback — redireciona todas as rotas não-API para o index.html
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─────────────────────────────────────────────────────────────────────────────
// Error handler global
// ─────────────────────────────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('[Server Error]', err);
  res.status(err.status || 500).json({
    sucesso: false,
    erro: process.env.NODE_ENV === 'production' ? 'Erro interno do servidor.' : err.message,
    codigo: 'SERVER_ERROR',
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Start — aguarda banco pronto antes de escutar
// ─────────────────────────────────────────────────────────────────────────────
const { iniciarAutomacoes } = require('./src/services/automacaoLeadsService');

initProvider().then(() => {
  app.listen(PORT, () => {
    console.log('\n╔══════════════════════════════════════╗');
    console.log('║      PROSPEKT CRM — INICIADO        ║');
    console.log('╠══════════════════════════════════════╣');
    console.log(`║  URL: http://localhost:${PORT}          ║`);
    console.log(`║  ENV: ${(process.env.NODE_ENV || 'development').padEnd(29)}║`);
    console.log(`║  DB:  ${(process.env.DATABASE_PROVIDER || 'sqlite').padEnd(29)}║`);
    console.log('╚══════════════════════════════════════╝\n');

    // Inicia automações (stale leads + SLA Contato 1 no criar)
    iniciarAutomacoes();

    // Configura webhook da Evolution API com MESSAGES_UPSERT no startup
    // Necessário para garantir que respostas do WhatsApp chegam ao CRM
    const evoSvc = require('./src/services/evolutionApiService');
    if (evoSvc.isConfigured()) {
      setTimeout(async () => {
        try {
          const r = await evoSvc.configurarWebhook();
          if (r.sucesso) {
            console.log('[EVO] ✅ Webhook configurado com MESSAGES_UPSERT no startup.');
          } else {
            console.warn('[EVO] ⚠️ Webhook não configurado no startup:', r.erro);
          }
        } catch (e) {
          console.warn('[EVO] ⚠️ Erro ao configurar webhook no startup:', e.message);
        }
      }, 3000); // aguarda 3s para garantir que o servidor está pronto
    }
  });
}).catch(err => {
  console.error('[FATAL] Falha ao inicializar banco de dados:', err.message);
  process.exit(1);
});

module.exports = app;
