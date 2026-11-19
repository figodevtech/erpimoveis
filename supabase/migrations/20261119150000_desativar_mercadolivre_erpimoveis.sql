-- Desativa os produtores de filas herdados do ERP Oficina.
-- Mantém tabelas e registros históricos; esta migração não apaga dados.
DO $$
BEGIN
  IF to_regclass('public.produto') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_enfileirar_estoque_mercadolivre ON public.produto;
  END IF;
  IF to_regclass('public.mercadolivre_product_link') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_enfileirar_novo_vinculo_mercadolivre ON public.mercadolivre_product_link;
  END IF;
  IF to_regclass('public.telegram_usuario_preferencia') IS NOT NULL THEN
    UPDATE public.telegram_usuario_preferencia
      SET notificar_marketplace = false
      WHERE notificar_marketplace = true;
  END IF;
END;
$$;
