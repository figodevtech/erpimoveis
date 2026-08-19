-- Cor do texto do cabecalho dos documentos impressos.
--
-- A barra do topo ja seguia a marca da oficina por `impressao_cor_primaria` e
-- `impressao_cor_secundaria`, mas o texto dentro dela era branco fixo no CSS.
-- Quem escolhia uma barra clara — amarelo, bege, um pastel — ficava com o nome
-- da empresa e o numero do documento ilegiveis, e nao havia onde corrigir.
--
-- A cor vale para tudo que e tinta sobre a barra: nome da empresa, dados,
-- rotulo, numero, a caixa do documento e o badge de situacao. As camadas
-- translucidas (borda e fundo da caixa) sao derivadas dela no CSS, entao a
-- caixa continua legivel seja o texto claro ou escuro.
--
-- O fundo do logo continua branco de proposito: e area reservada para a marca
-- do cliente, nao texto, e a maioria das logos espera fundo claro.
alter table public.config_geral
add column if not exists impressao_cor_texto text not null default '#ffffff';

alter table public.config_geral
drop constraint if exists config_geral_impressao_cor_texto_chk;

alter table public.config_geral
add constraint config_geral_impressao_cor_texto_chk
check (impressao_cor_texto ~ '^#[0-9A-Fa-f]{6}$');
