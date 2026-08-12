-- Separa o padrao fiscal da saida de venda do da saida que nao vende nada.
--
-- Ate aqui `nfe_config.padroes_emissao` tinha dois ramos, SAIDA e ENTRADA, e o
-- ramo SAIDA servia a tudo que sai: venda, PDV, peca aplicada em OS, NF-e
-- avulsa e tambem a saida de estoque. So que a saida de estoque nao vende --
-- ela cobre devolucao de compra, remessa para conserto, retorno e remessa em
-- garantia (ver src/lib/nfe/saidaFiscal.ts) -- e emitia com o perfil da 5102:
-- mesmo CSOSN, mesma tributacao de PIS/COFINS de uma venda.
--
-- Agora sao tres ramos:
--
--   SAIDA           -> saida de venda: venda, OS, NFC-e, NF-e avulsa
--   SAIDA_NAO_VENDA -> saida de estoque: devolucao, remessa, retorno, garantia
--   ENTRADA         -> NF-e de compra
--
-- A chave SAIDA ficou como esta de proposito, em vez de virar SAIDA_VENDA: e a
-- unica com padrao cadastrado nos bancos em uso, e renomear exigiria migrar
-- dado -- uma migracao nao aplicada faria toda emissao sair sem tributacao. O
-- nome novo mora no rotulo da tela e neste comentario.
--
-- Nao ha dado a migrar. Enquanto SAIDA_NAO_VENDA estiver ausente, a saida de
-- estoque herda SAIDA com a procedencia marcada -- e exatamente o que ja
-- acontecia, e melhor que emitir item sem tributacao. Quem faz isso e
-- buscarContextoPadraoFiscal, em src/services/fiscal/nfeConfigService.ts.
BEGIN;

COMMENT ON COLUMN public.nfe_config.padroes_emissao IS
  'Padrao fiscal dos itens, chaveado por operacao: SAIDA (saida de venda -- venda, OS, NFC-e, avulsa), SAIDA_NAO_VENDA (saida de estoque -- devolucao, remessa, retorno, garantia) e ENTRADA (NF-e de compra). O modelo vem da propria linha. Preenche o que o produto deixou vazio; produto preenchido vence. SAIDA_NAO_VENDA ausente herda SAIDA, com a procedencia marcada.';

COMMIT;
