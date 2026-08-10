-- QR Code versão 3 como padrão da NFC-e.
--
-- A SVRS — autorizadora da NFC-e na Paraíba — colocou a NT 2025.001 em produção
-- em 01/09/2025, passando a aceitar o QR Code versão 3 e mantendo a versão 2
-- por tempo indeterminado.
--
-- A diferença que importa na operação: a versão 3 NÃO usa CSC nem ID do CSC.
-- O controle de autenticidade passou a ser feito pela assinatura dos próprios
-- parâmetros do QR Code (e só na contingência offline). Isso elimina toda a
-- burocracia de gerar, cadastrar, rotacionar e manter no máximo 2 CSC ativos por
-- UF — que era, na prática, o que travava a primeira emissão.
--
-- Esta migration existe separada porque a anterior já foi aplicada em parte dos
-- bancos com o padrão 2. Editar migration aplicada faria os ambientes divergirem
-- em silêncio; normalizar num arquivo novo faz todos convergirem para o mesmo
-- estado, independentemente de quando a primeira rodou.
BEGIN;

ALTER TABLE public.nfe_config
  ALTER COLUMN qrcode_versao SET DEFAULT 3;

-- Só as configurações que nunca emitiram nada. Uma NFC-e já autorizada teve o
-- QR Code montado e conferido pela SEFAZ na versão vigente à época; trocar a
-- versão embaixo dela faria a consulta do consumidor divergir do documento.
UPDATE public.nfe_config c
   SET qrcode_versao = 3,
       updatedat = now()
 WHERE c.modelo = 'NFCE'::public.enum_modelo_nfe
   AND c.qrcode_versao <> 3
   AND NOT EXISTS (
     SELECT 1
       FROM public.nfe n
      WHERE n.empresaid = c.empresaid
        AND n.modelo = 'NFCE'::public.enum_modelo_nfe
        AND n.numero_definitivo
   );

COMMENT ON COLUMN public.nfe_config.qrcode_versao IS
  'Versao do leiaute do QR Code da NFC-e. 3 = atual (NT 2025.001, dispensa CSC); 2 = legada, exige CSC e idCSC.';

COMMIT;
