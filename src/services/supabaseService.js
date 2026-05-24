/**
 * PROSPERKT CRM — supabaseService.js
 * Cliente Supabase singleton para uso server-side.
 * Usa service_role key → bypassa RLS completamente.
 *
 * Interface: usa Supabase JS client nativo (.from().select() etc.)
 * NÃO depende de exec_sql / RPC para operações CRUD.
 */
const { createClient } = require('@supabase/supabase-js');

let _client = null;

function getSupabase() {
  if (_client) return _client;

  const url = process.env.SUPABASE_URL;
  const key  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error('[Supabase] SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios.');
  }

  _client = createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    db: { schema: 'public' },
    global: {
      headers: { 'x-client-info': 'prosperkt-crm-backend' },
    },
  });

  console.log('[Supabase] Cliente inicializado:', url);
  return _client;
}

module.exports = { getSupabase };
