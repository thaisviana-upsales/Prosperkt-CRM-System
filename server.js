/**
 * PROSPERKT CRM — Server Entry Point
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
app.use(express.static(path.join(__dirname, 'public')));

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
initProvider().then(() => {
  app.listen(PORT, () => {
    console.log('\n╔══════════════════════════════════════╗');
    console.log('║      PROSPERKT CRM — INICIADO        ║');
    console.log('╠══════════════════════════════════════╣');
    console.log(`║  URL: http://localhost:${PORT}          ║`);
    console.log(`║  ENV: ${(process.env.NODE_ENV || 'development').padEnd(29)}║`);
    console.log(`║  DB:  ${(process.env.DATABASE_PROVIDER || 'sqlite').padEnd(29)}║`);
    console.log('╚══════════════════════════════════════╝\n');
  });
}).catch(err => {
  console.error('[FATAL] Falha ao inicializar banco de dados:', err.message);
  process.exit(1);
});

module.exports = app;
