-- ============================================================================
-- PATCH v25: metas — corrige constraint UNIQUE para permitir múltiplas metas
-- por vendedor em meses diferentes (usuario_id + mes + ano + tipo + funil_id)
-- Safe: não usa DROP, não apaga dados existentes
-- ============================================================================

-- 1. Remove constraint antiga que limitava por usuario_id apenas (se existir)
-- (nome da constraint pode variar — tentamos os nomes comuns)
DO $$
BEGIN
  -- Tenta remover constraint antiga por usuario_id sozinho
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'metas' AND constraint_type = 'UNIQUE'
      AND constraint_name IN ('metas_usuario_id_key','metas_usuario_unique','uq_metas_usuario')
  ) THEN
    EXECUTE 'ALTER TABLE metas DROP CONSTRAINT IF EXISTS metas_usuario_id_key';
    EXECUTE 'ALTER TABLE metas DROP CONSTRAINT IF EXISTS metas_usuario_unique';
    EXECUTE 'ALTER TABLE metas DROP CONSTRAINT IF EXISTS uq_metas_usuario';
    RAISE NOTICE 'Constraint única antiga removida.';
  END IF;
END $$;

-- 2. Cria constraint composta correta (se não existir)
-- Permite: mesmo vendedor com meses/anos/tipos diferentes
-- Bloqueia: duplicata exata de (usuario_id + mes + ano + tipo + funil_id)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'metas' AND constraint_name = 'uq_metas_vendedor_mes_ano_tipo_funil'
  ) THEN
    ALTER TABLE metas ADD CONSTRAINT uq_metas_vendedor_mes_ano_tipo_funil
      UNIQUE (usuario_id, mes, ano, tipo, funil_id);
    RAISE NOTICE 'Nova constraint composta criada.';
  ELSE
    RAISE NOTICE 'Constraint composta já existe — sem alteração.';
  END IF;
END $$;

-- 3. Confirma
SELECT 'patch_v25_ok' AS resultado;
SELECT constraint_name, constraint_type
FROM information_schema.table_constraints
WHERE table_name = 'metas' AND constraint_type = 'UNIQUE';
