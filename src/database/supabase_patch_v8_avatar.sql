-- ============================================================
-- PROSPERKT CRM — Patch v8: Avatar URL + Funis somente_ativos
-- Execute no Supabase SQL Editor:
-- https://supabase.com/dashboard/project/wtuhaoyqojzelaqteclx/sql/new
-- SEGURO: usa ADD COLUMN IF NOT EXISTS
-- ============================================================

-- 1. Campo avatar_url na tabela usuarios
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- Índice para buscas por avatar (opcional, low priority)
-- CREATE INDEX IF NOT EXISTS idx_usuarios_avatar ON usuarios (id) WHERE avatar_url IS NOT NULL;

-- 2. Campo salario_fixo (pode já existir de patches anteriores, só garante)
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS salario_fixo NUMERIC DEFAULT 0;

-- ============================================================
-- FIM DO PATCH v8
-- ============================================================

SELECT 'Patch v8 aplicado com sucesso!' as resultado;
