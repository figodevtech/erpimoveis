-- Migration: Adiciona coluna gerada em_estoque para priorização automática de produtos disponíveis nas listagens
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'produto' 
      AND column_name = 'em_estoque'
  ) THEN
    ALTER TABLE public.produto ADD COLUMN em_estoque boolean GENERATED ALWAYS AS (estoque > 0) STORED;
    CREATE INDEX IF NOT EXISTS idx_produto_em_estoque ON public.produto (em_estoque);
  END IF;
END $$;
