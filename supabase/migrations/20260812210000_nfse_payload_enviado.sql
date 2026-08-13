-- Payload enviado a Focus em cada emissao de NFS-e.
--
-- Motivo: em 12/08/2026 a OS 241 levou seis rejeicoes seguidas da prefeitura de
-- Joao Pessoa com o codigo L999 -- "Problema(s) encontrado(s) no processamento
-- dos dados", que nao diz o que estava errado. O registro da NFS-e guardava o
-- resultado (status e erros), nunca o envio, entao investigar exigiu rodar o
-- mapeador de novo contra o banco para reconstruir o JSON e compara-lo com o de
-- notas autorizadas. Duas hipoteses foram descartadas so depois de o cliente
-- reemitir na producao.
--
-- Com o envio gravado, uma rejeicao opaca vira leitura direta: da para comparar
-- campo a campo com uma nota que autorizou, sem depender de deducao nem de nova
-- tentativa em producao.
--
-- Grava tambem nas emissoes que autorizam -- foi justamente a comparacao entre
-- uma autorizada e uma rejeitada que isolou a variavel.
--
-- Nao ha segredo no payload: o token da Focus vai no cabecalho Authorization,
-- nao no corpo. O que fica aqui (CNPJ/CPF, endereco e email do tomador) ja
-- esta em public.cliente.
BEGIN;

ALTER TABLE public.nfse
  ADD COLUMN IF NOT EXISTS payload_enviado jsonb;

COMMENT ON COLUMN public.nfse.payload_enviado IS
  'JSON exato enviado a Focus NFe nesta emissao, incluindo data_emissao. Gravado junto com o retorno, e best-effort: falha ao grava-lo nunca derruba a emissao.';

COMMIT;
