-- Galeria do imóvel ordenada no ERP por arrastar e soltar. O site lê a galeria
-- por `ordem` e usa a primeira foto como capa, então a sequência é gravada
-- inteira de uma vez: uma ordem salva pela metade mudaria a capa do anúncio.

-- Normaliza a ordem vigente em 0..n-1 por imóvel, preservando a sequência atual.
WITH galeria AS (
 SELECT id,(row_number() OVER (PARTITION BY imovel_id ORDER BY ordem,id)-1)::integer AS posicao
 FROM public.imovel_arquivo
 WHERE tipo='FOTO' AND publico AND proprietario_id IS NULL
)
UPDATE public.imovel_arquivo a SET ordem=g.posicao FROM galeria g WHERE a.id=g.id AND a.ordem<>g.posicao;

CREATE INDEX IF NOT EXISTS imovel_arquivo_galeria_idx ON public.imovel_arquivo(imovel_id,ordem,id) WHERE tipo='FOTO' AND publico;

-- Anexos (documentos privados) passam a aceitar arquivos de escritório e texto.
UPDATE storage.buckets SET allowed_mime_types=ARRAY[
 'application/pdf','image/jpeg','image/png','image/webp',
 'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
 'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
 'application/vnd.oasis.opendocument.text','application/vnd.oasis.opendocument.spreadsheet',
 'text/plain','text/csv'
] WHERE id='imoveis-documentos';

CREATE OR REPLACE FUNCTION public.imob_ordenar_galeria(p_imovel_id bigint,p_ids bigint[],p_actor uuid) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE v_total integer;
BEGIN
 PERFORM public.imob_definir_ator(p_actor);
 -- Serializa reordenações concorrentes do mesmo imóvel.
 PERFORM 1 FROM public.imovel WHERE id=p_imovel_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Imóvel não encontrado.' USING ERRCODE='P0002'; END IF;
 IF coalesce(cardinality(p_ids),0)=0 THEN RAISE EXCEPTION 'Informe a ordem das fotos.' USING ERRCODE='22023'; END IF;
 IF cardinality(p_ids)<>(SELECT count(DISTINCT x) FROM unnest(p_ids) x) THEN RAISE EXCEPTION 'A ordem informada repete uma foto.' USING ERRCODE='22023'; END IF;
 SELECT count(*) INTO v_total FROM public.imovel_arquivo WHERE imovel_id=p_imovel_id AND tipo='FOTO' AND publico AND proprietario_id IS NULL;
 -- A lista precisa ser exatamente a galeria atual: outra aba pode ter enviado ou removido fotos.
 IF v_total<>cardinality(p_ids) OR EXISTS(
  SELECT 1 FROM unnest(p_ids) x WHERE NOT EXISTS(
   SELECT 1 FROM public.imovel_arquivo a WHERE a.id=x AND a.imovel_id=p_imovel_id AND a.tipo='FOTO' AND a.publico AND a.proprietario_id IS NULL))
 THEN RAISE EXCEPTION 'A galeria mudou enquanto você reordenava. Atualize e tente de novo.' USING ERRCODE='P0001'; END IF;
 UPDATE public.imovel_arquivo a SET ordem=(t.posicao-1)::integer
 FROM unnest(p_ids) WITH ORDINALITY t(id,posicao)
 WHERE a.id=t.id AND a.ordem<>(t.posicao-1);
 RETURN v_total;
END $$;
REVOKE ALL ON FUNCTION public.imob_ordenar_galeria(bigint,bigint[],uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.imob_ordenar_galeria(bigint,bigint[],uuid) TO service_role;
