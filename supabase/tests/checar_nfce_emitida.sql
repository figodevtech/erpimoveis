-- Somente leitura: conferência da NFC-e emitida de ponta a ponta.
BEGIN;

DO $$
DECLARE
  r record;
  v_qr text;
  v_supl text;
BEGIN
  RAISE NOTICE '--- NFC-e gravadas ---';
  FOR r IN
    SELECT id, serie, numero, numero_definitivo, status::text AS status,
           ambiente::text AS amb, protocolo, chave_acesso, total_nfe,
           dataemissao, dataautorizacao,
           justificativacancelamento,
           (xml_autorizado IS NOT NULL) AS tem_xml_autorizado,
           coalesce(substring(chave_acesso from 21 for 2), '--') AS mod_chave,
           coalesce(substring(chave_acesso from 35 for 1), '-') AS tpemis_chave
      FROM public.nfe
     WHERE modelo = 'NFCE'::public.enum_modelo_nfe AND is_deleted = false
     ORDER BY id DESC
  LOOP
    RAISE NOTICE '  id % | serie % nº % (def: %) | % | % | R$ %',
      r.id, r.serie, r.numero, r.numero_definitivo, r.status, r.amb, r.total_nfe;
    RAISE NOTICE '     chave: % (mod=% tpEmis=%)', r.chave_acesso, r.mod_chave, r.tpemis_chave;
    RAISE NOTICE '     protocolo: % | autorizada em: %',
      coalesce(r.protocolo,'-'), coalesce(r.dataautorizacao::text,'-');
    RAISE NOTICE '     xml_autorizado gravado: %', r.tem_xml_autorizado;
    IF r.justificativacancelamento IS NOT NULL THEN
      RAISE NOTICE '     cancelamento: %', r.justificativacancelamento;
    END IF;
  END LOOP;

  -- Conteúdo do QR Code efetivamente transmitido.
  SELECT substring(coalesce(xml_autorizado, xml_assinado) from '<qrCode>(?:<!\[CDATA\[)?([^]<]*)'),
         substring(coalesce(xml_autorizado, xml_assinado) from '<urlChave>([^<]*)</urlChave>')
    INTO v_qr, v_supl
    FROM public.nfe
   WHERE modelo = 'NFCE'::public.enum_modelo_nfe AND is_deleted = false
   ORDER BY id DESC LIMIT 1;

  RAISE NOTICE '--- infNFeSupl transmitido ---';
  RAISE NOTICE '  qrCode:   %', coalesce(v_qr, '(ausente)');
  RAISE NOTICE '  urlChave: %', coalesce(v_supl, '(ausente)');

  RAISE NOTICE '--- Config e contador ---';
  FOR r IN
    SELECT modelo::text AS modelo, serie, ultimo_numero, ambiente::text AS amb, qrcode_versao
      FROM public.nfe_config ORDER BY modelo
  LOOP
    RAISE NOTICE '  % | serie % | ultimo_numero % | % | QR v%',
      r.modelo, r.serie, r.ultimo_numero, r.amb, r.qrcode_versao;
  END LOOP;
END;
$$;

ROLLBACK;
