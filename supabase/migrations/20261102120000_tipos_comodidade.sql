-- Tipos de comodidade: lista padrão oferecida no cadastro do imóvel, para não digitar
-- tudo à mão. O imóvel continua guardando os nomes em imovel.comodidades (text[]), que
-- o site usa no filtro; o tipo só alimenta a escolha e pode ser apagado sem afetar imóveis.
BEGIN;

CREATE TABLE IF NOT EXISTS public.tipos_comodidade (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nome text NOT NULL CHECK (char_length(btrim(nome)) BETWEEN 1 AND 120),
  descricao text,
  ativo boolean NOT NULL DEFAULT true,
  createdat timestamp with time zone NOT NULL DEFAULT now(),
  updatedat timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS tipos_comodidade_nome_uidx ON public.tipos_comodidade (lower(btrim(nome)));

-- Só a API do ERP (service_role) lê e grava; o navegador não acessa a tabela direto.
ALTER TABLE public.tipos_comodidade ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.tipos_comodidade FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.tipos_comodidade TO service_role;
REVOKE ALL ON SEQUENCE public.tipos_comodidade_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.tipos_comodidade_id_seq TO service_role;

INSERT INTO public.tipos_comodidade (nome) VALUES
  ('Wi-Fi'),
  ('Ar-condicionado'),
  ('Ventilador de teto'),
  ('Smart TV'),
  ('TV a cabo'),
  ('Cozinha equipada'),
  ('Geladeira'),
  ('Fogão'),
  ('Micro-ondas'),
  ('Cafeteira'),
  ('Lava-louças'),
  ('Utensílios de cozinha'),
  ('Máquina de lavar'),
  ('Secadora de roupas'),
  ('Ferro de passar'),
  ('Secador de cabelo'),
  ('Roupa de cama'),
  ('Toalhas de banho'),
  ('Água quente'),
  ('Banheira'),
  ('Hidromassagem'),
  ('Varanda'),
  ('Varanda gourmet'),
  ('Churrasqueira'),
  ('Piscina'),
  ('Piscina aquecida'),
  ('Sauna'),
  ('Academia'),
  ('Playground'),
  ('Salão de festas'),
  ('Vista para o mar'),
  ('Frente para o mar'),
  ('Pé na areia'),
  ('Estacionamento'),
  ('Garagem coberta'),
  ('Elevador'),
  ('Portaria 24h'),
  ('Segurança 24h'),
  ('Acessibilidade'),
  ('Aceita pets'),
  ('Berço'),
  ('Área de trabalho'),
  ('Cofre'),
  ('Jardim')
ON CONFLICT ((lower(btrim(nome)))) DO NOTHING;

INSERT INTO public.permissao (nome, descricao)
SELECT 'tipos:comodidades:' || acoes.id, acoes.titulo || ' tipos de comodidade'
FROM (VALUES ('visualizar', 'Visualizar'), ('criar', 'Criar'), ('editar', 'Editar'), ('excluir', 'Excluir')) AS acoes(id, titulo)
ON CONFLICT (nome) DO UPDATE SET descricao = excluded.descricao;

-- Mesma regra da migração de permissões de Tipos: quem edita configurações ganha tudo,
-- quem só vê Tipos ganha a consulta. Quem cadastra imóvel pode criar um tipo rápido no
-- próprio formulário do imóvel.
INSERT INTO public.perfilpermissao (perfilid, permissaoid)
SELECT DISTINCT pp.perfilid, nova.id
FROM public.perfilpermissao pp
JOIN public.permissao antiga ON antiga.id = pp.permissaoid
JOIN public.permissao nova ON (
  (antiga.nome = 'configuracoes:editar' AND nova.nome LIKE 'tipos:comodidades:%')
  OR (antiga.nome = 'tipos:visualizar' AND nova.nome = 'tipos:comodidades:visualizar')
  OR (antiga.nome IN ('imoveis:criar', 'imoveis:editar') AND nova.nome IN ('tipos:comodidades:visualizar', 'tipos:comodidades:criar'))
)
WHERE antiga.nome IN ('configuracoes:editar', 'tipos:visualizar', 'imoveis:criar', 'imoveis:editar')
ON CONFLICT DO NOTHING;

COMMIT;
