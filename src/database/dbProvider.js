/**
 * PROSPEKT CRM — dbProvider.js
 * Abstração real: SQLite (better-sqlite3 síncrono) ou Supabase JS (assíncrono).
 *
 * Uso nos controllers:
 *   const { getProvider } = require('../database/dbProvider');
 *   const { sb, isSupa } = getProvider();
 *   if (isSupa) { const { data, error } = await sb.from('leads').select('*'); }
 *   else { const db = getSQLite(); const rows = db.prepare('SELECT * FROM leads').all(); }
 */

require('dotenv').config();

const MODE = (process.env.DATABASE_PROVIDER || 'sqlite').toLowerCase();

let _supabase = null;
let _sqlite   = null;
let _ready    = false;

async function initProvider() {
  if (_ready) return;

  if (MODE === 'supabase') {
    console.log('[DB] Modo: SUPABASE');
    const { getSupabase } = require('../services/supabaseService');
    _supabase = getSupabase();
    console.log('[DB] Supabase client pronto.');
  } else {
    console.log('[DB] Modo: SQLite');
    const { getDb } = require('./db');
    _sqlite = getDb();
  }

  _ready = true;
}

function getProvider() {
  if (!_ready) {
    // Fallback síncrono para controllers que chamam antes do init
    if (MODE === 'supabase') {
      if (!_supabase) {
        const { getSupabase } = require('../services/supabaseService');
        _supabase = getSupabase();
      }
    } else {
      if (!_sqlite) {
        const { getDb } = require('./db');
        _sqlite = getDb();
      }
    }
    _ready = true;
  }
  return {
    sb:     _supabase,
    sqlite: _sqlite,
    isSupa: MODE === 'supabase',
    mode:   MODE,
  };
}

// Compat: controllers antigos que usam getDb() continuam funcionando no modo SQLite
function getDb() {
  const { sqlite, isSupa } = getProvider();
  if (isSupa) throw new Error('[DB] getDb() chamado em modo Supabase. Use getProvider().');
  return sqlite;
}

module.exports = { initProvider, getProvider, getDb, MODE };
