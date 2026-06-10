-- PROSPEKT CRM — Migration: Coluna force_password_change
-- Execute no Supabase SQL Editor (Dashboard > SQL Editor)
-- Esta coluna controla se o usuário deve trocar a senha no próximo login.

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS force_password_change BOOLEAN NOT NULL DEFAULT false;

-- Confirma a migration
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'usuarios' AND column_name = 'force_password_change';
