-- Retorno bruto da Focus em cada emissao, consulta e cancelamento de NFS-e.
--
-- Motivo: em 18/08/2026 a OS 195 levou tres rejeicoes seguidas da prefeitura de
-- Joao Pessoa com o mesmo L999 -- "Problema(s) encontrado(s) no processamento
-- dos dados" --, repetindo o que a OS 241 ja tinha feito seis vezes em 12/08. A
-- coluna payload_enviado, criada naquela ocasiao, resolveu metade do problema:
-- da para comparar o envio de uma rejeitada com o de uma autorizada. A outra
-- metade continuava se perdendo, porque o codigo lia a resposta com
-- `.json().catch(() => null)` e guardava so o array `erros` ja tratado. O
-- restante do corpo, o status HTTP e qualquer resposta que nao fosse JSON
-- valido (corpo vazio, HTML de gateway) sumiam.
--
-- Investigar a OS 195 exigiu, por isso, consultar a Focus por fora, ref a ref,
-- para descobrir coisas que a resposta original ja trazia -- entre elas que as
-- tres tentativas usaram o mesmo numero_rps 60, ou seja, que rejeicao nao
-- consome numeracao.
--
-- Guarda tambem nas emissoes que autorizam: foi comparar uma autorizada com uma
-- rejeitada que isolou a variavel nas duas investigacoes.
--
-- No cancelamento so grava quando falha. Cancelamento que da certo sobrescrever
-- ia o retorno da emissao, que e o que interessa manter.
--
-- Nao ha segredo aqui: o token da Focus vai no cabecalho Authorization, nunca
-- no corpo nem na URL. A configuracao da empresa, unica chamada cujo corpo
-- carrega certificado e senha, de proposito nao passa por esta coluna.
BEGIN;

ALTER TABLE public.nfse
  ADD COLUMN IF NOT EXISTS retorno_bruto jsonb;

COMMENT ON COLUMN public.nfse.retorno_bruto IS
  'Ultima resposta da Focus NFe para esta nota: metodo, URL, status HTTP, horario e corpo (JSON quando parseavel, texto cru quando nao; truncado em 20 mil caracteres). Best-effort: falha ao grava-la nunca derruba a emissao.';

COMMIT;
