-- ============================================================
-- PROSPERKT CRM — Patch v13: Endereço de Entrega Completo
-- Expande o campo único em 8 campos separados com CEP.
-- SEGURO: ADD COLUMN IF NOT EXISTS — sem DROP, DELETE, TRUNCATE.
-- Execute no Supabase SQL Editor ANTES do deploy.
-- ============================================================

-- 1. Tabela leads — campos separados de endereço de entrega
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS cep_entrega          TEXT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS endereco_entrega     TEXT; -- logradouro/rua (já existe do patch v12 — idempotente)
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS numero_entrega       TEXT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS complemento_entrega  TEXT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS referencia_entrega   TEXT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS bairro_entrega       TEXT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS cidade_entrega       TEXT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS uf_entrega           TEXT;

-- 2. Tabela adm_vendas — mesmos campos para o time operacional
ALTER TABLE public.adm_vendas ADD COLUMN IF NOT EXISTS cep_entrega         TEXT;
ALTER TABLE public.adm_vendas ADD COLUMN IF NOT EXISTS endereco_entrega    TEXT; -- idempotente
ALTER TABLE public.adm_vendas ADD COLUMN IF NOT EXISTS numero_entrega      TEXT;
ALTER TABLE public.adm_vendas ADD COLUMN IF NOT EXISTS complemento_entrega TEXT;
ALTER TABLE public.adm_vendas ADD COLUMN IF NOT EXISTS referencia_entrega  TEXT;
ALTER TABLE public.adm_vendas ADD COLUMN IF NOT EXISTS bairro_entrega      TEXT;
ALTER TABLE public.adm_vendas ADD COLUMN IF NOT EXISTS cidade_entrega      TEXT;
ALTER TABLE public.adm_vendas ADD COLUMN IF NOT EXISTS uf_entrega          TEXT;

-- ============================================================
-- FIM DO PATCH v13
-- ============================================================
