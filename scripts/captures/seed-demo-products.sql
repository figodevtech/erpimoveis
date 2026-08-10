-- CATÁLOGO EXCLUSIVO PARA O BANCO DE DEMONSTRAÇÃO.
-- Não mova este arquivo para supabase/migrations.
--
-- O script é idempotente: produtos existentes com a mesma referência DEMO-*
-- são atualizados, e os demais são inseridos. Nenhum produto real é removido.

do $$
declare
  v_grupo_padrao integer;
  v_unidade_id integer;
begin
  create temporary table capture_demo_products (
    referencia text primary key,
    titulo text not null,
    descricao text not null,
    fabricante text not null,
    grupo_nome text not null,
    grupo_legado text not null,
    codigobarras text not null,
    etiqueta text not null,
    local_estoque text not null,
    ncm text not null,
    preco_compra numeric(14,2) not null,
    preco_venda numeric(14,2) not null,
    estoque integer not null,
    estoque_minimo integer not null,
    destaque boolean not null default false
  ) on commit drop;

  insert into capture_demo_products
  (referencia, titulo, descricao, fabricante, grupo_nome, grupo_legado,
   codigobarras, etiqueta, local_estoque, ncm, preco_compra, preco_venda,
   estoque, estoque_minimo, destaque)
values
  ('DEMO-OLE-001', 'Óleo de Motor Sintético 5W30 1L',
   '[DEMONSTRAÇÃO] Lubrificante sintético para motores flex e gasolina.',
   'MotorPro', 'Lubrificantes e Fluidos', 'LUBRIFICANTES E FLUIDOS',
   '7899000001001', 'DEMO-PROD-001', 'A1-01', '27101932', 31.90, 54.90, 36, 10, true),

  ('DEMO-FIL-001', 'Filtro de Óleo Premium',
   '[DEMONSTRAÇÃO] Filtro de óleo para manutenção preventiva de veículos leves.',
   'AutoFilter', 'Filtros', 'FILTROS',
   '7899000001002', 'DEMO-PROD-002', 'A1-02', '84212300', 17.50, 34.90, 24, 8, true),

  ('DEMO-FIL-002', 'Filtro de Ar do Motor',
   '[DEMONSTRAÇÃO] Elemento filtrante de alta capacidade para veículos leves.',
   'AutoFilter', 'Filtros', 'FILTROS',
   '7899000001003', 'DEMO-PROD-003', 'A1-03', '84213100', 28.40, 59.90, 12, 5, false),

  ('DEMO-FRE-001', 'Jogo de Pastilhas de Freio Dianteiro',
   '[DEMONSTRAÇÃO] Jogo com quatro pastilhas para o eixo dianteiro.',
   'StopLine', 'Freios', 'FREIOS',
   '7899000001004', 'DEMO-PROD-004', 'B1-01', '68138190', 89.00, 169.90, 8, 4, true),

  ('DEMO-FRE-002', 'Disco de Freio Ventilado',
   '[DEMONSTRAÇÃO] Disco ventilado para aplicação em veículos de passeio.',
   'StopLine', 'Freios', 'FREIOS',
   '7899000001005', 'DEMO-PROD-005', 'B1-02', '87083090', 138.00, 239.90, 4, 4, false),

  ('DEMO-COR-001', 'Kit Correia Dentada com Tensor',
   '[DEMONSTRAÇÃO] Kit para manutenção do sincronismo do motor.',
   'DriveMax', 'Correias e Tensores', 'CORREIAS/TENSORES',
   '7899000001006', 'DEMO-PROD-006', 'B2-01', '40103500', 175.00, 319.90, 6, 3, true),

  ('DEMO-IGN-001', 'Jogo de Velas de Ignição',
   '[DEMONSTRAÇÃO] Jogo com quatro velas resistivas para motor flex.',
   'SparkTech', 'Ignição', 'IGNICAO',
   '7899000001007', 'DEMO-PROD-007', 'B2-02', '85111000', 72.00, 129.90, 10, 4, false),

  ('DEMO-BAT-001', 'Bateria Automotiva 60 Ah',
   '[DEMONSTRAÇÃO] Bateria selada de 12 V e capacidade nominal de 60 Ah.',
   'VoltMax', 'Baterias', 'BATERIAS',
   '7899000001008', 'DEMO-PROD-008', 'C1-01', '85071090', 389.00, 549.90, 3, 2, true),

  ('DEMO-ARR-001', 'Aditivo para Radiador Concentrado 1L',
   '[DEMONSTRAÇÃO] Fluido concentrado para sistemas de arrefecimento.',
   'CoolGuard', 'Arrefecimento', 'ARREFECIMENTO',
   '7899000001009', 'DEMO-PROD-009', 'C1-02', '38200000', 24.50, 49.90, 18, 6, false),

  ('DEMO-FLU-001', 'Fluido de Freio DOT 4 500 ml',
   '[DEMONSTRAÇÃO] Fluido sintético para sistemas hidráulicos de freio.',
   'StopLine', 'Lubrificantes e Fluidos', 'LUBRIFICANTES E FLUIDOS',
   '7899000001010', 'DEMO-PROD-010', 'C1-03', '38190000', 18.90, 38.90, 5, 5, false),

  ('DEMO-SUS-001', 'Amortecedor Dianteiro Pressurizado',
   '[DEMONSTRAÇÃO] Amortecedor pressurizado para suspensão dianteira.',
   'RoadComfort', 'Suspensão', 'SUSPENSAO',
   '7899000001011', 'DEMO-PROD-011', 'D1-01', '87088000', 248.00, 419.90, 4, 2, true),

  ('DEMO-ILU-001', 'Lâmpada Halógena H7 12V 55W',
   '[DEMONSTRAÇÃO] Lâmpada automotiva para farol principal.',
   'LightDrive', 'Iluminação', 'ILUMINACAO/SINALIZACAO',
   '7899000001012', 'DEMO-PROD-012', 'D1-02', '85392110', 19.90, 44.90, 15, 6, false),

  ('DEMO-LIM-001', 'Palheta Limpador de Para-brisa 22 pol.',
   '[DEMONSTRAÇÃO] Palheta flexível com encaixe universal.',
   'ClearView', 'Acessórios', 'ACESSORIOS',
   '7899000001013', 'DEMO-PROD-013', 'D2-01', '85124010', 27.00, 59.90, 9, 4, false),

  ('DEMO-COR-002', 'Correia de Acessórios Micro-V',
   '[DEMONSTRAÇÃO] Correia estriada para alternador e acessórios.',
   'DriveMax', 'Correias e Tensores', 'CORREIAS/TENSORES',
   '7899000001014', 'DEMO-PROD-014', 'D2-02', '40103100', 44.00, 89.90, 2, 4, false),

  ('DEMO-SEN-001', 'Sensor de Oxigênio 4 Fios',
   '[DEMONSTRAÇÃO] Sensor para monitoramento da mistura ar-combustível.',
   'AutoSense', 'Sensores e Atuadores', 'SENSORES E ATUADORES',
   '7899000001015', 'DEMO-PROD-015', 'E1-01', '90271000', 179.00, 329.90, 0, 2, true);

  insert into public.produtogrupo (nome, descricao, ativo)
  select distinct
    c.grupo_nome,
    'Grupo criado para o catálogo de demonstração',
    true
  from capture_demo_products c
  where not exists (
    select 1
      from public.produtogrupo pg
     where upper(pg.nome) = upper(c.grupo_nome)
  );

  select id
    into v_grupo_padrao
    from public.produtogrupo
   where ativo = true
   order by id
   limit 1;

  if v_grupo_padrao is null then
    insert into public.produtogrupo (nome, descricao, ativo)
    values ('Outros', 'Grupo padrão do catálogo de demonstração', true)
    returning id into v_grupo_padrao;
  end if;

  select id
    into v_unidade_id
    from public.unidademedida
   where upper(sigla) = 'UN'
   order by id
   limit 1;

  if v_unidade_id is null then
    insert into public.unidademedida (sigla, descricao, ativo)
    values ('UN', 'Unidade', true)
    returning id into v_unidade_id;
  end if;

  update public.produto p
     set titulo = c.titulo,
         descricao = c.descricao,
         fabricante = c.fabricante,
         grupo = c.grupo_legado::public.grupo_produto,
         grupo_produto_id = coalesce(
           (select pg.id
              from public.produtogrupo pg
             where upper(pg.nome) = upper(c.grupo_nome)
             order by pg.id
             limit 1),
           v_grupo_padrao
         ),
         unidade = 'UN'::public.unidade_medida,
         tipo_unidade_id = v_unidade_id,
         codigobarras = c.codigobarras,
         etiqueta = c.etiqueta,
         local = c.local_estoque,
         ncm = c.ncm,
         cfop = '5102',
         precocompra = c.preco_compra,
         ultimovalordecompra = c.preco_compra,
         precovenda = c.preco_venda,
         estoque = c.estoque,
         estoqueminimo = c.estoque_minimo,
         conservacao = 'NOVO'::public.enum_produto_conservacao,
         "exibirPdv" = true,
         destaque = c.destaque,
         is_deleted = false,
         deleted_at = null,
         deleted_by = null,
         updatedat = now()
    from capture_demo_products c
   where p.referencia = c.referencia;

  insert into public.produto (
    titulo, descricao, fabricante, referencia, grupo, grupo_produto_id,
    unidade, tipo_unidade_id, codigobarras, etiqueta, local, ncm, cfop,
    precocompra, ultimovalordecompra, precovenda, estoque, estoqueminimo,
    conservacao, "exibirPdv", destaque, is_deleted
  )
  select
    c.titulo,
    c.descricao,
    c.fabricante,
    c.referencia,
    c.grupo_legado::public.grupo_produto,
    coalesce(
      (select pg.id
         from public.produtogrupo pg
        where upper(pg.nome) = upper(c.grupo_nome)
        order by pg.id
        limit 1),
      v_grupo_padrao
    ),
    'UN'::public.unidade_medida,
    v_unidade_id,
    c.codigobarras,
    c.etiqueta,
    c.local_estoque,
    c.ncm,
    '5102',
    c.preco_compra,
    c.preco_compra,
    c.preco_venda,
    c.estoque,
    c.estoque_minimo,
    'NOVO'::public.enum_produto_conservacao,
    true,
    c.destaque,
    false
  from capture_demo_products c
  where not exists (
    select 1
      from public.produto p
     where p.referencia = c.referencia
  );
end
$$;

-- Conferência: deve retornar 15 produtos.
select
  id,
  referencia,
  titulo,
  fabricante,
  estoque,
  estoqueminimo,
  status_estoque,
  precovenda,
  local
from public.produto
where referencia like 'DEMO-%'
  and is_deleted = false
order by referencia;
