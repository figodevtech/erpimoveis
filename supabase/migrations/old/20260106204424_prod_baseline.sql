


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "public"."banco_tipo" AS ENUM (
    'CORRENTE',
    'POUPANCA',
    'DIGITAL',
    'PAGAMENTO',
    'SALARIO',
    'EMPRESARIAL'
);


ALTER TYPE "public"."banco_tipo" OWNER TO "postgres";


CREATE TYPE "public"."categoria_transacao" AS ENUM (
    'SERVICO',
    'PRODUTO',
    'TRANSPORTE_LOGISTICA',
    'COMISSAO_REPASSE',
    'TRANSFERENCIA',
    'ALUGUEL',
    'EQUIPAMENTO_FERRAMENTA',
    'OUTROS',
    'PECA',
    'SALARIO',
    'IMPOSTO_TAXA',
    'UTILIDADE',
    'ORDEM_SERVICO',
    'VENDA'
);


ALTER TYPE "public"."categoria_transacao" OWNER TO "postgres";


CREATE TYPE "public"."cliente_rank" AS ENUM (
    'EXCELENTE',
    'ALTO',
    'NORMAL',
    'BAIXO'
);


ALTER TYPE "public"."cliente_rank" OWNER TO "postgres";


CREATE TYPE "public"."enum_alvo_reparo" AS ENUM (
    'VEICULO',
    'PECA'
);


ALTER TYPE "public"."enum_alvo_reparo" OWNER TO "postgres";


CREATE TYPE "public"."enum_ambiente_nfe" AS ENUM (
    'HOMOLOGACAO',
    'PRODUCAO'
);


ALTER TYPE "public"."enum_ambiente_nfe" OWNER TO "postgres";


CREATE TYPE "public"."enum_estoque_status_produto" AS ENUM (
    'OK',
    'BAIXO',
    'CRITICO',
    'SEM_ESTOQUE'
);


ALTER TYPE "public"."enum_estoque_status_produto" OWNER TO "postgres";


CREATE TYPE "public"."enum_modelo_nfe" AS ENUM (
    'NFE',
    'NFCE'
);


ALTER TYPE "public"."enum_modelo_nfe" OWNER TO "postgres";


CREATE TYPE "public"."enum_prioridade_os" AS ENUM (
    'BAIXA',
    'NORMAL',
    'ALTA'
);


ALTER TYPE "public"."enum_prioridade_os" OWNER TO "postgres";


CREATE TYPE "public"."enum_status_aprovacao" AS ENUM (
    'PENDENTE',
    'APROVADA',
    'REPROVADA'
);


ALTER TYPE "public"."enum_status_aprovacao" OWNER TO "postgres";


CREATE TYPE "public"."enum_status_checklist" AS ENUM (
    'OK',
    'ALERTA',
    'FALHA'
);


ALTER TYPE "public"."enum_status_checklist" OWNER TO "postgres";


CREATE TYPE "public"."enum_status_cliente" AS ENUM (
    'ATIVO',
    'INATIVO',
    'PENDENTE'
);


ALTER TYPE "public"."enum_status_cliente" OWNER TO "postgres";


CREATE TYPE "public"."enum_status_nfe" AS ENUM (
    'RASCUNHO',
    'ASSINADA',
    'ENVIADA',
    'AUTORIZADA',
    'REJEITADA',
    'CANCELADA',
    'PENDENTE_ENVIO',
    'DENEGADA'
);


ALTER TYPE "public"."enum_status_nfe" OWNER TO "postgres";


CREATE TYPE "public"."enum_status_os" AS ENUM (
    'ORCAMENTO',
    'EM_ANDAMENTO',
    'PAGAMENTO',
    'CONCLUIDO',
    'CANCELADO',
    'APROVACAO_ORCAMENTO',
    'ORCAMENTO_APROVADO',
    'ORCAMENTO_RECUSADO',
    'AGUARDANDO_CHECKLIST'
);


ALTER TYPE "public"."enum_status_os" OWNER TO "postgres";


CREATE TYPE "public"."enum_status_venda" AS ENUM (
    'ABERTA',
    'PAGAMENTO',
    'FINALIZADA',
    'CANCELADA'
);


ALTER TYPE "public"."enum_status_venda" OWNER TO "postgres";


CREATE TYPE "public"."enum_tipo_desconto_venda" AS ENUM (
    'PORCENTAGEM',
    'FIXO'
);


ALTER TYPE "public"."enum_tipo_desconto_venda" OWNER TO "postgres";


CREATE TYPE "public"."enum_tipo_os" AS ENUM (
    'MANUTENCAO',
    'REVISAO',
    'INSTALACAO',
    'DIAGNOSTICO'
);


ALTER TYPE "public"."enum_tipo_os" OWNER TO "postgres";


CREATE TYPE "public"."enum_tipo_pagamento" AS ENUM (
    'DINHEIRO',
    'CARTAO',
    'PIX',
    'BOLETO',
    'TRANSFERENCIA'
);


ALTER TYPE "public"."enum_tipo_pagamento" OWNER TO "postgres";


CREATE TYPE "public"."enum_tipomovimentacao" AS ENUM (
    'ENTRADA',
    'SAIDA',
    'AJUSTE'
);


ALTER TYPE "public"."enum_tipomovimentacao" OWNER TO "postgres";


CREATE TYPE "public"."enum_tipopessoa" AS ENUM (
    'FISICA',
    'JURIDICA'
);


ALTER TYPE "public"."enum_tipopessoa" OWNER TO "postgres";


CREATE TYPE "public"."estoque_status" AS ENUM (
    'OK',
    'BAIXO',
    'CRITICO',
    'SEM_ESTOQUE'
);


ALTER TYPE "public"."estoque_status" OWNER TO "postgres";


CREATE TYPE "public"."grupo_produto" AS ENUM (
    'MOTOR',
    'INJECAO ELETRONICA',
    'IGNICAO',
    'ARREFECIMENTO',
    'AR CONDICIONADO/CLIMATIZACAO',
    'LUBRIFICANTES E FLUIDOS',
    'FILTROS',
    'TRANSMISSAO',
    'EMBREAGEM',
    'DIFERENCIAL E EIXOS',
    'DIRECAO',
    'SUSPENSAO',
    'FREIOS',
    'PNEUS E RODAS',
    'ESCAPAMENTO',
    'ELETRICA',
    'BATERIAS',
    'ILUMINACAO/SINALIZACAO',
    'SENSORES E ATUADORES',
    'INSTRUMENTOS DE MEDICAO',
    'DIAGNOSTICO E SCANNER',
    'CARROCERIA/LATARIA',
    'VIDROS/RETROVISORES',
    'INTERIOR ACABAMENTOS',
    'JUNTAS/RETENTORES ORINGS',
    'CORREIAS/TENSORES',
    'CABOS E MANGUEIRAS',
    'FIXADORES/PARAFUSOS',
    'COLAS E SELANTES',
    'ADITIVOS E QUIMICOS',
    'ESTETICA/LIMPEZA',
    'MATERIAIS/PINTURA',
    'ABRASIVOS/LIXAS',
    'FERRAMENTAS MANUAIS',
    'FERRAMENTAS ELETRICAS PNEUMATICAS',
    'EQUIPAMENTOS DE OFICINA',
    'EPI/SEGURANCA',
    'ORGANIZACAO/ARMAZENAGEM',
    'ACESSORIOS',
    'OUTROS'
);


ALTER TYPE "public"."grupo_produto" OWNER TO "postgres";


CREATE TYPE "public"."metodo_pagamento" AS ENUM (
    'PIX',
    'CREDITO',
    'DEBITO',
    'BOLETO',
    'TRANSFERENCIA',
    'DINHEIRO'
);


ALTER TYPE "public"."metodo_pagamento" OWNER TO "postgres";


CREATE TYPE "public"."tipo_veiculo" AS ENUM (
    'MOTOS',
    'CARROS',
    'CAMINHOES'
);


ALTER TYPE "public"."tipo_veiculo" OWNER TO "postgres";


CREATE TYPE "public"."tipos_transacao" AS ENUM (
    'RECEITA',
    'DESPESA',
    'DEPOSITO',
    'SAQUE'
);


ALTER TYPE "public"."tipos_transacao" OWNER TO "postgres";


CREATE TYPE "public"."unidade_medida" AS ENUM (
    'UN',
    'JGO',
    'KIT',
    'PAR',
    'CX',
    'PCT'
);


ALTER TYPE "public"."unidade_medida" OWNER TO "postgres";


CREATE TYPE "public"."user_role" AS ENUM (
    'ADMIN',
    'USER'
);


ALTER TYPE "public"."user_role" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."atualizar_totais_nfe"("p_nfe_id" bigint) RETURNS "void"
    LANGUAGE "sql"
    AS $$
  update nfe
  set
    total_produtos = coalesce((
      select sum(ni.valor_total)
      from nfe_item ni
      where ni.nfe_id = nfe.id
    ), 0),
    total_nfe = coalesce((
      select sum(ni.valor_total)
      from nfe_item ni
      where ni.nfe_id = nfe.id
    ), 0),
    updatedat = now()
  where id = p_nfe_id;
$$;


ALTER FUNCTION "public"."atualizar_totais_nfe"("p_nfe_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."criar_nfe_de_os"("p_ordemservicoid" integer) RETURNS bigint
    LANGUAGE "plpgsql"
    AS $$DECLARE
  v_nfe_id      bigint;
  v_numero      int;
  v_serie       int;
  v_modelo      public.enum_modelo_nfe;
  v_ambiente    public.enum_ambiente_nfe;
  v_chave       char(44);
  v_dataemissao timestamptz := now();
  v_cod_uf      text;
  v_cnpj_emit   text;
  v_ano         text;
  v_mes         text;
  v_mod         text;
  v_serie_str   text;
  v_numero_str  text;
  v_tp_emis     text;
  v_cod_nf      text;
  v_cdv         text;

  -- por enquanto fixo; depois você pode amarrar a empresa da OS
  v_empresaid   bigint := 1;

  v_cfg         nfe_config%ROWTYPE;
  v_emp         empresa%ROWTYPE;
BEGIN
  --------------------------------------------------------------------
  -- 1) Validar se a OS existe
  --------------------------------------------------------------------
  IF NOT EXISTS (SELECT 1 FROM ordemservico WHERE id = p_ordemservicoid) THEN
    RAISE EXCEPTION 'OS % não encontrada', p_ordemservicoid;
  END IF;

  --------------------------------------------------------------------
  -- 2) Carregar EMPRESA e NFE_CONFIG da empresa
  --------------------------------------------------------------------
  SELECT *
    INTO v_emp
  FROM empresa
  WHERE id = v_empresaid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Empresa % não encontrada na tabela EMPRESA', v_empresaid;
  END IF;

  SELECT *
    INTO v_cfg
  FROM nfe_config
  WHERE empresaid = v_empresaid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Configuração de NF-e (nfe_config) não encontrada para empresa %', v_empresaid;
  END IF;

  --------------------------------------------------------------------
  -- 3) Puxar parâmetros da config
  --------------------------------------------------------------------
  v_modelo   := v_cfg.modelo;
  v_serie    := v_cfg.serie;
  v_ambiente := v_cfg.ambiente;
  v_tp_emis  := v_cfg.tp_emis::text;   -- tp_emis é smallint na config

  -- cUF = 2 primeiros dígitos do código do município
  v_cod_uf := substring(coalesce(v_emp.codigomunicipio, '') FROM 1 FOR 2);

  IF v_cod_uf IS NULL OR length(v_cod_uf) <> 2 THEN
    RAISE EXCEPTION 'Código de município inválido para empresa % (codigomunicipio=%)',
      v_empresaid, v_emp.codigomunicipio;
  END IF;

  -- CNPJ somente números
  v_cnpj_emit := regexp_replace(coalesce(v_emp.cnpj, ''), '\D', '', 'g');

  IF length(v_cnpj_emit) <> 14 THEN
    RAISE EXCEPTION 'CNPJ da empresa % inválido (%). Deve ter 14 dígitos numéricos.',
      v_empresaid, v_emp.cnpj;
  END IF;

  v_ano := to_char(v_dataemissao, 'YY');
  v_mes := to_char(v_dataemissao, 'MM');
  v_mod := '55';  -- NF-e

  --------------------------------------------------------------------
  -- 4) Descobrir próximo número da NF-e a partir do nfe_config
  --    (ultimo_numero + 1)
  --------------------------------------------------------------------
  v_numero := v_cfg.ultimo_numero + 1;

  v_serie_str  := lpad(v_serie::text, 3, '0');
  v_numero_str := lpad(v_numero::text, 9, '0');

  --------------------------------------------------------------------
  -- 5) Gerar cNF (8 dígitos) aleatório
  --------------------------------------------------------------------
  v_cod_nf := lpad((floor(random() * 99999999))::int::text, 8, '0');

  --------------------------------------------------------------------
  -- 6) Montar chave de acesso SEM o DV
  --    cUF(2) + AAMM(4) + CNPJ(14) + mod(2) + série(3)
  --    + nNF(9) + tpEmis(1) + cNF(8)
  --------------------------------------------------------------------
  v_chave :=
    (v_cod_uf || v_ano || v_mes || v_cnpj_emit || v_mod ||
     v_serie_str || v_numero_str || v_tp_emis || v_cod_nf);

  --------------------------------------------------------------------
  -- 7) Calcular dígito verificador (módulo 11)
  --------------------------------------------------------------------
  DECLARE
    soma int := 0;
    peso int := 2;
    i    int;
    dig  int;
    ch_sem_dv text := v_chave;
  BEGIN
    FOR i IN REVERSE length(ch_sem_dv)..1 LOOP
      soma := soma + (substr(ch_sem_dv, i, 1)::int * peso);
      peso := peso + 1;
      IF peso > 9 THEN
        peso := 2;
      END IF;
    END LOOP;

    dig := 11 - (soma % 11);

    -- mantém a mesma regra que você já estava usando
    IF dig = 0 OR dig = 1 THEN
      dig := 0;
    END IF;

    v_cdv := dig::text;
  END;

  v_chave := v_chave || v_cdv;

  --------------------------------------------------------------------
  -- 8) Inserir na tabela NFE (RASCUNHO)
  --------------------------------------------------------------------
  INSERT INTO nfe (
    modelo,
    serie,
    numero,
    chave_acesso,
    ambiente,
    status,
    ordemservicoid,
    vendaid,
    clienteid,
    empresaid,
    dataemissao,
    total_produtos,
    total_servicos,
    total_nfe,
    xml_assinado,
    xml_autorizado
  )
  SELECT
    v_modelo,
    v_serie,
    v_numero,
    v_chave,
    v_ambiente,
    'RASCUNHO',
    os.id,
    NULL,
    os.clienteid,
    v_empresaid,          -- antes era 3 fixo
    v_dataemissao,
    0,
    0,
    0,
    NULL,
    NULL
  FROM ordemservico os
  WHERE os.id = p_ordemservicoid
  RETURNING id INTO v_nfe_id;

  --------------------------------------------------------------------
  -- 9) Atualizar nfe_config.ultimo_numero
  --------------------------------------------------------------------
  UPDATE nfe_config
     SET ultimo_numero = v_numero,
         updatedat     = now()
   WHERE id = v_cfg.id;

  RETURN v_nfe_id;
END;$$;


ALTER FUNCTION "public"."criar_nfe_de_os"("p_ordemservicoid" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."criar_nfe_de_venda"("p_vendaid" integer) RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$declare
  v_nfe_id      bigint;
  v_numero      int;
  v_serie       int;
  v_modelo      public.enum_modelo_nfe;
  v_ambiente    public.enum_ambiente_nfe;
  v_chave       char(44);
  v_dataemissao timestamptz := now();
  v_cod_uf      text;
  v_cnpj_emit   text;
  v_ano         text;
  v_mes         text;
  v_mod         text;
  v_serie_str   text;
  v_numero_str  text;
  v_tp_emis     text;
  v_cod_nf      text;
  v_cdv         text;

  -- por enquanto fixo; você pode amarrar depois
  v_empresaid   bigint := 1;

  v_cfg         public.nfe_config%rowtype;
  v_emp         public.empresa%rowtype;
  v_venda       public.venda%rowtype;
begin
  -- 1) Validar se a VENDA existe
  select * into v_venda
  from public.venda
  where id = p_vendaid;

  if not found then
    raise exception 'Venda % não encontrada', p_vendaid;
  end if;

  -- 2) Carregar EMPRESA e NFE_CONFIG
  select * into v_emp
  from public.empresa
  where id = v_empresaid;

  if not found then
    raise exception 'Empresa % não encontrada na tabela EMPRESA', v_empresaid;
  end if;

  select * into v_cfg
  from public.nfe_config
  where empresaid = v_empresaid;

  if not found then
    raise exception 'Configuração de NF-e (nfe_config) não encontrada para empresa %', v_empresaid;
  end if;

  -- 3) Puxar parâmetros da config
  v_modelo   := v_cfg.modelo;
  v_serie    := v_cfg.serie;
  v_ambiente := v_cfg.ambiente;
  v_tp_emis  := v_cfg.tp_emis::text;

  -- cUF = 2 primeiros dígitos do código do município
  v_cod_uf := substring(coalesce(v_emp.codigomunicipio, '') from 1 for 2);

  if v_cod_uf is null or length(v_cod_uf) <> 2 then
    raise exception 'Código de município inválido para empresa % (codigomunicipio=%)',
      v_empresaid, v_emp.codigomunicipio;
  end if;

  -- CNPJ somente números
  v_cnpj_emit := regexp_replace(coalesce(v_emp.cnpj, ''), '\D', '', 'g');

  if length(v_cnpj_emit) <> 14 then
    raise exception 'CNPJ da empresa % inválido (%). Deve ter 14 dígitos numéricos.',
      v_empresaid, v_emp.cnpj;
  end if;

  v_ano := to_char(v_dataemissao, 'YY');
  v_mes := to_char(v_dataemissao, 'MM');
  v_mod := '55';

  -- 4) Próximo número (ultimo_numero + 1)
  v_numero := v_cfg.ultimo_numero + 1;

  v_serie_str  := lpad(v_serie::text, 3, '0');
  v_numero_str := lpad(v_numero::text, 9, '0');

  -- 5) cNF (8 dígitos)
  v_cod_nf := lpad((floor(random() * 99999999))::int::text, 8, '0');

  -- 6) chave sem DV
  v_chave :=
    (v_cod_uf || v_ano || v_mes || v_cnpj_emit || v_mod ||
     v_serie_str || v_numero_str || v_tp_emis || v_cod_nf);

  -- 7) DV (módulo 11)
  declare
    soma int := 0;
    peso int := 2;
    i    int;
    dig  int;
    ch_sem_dv text := v_chave;
  begin
    for i in reverse length(ch_sem_dv)..1 loop
      soma := soma + (substr(ch_sem_dv, i, 1)::int * peso);
      peso := peso + 1;
      if peso > 9 then
        peso := 2;
      end if;
    end loop;

    dig := 11 - (soma % 11);

    if dig = 0 or dig = 1 then
      dig := 0;
    end if;

    v_cdv := dig::text;
  end;

  v_chave := v_chave || v_cdv;

  -- 8) Inserir NFE (RASCUNHO) vinculada à VENDA
  insert into public.nfe (
    modelo,
    serie,
    numero,
    chave_acesso,
    ambiente,
    status,
    ordemservicoid,
    vendaid,
    clienteid,
    empresaid,
    dataemissao,
    total_produtos,
    total_servicos,
    total_nfe,
    xml_assinado,
    xml_autorizado
  )
  values (
    v_modelo,
    v_serie,
    v_numero,
    v_chave,
    v_ambiente,
    'RASCUNHO',
    null,
    v_venda.id,
    v_venda.clienteid,
    v_empresaid,
    v_dataemissao,
    0,
    0,
    0,
    null,
    null
  )
  returning id into v_nfe_id;

  -- 9) Atualizar nfe_config.ultimo_numero
  update public.nfe_config
     set ultimo_numero = v_numero,
         updatedat     = now()
   where id = v_cfg.id;

  return v_nfe_id;
end;$$;


ALTER FUNCTION "public"."criar_nfe_de_venda"("p_vendaid" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."estornar_baixa_estoque_os"("p_os_id" integer) RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
begin
  -- devolve tudo que foi baixado
  update public.produto p
     set estoque = p.estoque + b.quantidade
    from public.osproduto_baixa b
   where b.ordemservicoid = p_os_id
     and p.id = b.produtoid;

  delete from public.osproduto_baixa
   where ordemservicoid = p_os_id;
end
$$;


ALTER FUNCTION "public"."estornar_baixa_estoque_os"("p_os_id" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_baixa_estoque_produto"("p_produto_id" integer, "p_quantidade" integer) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  v_estoque integer;
begin
  -- quantidade inválida: não faz nada
  if p_quantidade is null or p_quantidade <= 0 then
    return;
  end if;

  -- trava a linha para evitar corrida de concorrência
  select estoque
    into v_estoque
  from produto
  where id = p_produto_id
  for update;

  if v_estoque is null then
    raise exception 'Produto % não encontrado para baixa de estoque.', p_produto_id
      using errcode = 'P0001';
  end if;

  if v_estoque < p_quantidade then
    raise exception 'Estoque insuficiente para produto %, em estoque: %, necessário: %',
      p_produto_id, v_estoque, p_quantidade
      using errcode = 'P0001';
  end if;

  update produto
    set estoque = estoque - p_quantidade,
        updatedat = now()
  where id = p_produto_id;
end;
$$;


ALTER FUNCTION "public"."fn_baixa_estoque_produto"("p_produto_id" integer, "p_quantidade" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_criar_venda_com_itens"("p_venda" "jsonb") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$declare
  v_cliente_id integer;
  v_created_by uuid;
  v_status public.enum_status_venda;
  v_desconto_tipo public.enum_tipo_desconto_venda;
  v_desconto_valor numeric;
  v_sub_total numeric;
  v_valor_total numeric;
  v_data_venda timestamp; -- ou timestamptz se sua coluna for assim

  v_venda_id integer;

  v_itens jsonb;
  v_item jsonb;
  v_produto_id integer;
  v_quantidade integer;
  v_item_sub_total numeric;
  v_item_valor_total numeric;
  v_item_valor_desconto numeric;
  v_item_tipo_desconto public.enum_tipo_desconto_venda;
begin
  -- Campos obrigatórios
  v_cliente_id := (p_venda->>'clienteId')::integer;
  v_created_by := (p_venda->>'created_by')::uuid;
  v_status := (p_venda->>'status')::public.enum_status_venda;
  v_sub_total := (p_venda->>'subTotal')::numeric;
  v_valor_total := (p_venda->>'valorTotal')::numeric;
  v_data_venda := nullif(p_venda->>'dataVenda', '')::timestamp;

  if v_cliente_id is null
     or v_created_by is null
     or v_status is null
     or v_sub_total is null
     or v_valor_total is null then
    raise exception 'Campos obrigatórios ausentes em p_venda (clienteId, created_by, status, subTotal, valorTotal).'
      using errcode = 'P0001';
  end if;

  -- Campos opcionais
  if p_venda ? 'descontoTipo' then
    v_desconto_tipo := nullif(p_venda->>'descontoTipo', '')::public.enum_tipo_desconto_venda;
  end if;

  if p_venda ? 'descontoValor' then
    v_desconto_valor := nullif(p_venda->>'descontoValor', '')::numeric;
  end if;

  -- Itens
  v_itens := p_venda->'itens';

  if v_itens is null or jsonb_typeof(v_itens) <> 'array' then
    raise exception 'p_venda.itens deve ser um array JSON.'
      using errcode = 'P0001';
  end if;

  if jsonb_array_length(v_itens) = 0 then
    raise exception 'p_venda.itens não pode ser vazio.'
      using errcode = 'P0001';
  end if;

  -- 1) Para cada item: validação básica + baixa de estoque (chamada à fn_baixa_estoque_produto)
  for v_item in
    select value
    from jsonb_array_elements(v_itens) as t(value)
  loop
    v_produto_id := (v_item->>'produtoId')::integer;
    v_quantidade := (v_item->>'quantidade')::integer;

    if v_produto_id is null or v_quantidade is null or v_quantidade <= 0 then
      raise exception 'Cada item deve possuir produtoId e quantidade > 0.'
        using errcode = 'P0001';
    end if;

    -- Dá baixa no estoque (valida e atualiza)
    perform public.fn_baixa_estoque_produto(v_produto_id, v_quantidade);
  end loop;

  -- 2) Cria a venda
  insert into public.venda (
    clienteid,
    created_by,
    status,
    sub_total,
    valortotal,
    desconto_tipo,
    desconto_valor,
    datavenda
  ) values (
    v_cliente_id,
    v_created_by,
    v_status,
    v_sub_total,
    v_valor_total,
    v_desconto_tipo,
    v_desconto_valor,
    coalesce(v_data_venda, now())
  )
  returning id into v_venda_id;

  -- 3) Cria os itens (vendaproduto)
  for v_item in
    select value
    from jsonb_array_elements(v_itens) as t(value)
  loop
    v_produto_id := (v_item->>'produtoId')::integer;
    v_quantidade := (v_item->>'quantidade')::integer;
    v_item_sub_total := (v_item->>'subTotal')::numeric;
    v_item_valor_total := (v_item->>'valorTotal')::numeric;

    if v_item->>'valorDesconto' is not null then
      v_item_valor_desconto := (v_item->>'valorDesconto')::numeric;
    else
      v_item_valor_desconto := null;
    end if;

    if v_item->>'tipoDesconto' is not null then
      v_item_tipo_desconto := (v_item->>'tipoDesconto')::public.enum_tipo_desconto_venda;
    else
      v_item_tipo_desconto := null;
    end if;

    insert into public.vendaproduto (
      venda_id,
      produtoid,
      quantidade,
      sub_total,
      valor_total,
      valor_desconto,
      tipo_desconto
    ) values (
      v_venda_id,
      v_produto_id,
      v_quantidade,
      v_item_sub_total,
      v_item_valor_total,
      v_item_valor_desconto,
      v_item_tipo_desconto
    );
  end loop;

  return v_venda_id;
end;$$;


ALTER FUNCTION "public"."fn_criar_venda_com_itens"("p_venda" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_fill_titulo_marketplace"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$begin
  if new."tituloMarketplace" is null
     or btrim(new."tituloMarketplace") = '' then
    new."tituloMarketplace" := new.titulo;
  end if;

  return new;
end;$$;


ALTER FUNCTION "public"."fn_fill_titulo_marketplace"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_os_execucao_set_times"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  -- Quando entra em EM_ANDAMENTO, marca início (só se ainda não tiver)
  if (new.status::text = 'EM_ANDAMENTO' and old.status is distinct from new.status) then
    new.execucao_inicio_em := coalesce(old.execucao_inicio_em, now());
    new.execucao_fim_em := null; -- se voltar para andamento, reabre a execução
  end if;

  -- Quando entra em PAGAMENTO, marca fim (só se tiver início e ainda não tiver fim)
  if (new.status::text = 'PAGAMENTO' and old.status is distinct from new.status) then
    if (old.execucao_inicio_em is not null) then
      new.execucao_inicio_em := old.execucao_inicio_em;
      new.execucao_fim_em := coalesce(old.execucao_fim_em, now());
    end if;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."fn_os_execucao_set_times"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_set_status_estoque"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$begin
  new.status_estoque :=
    case
      when new.estoque <= 0 then 'SEM_ESTOQUE'
      when new.estoque <= (new.estoqueminimo / 2) then 'CRITICO'
      when new.estoque <= new.estoqueminimo then 'BAIXO'
      else 'OK'
    end;
  return new;
end;$$;


ALTER FUNCTION "public"."fn_set_status_estoque"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_set_titulo_marketplace_product"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$begin
  new.tituloMarketplace :=
    case
      when new.tituloMarketplace = '' then new.titulo
    end;
  return new;
end;$$;


ALTER FUNCTION "public"."fn_set_titulo_marketplace_product"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_auth_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  insert into public.usuario (id, email, nome, perfilid, setorid, createdat, updatedat)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'nome', new.email),
    nullif(new.raw_user_meta_data->>'perfilid','')::int,
    nullif(new.raw_user_meta_data->>'setorid','')::int,
    now(),
    now()
  )
  on conflict (id) do update
    set email     = excluded.email,
        nome      = coalesce(excluded.nome, public.usuario.nome),
        perfilid  = coalesce(excluded.perfilid, public.usuario.perfilid),
        setorid   = coalesce(excluded.setorid, public.usuario.setorid),
        updatedat = now();

  return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_auth_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_update_auth_user_email"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.email is distinct from old.email then
    update public.usuario
       set email = new.email,
           updatedat = now()
     where id = new.id;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."handle_update_auth_user_email"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."normalize_placa"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.placa := upper(regexp_replace(new.placa, '[^A-Za-z0-9]', '', 'g'));
  return new;
end;
$$;


ALTER FUNCTION "public"."normalize_placa"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."preencher_itens_nfe_de_os"("p_nfe_id" bigint) RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
declare
  v_nfe record;
begin
  --------------------------------------------------------------------
  -- 1) Verifica se a NF-e existe e está vinculada a uma OS
  --------------------------------------------------------------------
  select *
    into v_nfe
  from nfe
  where id = p_nfe_id;

  if not found then
    raise exception 'NF-e % não encontrada na tabela nfe', p_nfe_id;
  end if;

  if v_nfe.ordemservicoid is null then
    raise exception
      'NF-e % não está vinculada a uma ordem de serviço (ordemservicoid nulo).',
      p_nfe_id;
  end if;

  --------------------------------------------------------------------
  -- 2) Remove itens anteriores da NF-e (se houver) para recriar do zero
  --------------------------------------------------------------------
  delete from nfe_item
  where nfe_id = p_nfe_id;

  --------------------------------------------------------------------
  -- 3) Insere itens da OS (osproduto) na nfe_item,
  --    herdando ICMS, PIS e COFINS do produto.
  --------------------------------------------------------------------
  insert into nfe_item (
    nfe_id,
    n_item,
    produtoid,
    descricao,
    ncm,
    cfop,
    csosn,
    cest,
    unidade,
    quantidade,
    valor_unitario,
    valor_total,
    valor_desconto,
    aliquotaicms,
    valor_bc_icms,
    valor_icms,
    cst_pis,
    aliquota_pis,
    valor_pis,
    cst_cofins,
    aliquota_cofins,
    valor_cofins,
    cst
  )
  select
    n.id as nfe_id,
    row_number() over (order by op.produtoid) as n_item,

    -- identificação do produto
    p.id as produtoid,
    coalesce(p.titulo, p.descricao) as descricao,
    p.ncm,
    coalesce(p.cfop, '5102') as cfop,
    p.csosn,
    p.cest,
    p.unidade,

    -- quantidade e valores
    op.quantidade::numeric(14,4)      as quantidade,
    op.precounitario::numeric(14,10)  as valor_unitario,
    op.subtotal::numeric(14,2)        as valor_total,
    0::numeric(14,2)                  as valor_desconto,

    -- ICMS
    p.aliquotaicms,
    op.subtotal::numeric(14,2) as valor_bc_icms,
    (
      op.subtotal
      * coalesce(p.aliquotaicms, 0) / 100
    )::numeric(14,2) as valor_icms,

    -- PIS (herdado do produto; default para 07/0,00 se não preenchido)
    coalesce(p.cst_pis, '07')                       as cst_pis,
    coalesce(p.aliquota_pis, 0)::numeric(5,2)       as aliquota_pis,
    0::numeric(14,2)                                as valor_pis,   -- se quiser, pode calcular depois

    -- COFINS (herdado do produto; default para 07/0,00 se não preenchido)
    coalesce(p.cst_cofins, '07')                    as cst_cofins,
    coalesce(p.aliquota_cofins, 0)::numeric(5,2)    as aliquota_cofins,
    0::numeric(14,2)                                as valor_cofins, -- idem

    -- CST genérico de ICMS (espelho do produto)
    p.cst
  from nfe n
  join ordemservico os on os.id = n.ordemservicoid
  join osproduto op on op.ordemservicoid = os.id
  join produto p on p.id = op.produtoid
  where n.id = p_nfe_id;

  --------------------------------------------------------------------
  -- 4) Opcional: se quiser garantir pelo menos 1 item, pode validar aqui
  --------------------------------------------------------------------
  if not exists (select 1 from nfe_item where nfe_id = p_nfe_id) then
    raise exception
      'Nenhum item foi gerado em nfe_item para a NF-e % (ordemservicoid=%).',
      p_nfe_id, v_nfe.ordemservicoid;
  end if;

end;
$$;


ALTER FUNCTION "public"."preencher_itens_nfe_de_os"("p_nfe_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."preencher_itens_nfe_de_venda"("p_nfe_id" bigint) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  v_nfe record;
begin
  -- 1) Verifica NFE e vínculo com venda
  select * into v_nfe
  from public.nfe
  where id = p_nfe_id;

  if not found then
    raise exception 'NF-e % não encontrada na tabela nfe', p_nfe_id;
  end if;

  if v_nfe.vendaid is null then
    raise exception 'NF-e % não está vinculada a uma venda (vendaid nulo).', p_nfe_id;
  end if;

  -- 2) Remove itens anteriores
  delete from public.nfe_item
  where nfe_id = p_nfe_id;

  -- 3) Insere itens da VENDA (vendaproduto) na nfe_item
  insert into public.nfe_item (
    nfe_id,
    n_item,
    produtoid,
    descricao,
    ncm,
    cfop,
    csosn,
    cest,
    unidade,
    quantidade,
    valor_unitario,
    valor_total,
    valor_desconto,
    aliquotaicms,
    valor_bc_icms,
    valor_icms,
    cst_pis,
    aliquota_pis,
    valor_pis,
    cst_cofins,
    aliquota_cofins,
    valor_cofins,
    cst
  )
  select
    n.id as nfe_id,
    row_number() over (order by vp.id) as n_item,

    p.id as produtoid,
    coalesce(p.titulo, p.descricao) as descricao,
    p.ncm,
    coalesce(p.cfop, '5102') as cfop,
    p.csosn,
    p.cest,
    p.unidade,

    vp.quantidade::numeric(14,4) as quantidade,

    case
      when vp.quantidade::numeric > 0 then
        (vp.valor_total::numeric / vp.quantidade::numeric)::numeric(14,10)
      else
        vp.valor_total::numeric::numeric(14,10)
    end as valor_unitario,

    vp.valor_total::numeric(14,2) as valor_total,
    coalesce(vp.valor_desconto, 0)::numeric(14,2) as valor_desconto,

    -- ICMS
    p.aliquotaicms,
    vp.valor_total::numeric(14,2) as valor_bc_icms,
    (
      vp.valor_total::numeric
      * coalesce(p.aliquotaicms, 0) / 100
    )::numeric(14,2) as valor_icms,

    -- PIS
    coalesce(p.cst_pis, '07') as cst_pis,
    coalesce(p.aliquota_pis, 0)::numeric(5,2) as aliquota_pis,
    0::numeric(14,2) as valor_pis,

    -- COFINS
    coalesce(p.cst_cofins, '07') as cst_cofins,
    coalesce(p.aliquota_cofins, 0)::numeric(5,2) as aliquota_cofins,
    0::numeric(14,2) as valor_cofins,

    -- CST genérico
    p.cst
  from public.nfe n
  join public.venda v on v.id = n.vendaid
  join public.vendaproduto vp on vp.venda_id = v.id
  join public.produto p on p.id = vp.produtoid
  where n.id = p_nfe_id;

  if not exists (select 1 from public.nfe_item where nfe_id = p_nfe_id) then
    raise exception 'Nenhum item foi gerado em nfe_item para a NF-e % (vendaid=%).',
      p_nfe_id, v_nfe.vendaid;
  end if;
end;
$$;


ALTER FUNCTION "public"."preencher_itens_nfe_de_venda"("p_nfe_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reaplicar_baixa_estoque_os"("p_os_id" integer) RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
declare
  r record;
  q_baixada int;
  delta int;
begin
  -- Para cada item ATUAL do orçamento
  for r in
    select p.produtoid, p.quantidade
      from public.osproduto p
     where p.ordemservicoid = p_os_id
  loop
    select b.quantidade into q_baixada
      from public.osproduto_baixa b
     where b.ordemservicoid = p_os_id
       and b.produtoid = r.produtoid;

    if q_baixada is null then
      delta := r.quantidade; -- primeira baixa
    else
      delta := r.quantidade - q_baixada; -- diferença desde a última aplicação
    end if;

    if delta > 0 then
      -- precisa baixar mais (consumir estoque)
      update public.produto
         set estoque = estoque - delta
       where id = r.produtoid
         and estoque >= delta;
      if not found then
        raise exception 'Estoque insuficiente para o produto % (necessário: %, OS %)', r.produtoid, delta, p_os_id
          using errcode = 'P0001';
      end if;

      insert into public.osproduto_baixa (ordemservicoid, produtoid, quantidade)
      values (p_os_id, r.produtoid, r.quantidade)
      on conflict (ordemservicoid, produtoid) do update
        set quantidade = excluded.quantidade;

    elsif delta < 0 then
      -- precisa devolver parte (reduziu quantidade no orçamento)
      update public.produto
         set estoque = estoque + (-delta)
       where id = r.produtoid;

      insert into public.osproduto_baixa (ordemservicoid, produtoid, quantidade)
      values (p_os_id, r.produtoid, r.quantidade)
      on conflict (ordemservicoid, produtoid) do update
        set quantidade = excluded.quantidade;
    end if;
  end loop;

  -- Itens que foram REMOVIDOS do orçamento: estorna tudo e apaga controle
  for r in
    select b.produtoid, b.quantidade
      from public.osproduto_baixa b
     where b.ordemservicoid = p_os_id
       and not exists (
         select 1 from public.osproduto p
          where p.ordemservicoid = p_os_id
            and p.produtoid = b.produtoid
       )
  loop
    update public.produto
       set estoque = estoque + r.quantidade
     where id = r.produtoid;

    delete from public.osproduto_baixa
     where ordemservicoid = p_os_id
       and produtoid      = r.produtoid;
  end loop;
end
$$;


ALTER FUNCTION "public"."reaplicar_baixa_estoque_os"("p_os_id" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."recalcular_comissao_osservico"("p_ordemservicoid" integer, "p_servicoid" integer) RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$declare
  v_subtotal numeric;
  v_qtd int;
begin
  select coalesce(s.subtotal, 0)
    into v_subtotal
  from public.osservico s
  where s.ordemservicoid = p_ordemservicoid
    and s.servicoid = p_servicoid;

  select count(*)
    into v_qtd
  from public.osservico_realizador r
  where r.ordemservicoid = p_ordemservicoid
    and r.servicoid = p_servicoid;

  if v_qtd <= 0 then
    return;
  end if;

  update public.osservico_realizador r
  set
    valor_base = round(v_subtotal / v_qtd, 2),
    valor_comissao = round((v_subtotal / v_qtd) * coalesce(r.comissao_percent_aplicada, 0) / 100.0, 2),
    updated_at = now()
  where r.ordemservicoid = p_ordemservicoid
    and r.servicoid = p_servicoid;
end;$$;


ALTER FUNCTION "public"."recalcular_comissao_osservico"("p_ordemservicoid" integer, "p_servicoid" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_checklist_modelo_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.atualizado_em := now();
  return new;
end $$;


ALTER FUNCTION "public"."set_checklist_modelo_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tg_recalc_comissao_osservico_on_subtotal"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$begin
  perform public.recalcular_comissao_osservico(new.ordemservicoid, new.servicoid);
  return new;
end;$$;


ALTER FUNCTION "public"."tg_recalc_comissao_osservico_on_subtotal"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tg_recalc_comissao_osservico_realizador"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$begin
  perform public.recalcular_comissao_osservico(
    coalesce(new.ordemservicoid, old.ordemservicoid),
    coalesce(new.servicoid, old.servicoid)
  );

  return coalesce(new, old);
end;$$;


ALTER FUNCTION "public"."tg_recalc_comissao_osservico_realizador"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tg_set_comissao_percent_aplicada"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$begin
  if new.comissao_percent_aplicada is null then
    select coalesce(u.comissao_percent, 0)
      into new.comissao_percent_aplicada
    from public.usuario u
    where u.id = new.usuarioid;
  end if;

  new.updated_at = now();
  return new;
end;$$;


ALTER FUNCTION "public"."tg_set_comissao_percent_aplicada"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."to_mercosul_equivalente"("p" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    AS $_$
  select
    case
      -- placa antiga: ABC1234 -> ABC1C34 (0->A ... 9->J)
      when p ~ '^[A-Z]{3}[0-9]{4}$' then
        substr(p,1,3) ||
        substr(p,4,1) ||
        chr(65 + cast(substr(p,5,1) as int)) ||
        substr(p,6,2)

      -- já no padrão novo (Mercosul): mantém
      when p ~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$' then
        p

      else null
    end;
$_$;


ALTER FUNCTION "public"."to_mercosul_equivalente"("p" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_os_status_estornar"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  -- Quando a OS for recusada, devolve tudo que já foi baixado
  if new.status = 'ORCAMENTO_RECUSADO' and (old.status is distinct from 'ORCAMENTO_RECUSADO') then
    perform public.estornar_baixa_estoque_os(new.id);
  end if;
  return new;
end
$$;


ALTER FUNCTION "public"."trg_os_status_estornar"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."bancoconta" (
    "id" bigint NOT NULL,
    "titulo" "text" NOT NULL,
    "created_at" timestamp with time zone NOT NULL,
    "valorinicial" real NOT NULL,
    "agencia" "text",
    "contanumero" "text",
    "tipo" "public"."banco_tipo" DEFAULT 'CORRENTE'::"public"."banco_tipo" NOT NULL,
    "proprietario" "text",
    "empresa_id" integer,
    "updated_at" timestamp with time zone NOT NULL,
    "ativo" boolean DEFAULT true
);


ALTER TABLE "public"."bancoconta" OWNER TO "postgres";


ALTER TABLE "public"."bancoconta" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."bancoconta_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."categoriaservico" (
    "id" integer NOT NULL,
    "nome" character varying NOT NULL,
    "descricao" character varying
);


ALTER TABLE "public"."categoriaservico" OWNER TO "postgres";


ALTER TABLE "public"."categoriaservico" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."categoriaservico_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."categoriatransacao" (
    "id" integer NOT NULL,
    "nome" "text" NOT NULL,
    "descricao" "text",
    "ativo" boolean DEFAULT true NOT NULL,
    "createdat" timestamp without time zone DEFAULT "now"(),
    "updatedat" timestamp without time zone DEFAULT "now"()
);


ALTER TABLE "public"."categoriatransacao" OWNER TO "postgres";


ALTER TABLE "public"."categoriatransacao" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."categoriatransacao_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."checklist" (
    "id" integer NOT NULL,
    "ordemservicoid" integer NOT NULL,
    "item" character varying NOT NULL,
    "status" "public"."enum_status_checklist" DEFAULT 'OK'::"public"."enum_status_checklist" NOT NULL,
    "observacao" character varying,
    "createdat" timestamp without time zone DEFAULT "now"()
);


ALTER TABLE "public"."checklist" OWNER TO "postgres";


ALTER TABLE "public"."checklist" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."checklist_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."checklist_modelo" (
    "id" integer NOT NULL,
    "nome" character varying NOT NULL,
    "descricao" character varying,
    "categoria" character varying,
    "ativo" boolean DEFAULT true NOT NULL,
    "criado_em" timestamp without time zone DEFAULT "now"() NOT NULL,
    "atualizado_em" timestamp without time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."checklist_modelo" OWNER TO "postgres";


ALTER TABLE "public"."checklist_modelo" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."checklist_modelo_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."checklist_modelo_item" (
    "id" integer NOT NULL,
    "modelo_id" integer NOT NULL,
    "titulo" character varying NOT NULL,
    "descricao" character varying,
    "categoria" character varying,
    "obrigatorio" boolean DEFAULT false NOT NULL,
    "ordem" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."checklist_modelo_item" OWNER TO "postgres";


ALTER TABLE "public"."checklist_modelo_item" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."checklist_modelo_item_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."cliente" (
    "id" integer NOT NULL,
    "tipopessoa" "public"."enum_tipopessoa" NOT NULL,
    "cpfcnpj" character varying NOT NULL,
    "nomerazaosocial" character varying NOT NULL,
    "email" character varying NOT NULL,
    "telefone" character varying NOT NULL,
    "endereco" character varying,
    "cidade" character varying NOT NULL,
    "estado" character varying NOT NULL,
    "cep" character varying,
    "inscricaoestadual" character varying,
    "inscricaomunicipal" character varying,
    "codigomunicipio" character varying,
    "createdat" timestamp without time zone DEFAULT "now"(),
    "updatedat" timestamp without time zone DEFAULT "now"(),
    "status" "public"."enum_status_cliente" DEFAULT 'ATIVO'::"public"."enum_status_cliente",
    "endereconumero" "text",
    "enderecocomplemento" "text",
    "bairro" "text",
    "created_by" "uuid",
    "updated_by" "uuid",
    "is_deleted" boolean DEFAULT false NOT NULL,
    "deleted_at" timestamp with time zone,
    "deleted_by" "uuid",
    "rank" "public"."cliente_rank",
    "ranked_by" "uuid",
    "ranked_at" timestamp with time zone
);


ALTER TABLE "public"."cliente" OWNER TO "postgres";


ALTER TABLE "public"."cliente" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."cliente_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."config_geral" (
    "id" bigint NOT NULL,
    "aviso_pagamento" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "checklist_obrigatorio" boolean DEFAULT true NOT NULL,
    "alerta_estoque_pdv" boolean DEFAULT true NOT NULL,
    "habilitar_emissao_nfe" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."config_geral" OWNER TO "postgres";


ALTER TABLE "public"."config_geral" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."config_geral_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."cores_veiculos" (
    "id" integer NOT NULL,
    "nome" "text" NOT NULL,
    "ativo" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_by" "uuid"
);


ALTER TABLE "public"."cores_veiculos" OWNER TO "postgres";


ALTER TABLE "public"."cores_veiculos" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."cores_veiculos_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."empresa" (
    "id" integer NOT NULL,
    "cnpj" character varying NOT NULL,
    "razaosocial" character varying NOT NULL,
    "nomefantasia" character varying,
    "inscricaoestadual" character varying,
    "inscricaomunicipal" character varying,
    "endereco" character varying NOT NULL,
    "codigomunicipio" character varying NOT NULL,
    "regimetributario" character varying NOT NULL,
    "certificadocaminho" character varying,
    "cschomologacao" character varying,
    "cscproducao" character varying,
    "ambiente" character varying DEFAULT 'HOMOLOGACAO'::character varying,
    "createdat" timestamp without time zone DEFAULT "now"(),
    "updatedat" timestamp without time zone DEFAULT "now"(),
    "bairro" character varying,
    "numero" character varying,
    "complemento" character varying,
    "cep" character varying,
    "uf" character varying(2),
    "codigopais" character varying DEFAULT '1058'::character varying,
    "nomepais" character varying DEFAULT 'BRASIL'::character varying,
    "telefone" character varying,
    "cnae" character varying,
    "inscricaoestadualst" character varying,
    "certificadosenha" character varying,
    CONSTRAINT "empresa_ambiente_check" CHECK ((("ambiente")::"text" = ANY (ARRAY[('HOMOLOGACAO'::character varying)::"text", ('PRODUCAO'::character varying)::"text"]))),
    CONSTRAINT "empresa_regimetributario_check" CHECK ((("regimetributario")::"text" = ANY (ARRAY[('1'::character varying)::"text", ('2'::character varying)::"text", ('3'::character varying)::"text"])))
);


ALTER TABLE "public"."empresa" OWNER TO "postgres";


ALTER TABLE "public"."empresa" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."empresa_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."fornecedor" (
    "id" integer NOT NULL,
    "cpfcnpj" character varying NOT NULL,
    "nomerazaosocial" "text" NOT NULL,
    "nomefantasia" character varying,
    "endereco" character varying,
    "cidade" character varying,
    "estado" character varying,
    "cep" character varying,
    "contato" character varying,
    "createdat" timestamp without time zone DEFAULT "now"(),
    "updatedat" timestamp without time zone DEFAULT "now"(),
    "endereconumero" "text",
    "enderecocomplemento" "text",
    "bairro" "text",
    "ativo" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."fornecedor" OWNER TO "postgres";


ALTER TABLE "public"."fornecedor" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."fornecedor_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."fornecedorprodutos" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "fornecedorid" integer NOT NULL,
    "produtoid" integer NOT NULL,
    "codigofornecedor" "text" NOT NULL,
    "ultimovalordecompra" numeric
);


ALTER TABLE "public"."fornecedorprodutos" OWNER TO "postgres";


ALTER TABLE "public"."fornecedorprodutos" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."fornecedorprodutos_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."imagemvistoria" (
    "id" integer NOT NULL,
    "checklistid" integer NOT NULL,
    "url" character varying NOT NULL,
    "descricao" character varying,
    "createdat" timestamp without time zone DEFAULT "now"()
);


ALTER TABLE "public"."imagemvistoria" OWNER TO "postgres";


ALTER TABLE "public"."imagemvistoria" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."imagemvistoria_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."nfe" (
    "id" bigint NOT NULL,
    "modelo" "public"."enum_modelo_nfe" DEFAULT 'NFE'::"public"."enum_modelo_nfe" NOT NULL,
    "serie" integer NOT NULL,
    "numero" integer NOT NULL,
    "chave_acesso" character(44) NOT NULL,
    "ambiente" "public"."enum_ambiente_nfe" DEFAULT 'HOMOLOGACAO'::"public"."enum_ambiente_nfe" NOT NULL,
    "status" "public"."enum_status_nfe" DEFAULT 'RASCUNHO'::"public"."enum_status_nfe" NOT NULL,
    "ordemservicoid" integer,
    "vendaid" integer,
    "clienteid" integer NOT NULL,
    "dataemissao" timestamp with time zone NOT NULL,
    "dataautorizacao" timestamp with time zone,
    "protocolo" "text",
    "total_produtos" numeric(14,2) DEFAULT 0 NOT NULL,
    "total_servicos" numeric(14,2) DEFAULT 0 NOT NULL,
    "total_nfe" numeric(14,2) DEFAULT 0 NOT NULL,
    "xml_assinado" "text",
    "xml_autorizado" "text",
    "justificativacancelamento" "text",
    "createdat" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updatedat" timestamp with time zone DEFAULT "now"() NOT NULL,
    "empresaid" integer NOT NULL,
    "icms" "text",
    "cfop" "text",
    "created_by" "uuid",
    "updated_by" "uuid",
    "deleted_by" "uuid",
    "is_deleted" boolean DEFAULT false NOT NULL,
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."nfe" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."nfe_config" (
    "id" bigint NOT NULL,
    "empresaid" bigint NOT NULL,
    "modelo" "public"."enum_modelo_nfe" DEFAULT 'NFE'::"public"."enum_modelo_nfe" NOT NULL,
    "serie" integer DEFAULT 1 NOT NULL,
    "ultimo_numero" integer DEFAULT 0 NOT NULL,
    "ambiente" "public"."enum_ambiente_nfe" DEFAULT 'HOMOLOGACAO'::"public"."enum_ambiente_nfe" NOT NULL,
    "tp_emis" smallint DEFAULT 1 NOT NULL,
    "versao_layout" character varying(5) DEFAULT '4.00'::character varying NOT NULL,
    "tipo_impressao_danfe" smallint DEFAULT 1 NOT NULL,
    "permitir_homologacao" boolean DEFAULT true NOT NULL,
    "permitir_producao" boolean DEFAULT true NOT NULL,
    "createdat" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updatedat" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."nfe_config" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."nfe_config_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."nfe_config_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."nfe_config_id_seq" OWNED BY "public"."nfe_config"."id";



CREATE SEQUENCE IF NOT EXISTS "public"."nfe_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."nfe_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."nfe_id_seq" OWNED BY "public"."nfe"."id";



CREATE TABLE IF NOT EXISTS "public"."nfe_item" (
    "id" bigint NOT NULL,
    "nfe_id" bigint NOT NULL,
    "n_item" integer NOT NULL,
    "produtoid" integer,
    "descricao" "text" NOT NULL,
    "ncm" "text",
    "cfop" "text" NOT NULL,
    "csosn" "text",
    "cest" "text",
    "unidade" "public"."unidade_medida" NOT NULL,
    "quantidade" numeric(14,4) NOT NULL,
    "valor_unitario" numeric(14,10) NOT NULL,
    "valor_total" numeric(14,2) NOT NULL,
    "valor_desconto" numeric(14,2),
    "aliquotaicms" numeric(5,2),
    "valor_bc_icms" numeric(14,2),
    "valor_icms" numeric(14,2),
    "cst_pis" "text",
    "aliquota_pis" numeric(5,2),
    "valor_pis" numeric(14,2),
    "cst_cofins" "text",
    "aliquota_cofins" numeric(5,2),
    "valor_cofins" numeric(14,2),
    "createdat" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updatedat" timestamp with time zone DEFAULT "now"() NOT NULL,
    "cst" "text"
);


ALTER TABLE "public"."nfe_item" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."nfe_item_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."nfe_item_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."nfe_item_id_seq" OWNED BY "public"."nfe_item"."id";



CREATE TABLE IF NOT EXISTS "public"."nfse_config" (
    "empresa_id" integer NOT NULL,
    "provedor" "text",
    "inscricao_municipal" "text",
    "serie_rps" "text",
    "usuario" "text",
    "senha" "text",
    "token" "text",
    "certificado_a1_base64" "text",
    "senha_certificado" "text",
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."nfse_config" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notafiscal" (
    "id" integer NOT NULL,
    "ordemservicoid" integer,
    "vendaonlineid" integer,
    "tipo" character varying NOT NULL,
    "numero" character varying NOT NULL,
    "serie" character varying NOT NULL,
    "dataemissao" timestamp without time zone DEFAULT "now"(),
    "xml" character varying,
    "protocolo" character varying,
    "status" character varying NOT NULL,
    "createdat" timestamp without time zone DEFAULT "now"(),
    "updatedat" timestamp without time zone DEFAULT "now"()
);


ALTER TABLE "public"."notafiscal" OWNER TO "postgres";


ALTER TABLE "public"."notafiscal" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."notafiscal_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."ordemservico" (
    "id" integer NOT NULL,
    "clienteid" integer NOT NULL,
    "veiculoid" integer,
    "usuariocriadorid" "uuid" NOT NULL,
    "setorid" integer,
    "status" "public"."enum_status_os" DEFAULT 'AGUARDANDO_CHECKLIST'::"public"."enum_status_os",
    "statusaprovacao" "public"."enum_status_aprovacao" DEFAULT 'PENDENTE'::"public"."enum_status_aprovacao",
    "descricao" character varying,
    "dataentrada" timestamp without time zone DEFAULT "now"(),
    "datasaida" timestamp without time zone,
    "orcamentototal" numeric DEFAULT '0'::numeric NOT NULL,
    "observacoes" character varying,
    "createdat" timestamp without time zone DEFAULT "now"(),
    "updatedat" timestamp without time zone DEFAULT "now"(),
    "checklist_modelo_id" integer,
    "prioridade" "public"."enum_prioridade_os" DEFAULT 'NORMAL'::"public"."enum_prioridade_os" NOT NULL,
    "alvo_tipo" "public"."enum_alvo_reparo" DEFAULT 'VEICULO'::"public"."enum_alvo_reparo" NOT NULL,
    "pecaid" integer,
    "execucao_inicio_em" timestamp with time zone,
    "execucao_fim_em" timestamp with time zone,
    "created_by" "uuid",
    "updated_by" "uuid",
    "deleted_at" timestamp with time zone,
    "deleted_by" "uuid",
    "is_deleted" boolean DEFAULT false NOT NULL,
    CONSTRAINT "ordemservico_alvo_consistente" CHECK (((("alvo_tipo" = 'VEICULO'::"public"."enum_alvo_reparo") AND ("veiculoid" IS NOT NULL) AND ("pecaid" IS NULL)) OR (("alvo_tipo" = 'PECA'::"public"."enum_alvo_reparo") AND ("pecaid" IS NOT NULL) AND ("veiculoid" IS NULL))))
);


ALTER TABLE "public"."ordemservico" OWNER TO "postgres";


ALTER TABLE "public"."ordemservico" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."ordemservico_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."osaprovacao" (
    "id" bigint NOT NULL,
    "ordemservicoid" integer NOT NULL,
    "token" "uuid" NOT NULL,
    "expira_em" timestamp with time zone,
    "usado_em" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "origem" "text",
    "resultado" "text",
    "aprovador_doc" "text",
    "aprovador_usuario_id" "uuid"
);


ALTER TABLE "public"."osaprovacao" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."osaprovacao_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."osaprovacao_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."osaprovacao_id_seq" OWNED BY "public"."osaprovacao"."id";



CREATE TABLE IF NOT EXISTS "public"."osproduto" (
    "ordemservicoid" integer NOT NULL,
    "produtoid" integer NOT NULL,
    "quantidade" integer DEFAULT 1,
    "precounitario" numeric NOT NULL,
    "subtotal" numeric NOT NULL
);


ALTER TABLE "public"."osproduto" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."osproduto_baixa" (
    "ordemservicoid" integer NOT NULL,
    "produtoid" integer NOT NULL,
    "quantidade" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."osproduto_baixa" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."osservico" (
    "ordemservicoid" integer NOT NULL,
    "servicoid" integer NOT NULL,
    "quantidade" integer DEFAULT 1,
    "precounitario" numeric NOT NULL,
    "subtotal" numeric NOT NULL
);


ALTER TABLE "public"."osservico" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."osservico_realizador" (
    "ordemservicoid" integer NOT NULL,
    "servicoid" integer NOT NULL,
    "usuarioid" "uuid" NOT NULL,
    "comissao_percent_aplicada" numeric(5,2),
    "createdat" timestamp with time zone DEFAULT "now"() NOT NULL,
    "valor_base" numeric(12,2),
    "valor_comissao" numeric(12,2),
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."osservico_realizador" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pagamento" (
    "id" bigint NOT NULL,
    "ordemservicoid" integer NOT NULL,
    "metodo" "text" NOT NULL,
    "valor" numeric NOT NULL,
    "status" "text" DEFAULT 'CRIADO'::"text" NOT NULL,
    "provider_tx_id" "text",
    "nsu" "text",
    "autorizacao" "text",
    "bandeira" "text",
    "parcelas" integer DEFAULT 1,
    "comprovante" "text",
    "criado_em" timestamp with time zone DEFAULT "now"(),
    "atualizado_em" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."pagamento" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pagamento_config" (
    "empresa_id" integer NOT NULL,
    "provider_cartao" "text" DEFAULT 'stone'::"text",
    "cartao_merchant_id" "text",
    "cartao_api_key" "text",
    "cartao_webhook_url" "text",
    "cartao_parcelas_max" integer DEFAULT 1,
    "cartao_captura_auto" boolean DEFAULT true,
    "cartao_terminal_ids" "text"[] DEFAULT '{}'::"text"[],
    "pix_provider" "text" DEFAULT 'stone'::"text",
    "pix_chave" "text",
    "pix_client_id" "text",
    "pix_client_secret" "text",
    "pix_webhook_url" "text",
    "pix_expiracao_s" integer DEFAULT 1800,
    "dinheiro_habilitado" boolean DEFAULT true,
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."pagamento_config" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pagamento_evento" (
    "id" bigint NOT NULL,
    "pagamentoid" bigint NOT NULL,
    "tipo" "text" NOT NULL,
    "payload" "jsonb",
    "criado_em" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."pagamento_evento" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."pagamento_evento_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."pagamento_evento_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."pagamento_evento_id_seq" OWNED BY "public"."pagamento_evento"."id";



CREATE SEQUENCE IF NOT EXISTS "public"."pagamento_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."pagamento_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."pagamento_id_seq" OWNED BY "public"."pagamento"."id";



CREATE TABLE IF NOT EXISTS "public"."peca" (
    "id" integer NOT NULL,
    "clienteid" integer NOT NULL,
    "veiculoid" integer,
    "titulo" "text" NOT NULL,
    "descricao" "text",
    "fabricante" "text",
    "modelo" "text",
    "codigo" "text",
    "createdat" timestamp without time zone DEFAULT "now"(),
    "updatedat" timestamp without time zone DEFAULT "now"()
);


ALTER TABLE "public"."peca" OWNER TO "postgres";


ALTER TABLE "public"."peca" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."peca_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."perfil" (
    "id" integer NOT NULL,
    "nome" character varying NOT NULL,
    "descricao" character varying,
    "createdat" timestamp without time zone DEFAULT "now"(),
    "updatedat" timestamp without time zone DEFAULT "now"()
);


ALTER TABLE "public"."perfil" OWNER TO "postgres";


ALTER TABLE "public"."perfil" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."perfil_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."perfilpermissao" (
    "perfilid" integer NOT NULL,
    "permissaoid" integer NOT NULL,
    "createdat" timestamp without time zone DEFAULT "now"()
);


ALTER TABLE "public"."perfilpermissao" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."permissao" (
    "id" integer NOT NULL,
    "nome" character varying NOT NULL,
    "descricao" character varying
);


ALTER TABLE "public"."permissao" OWNER TO "postgres";


ALTER TABLE "public"."permissao" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."permissao_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."produto" (
    "id" integer NOT NULL,
    "descricao" "text",
    "precovenda" numeric NOT NULL,
    "estoque" integer DEFAULT 0 NOT NULL,
    "estoqueminimo" integer DEFAULT 0 NOT NULL,
    "ncm" "text",
    "unidade" "public"."unidade_medida" DEFAULT 'UN'::"public"."unidade_medida" NOT NULL,
    "cest" "text",
    "csosn" "text",
    "codigobarras" "text",
    "createdat" timestamp with time zone DEFAULT "now"(),
    "updatedat" timestamp with time zone DEFAULT "now"(),
    "referencia" "text",
    "titulo" "text" NOT NULL,
    "status_estoque" "public"."estoque_status" DEFAULT 'OK'::"public"."estoque_status" NOT NULL,
    "fabricante" "text",
    "grupo" "public"."grupo_produto" DEFAULT 'OUTROS'::"public"."grupo_produto",
    "exibirPdv" boolean DEFAULT false NOT NULL,
    "tituloMarketplace" "text" DEFAULT ''::"text" NOT NULL,
    "descricaoMarketplace" "text" DEFAULT ''::"text" NOT NULL,
    "cClassTrib" "text",
    "cstIbs" "text",
    "cstCbs" "text",
    "cst" "text",
    "aliquotaicms" numeric,
    "cfop" "text",
    "cst_pis" "text",
    "aliquota_pis" numeric(5,2),
    "cst_cofins" "text",
    "aliquota_cofins" numeric(5,2),
    "imgUrl" "text",
    "updated_by" "uuid",
    "created_by" "uuid",
    "is_deleted" boolean DEFAULT false NOT NULL,
    "deleted_at" timestamp with time zone,
    "deleted_by" "uuid",
    "grupo_produto_id" integer DEFAULT 1 NOT NULL,
    "tipo_unidade_id" integer DEFAULT 1 NOT NULL
);


ALTER TABLE "public"."produto" OWNER TO "postgres";


ALTER TABLE "public"."produto" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."produto_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."produto_imagem" (
    "id" bigint NOT NULL,
    "produto_id" integer NOT NULL,
    "url" "text" NOT NULL,
    "path" "text" NOT NULL,
    "ordem" integer DEFAULT 0 NOT NULL,
    "createdat" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."produto_imagem" OWNER TO "postgres";


ALTER TABLE "public"."produto_imagem" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."produto_imagem_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."produtoentrada" (
    "id" bigint NOT NULL,
    "quantidade" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "produtoid" integer NOT NULL,
    "fornecedorid" integer,
    "fiscal" boolean DEFAULT false NOT NULL,
    "notachave" "text"
);


ALTER TABLE "public"."produtoentrada" OWNER TO "postgres";


ALTER TABLE "public"."produtoentrada" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."produtoentrada_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."produtogrupo" (
    "id" integer NOT NULL,
    "nome" "text" NOT NULL,
    "descricao" "text",
    "ativo" boolean DEFAULT true NOT NULL,
    "createdat" timestamp without time zone DEFAULT "now"() NOT NULL,
    "updatedat" timestamp without time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."produtogrupo" OWNER TO "postgres";


ALTER TABLE "public"."produtogrupo" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."produtogrupo_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."servico" (
    "id" integer NOT NULL,
    "codigo" character varying NOT NULL,
    "descricao" character varying NOT NULL,
    "precohora" numeric NOT NULL,
    "codigoservicomunicipal" character varying,
    "aliquotaiss" numeric,
    "cnae" character varying,
    "itemlistaservico" character varying,
    "tiposervicoid" integer,
    "createdat" timestamp without time zone DEFAULT "now"(),
    "updatedat" timestamp without time zone DEFAULT "now"(),
    "ativo" boolean DEFAULT true
);


ALTER TABLE "public"."servico" OWNER TO "postgres";


ALTER TABLE "public"."servico" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."servico_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."setor" (
    "id" integer NOT NULL,
    "nome" character varying NOT NULL,
    "descricao" character varying,
    "responsavel" "text",
    "ativo" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."setor" OWNER TO "postgres";


ALTER TABLE "public"."setor" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."setor_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."tiposervico" (
    "id" integer NOT NULL,
    "nome" character varying NOT NULL,
    "descricao" character varying,
    "categoriaid" integer NOT NULL
);


ALTER TABLE "public"."tiposervico" OWNER TO "postgres";


ALTER TABLE "public"."tiposervico" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."tiposervico_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."transacao" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "descricao" "text" NOT NULL,
    "valor" numeric(14,2) NOT NULL,
    "data" timestamp with time zone NOT NULL,
    "metodopagamento" "public"."metodo_pagamento" NOT NULL,
    "categoria" "text" DEFAULT 'NÃO RELACIONADO'::"text" NOT NULL,
    "tipo" "public"."tipos_transacao" NOT NULL,
    "cliente_id" integer,
    "banco_id" bigint NOT NULL,
    "nomepagador" "text" NOT NULL,
    "cpfcnpjpagador" "text" NOT NULL,
    "ordemservicoid" integer,
    "valorLiquido" numeric,
    "vendaid" integer,
    "pendente" boolean DEFAULT false NOT NULL,
    "created_by" "uuid",
    "updated_by" "uuid",
    "is_deleted" boolean DEFAULT false NOT NULL,
    "deleted_at" timestamp with time zone,
    "deleted_by" "uuid"
);


ALTER TABLE "public"."transacao" OWNER TO "postgres";


ALTER TABLE "public"."transacao" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."transacao_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."transferencias_veiculos" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "veiculo_id" integer,
    "dono_anteior" integer,
    "novo_dono" integer,
    "created_by" "uuid"
);


ALTER TABLE "public"."transferencias_veiculos" OWNER TO "postgres";


ALTER TABLE "public"."transferencias_veiculos" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."transferencias_veiculos_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."unidademedida" (
    "id" integer NOT NULL,
    "sigla" character varying NOT NULL,
    "descricao" "text",
    "ativo" boolean DEFAULT true NOT NULL,
    "createdat" timestamp without time zone DEFAULT "now"() NOT NULL,
    "updatedat" timestamp without time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."unidademedida" OWNER TO "postgres";


ALTER TABLE "public"."unidademedida" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."unidademedida_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."usuario" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email" character varying NOT NULL,
    "nome" character varying NOT NULL,
    "setorid" integer,
    "perfilid" integer,
    "createdat" timestamp without time zone DEFAULT "now"(),
    "updatedat" timestamp without time zone DEFAULT "now"(),
    "ativo" boolean DEFAULT true NOT NULL,
    "salario" numeric(12,2),
    "comissao_percent" numeric(5,2),
    "data_admissao" "date",
    "data_demissao" "date"
);


ALTER TABLE "public"."usuario" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."veiculo" (
    "id" integer NOT NULL,
    "clienteid" integer NOT NULL,
    "placa" character varying NOT NULL,
    "modelo" "text" NOT NULL,
    "marca" "text" NOT NULL,
    "ano" integer,
    "cor" character varying,
    "kmatual" integer,
    "createdat" timestamp without time zone DEFAULT "now"(),
    "updatedat" timestamp without time zone DEFAULT "now"(),
    "placa_formatada" "text" GENERATED ALWAYS AS ("public"."to_mercosul_equivalente"(("placa")::"text")) STORED NOT NULL,
    "tipo" "public"."tipo_veiculo" DEFAULT 'CARROS'::"public"."tipo_veiculo" NOT NULL,
    CONSTRAINT "veiculo_placa_formato_chk" CHECK (((("placa")::"text" ~ '^[A-Z]{3}[0-9]{4}$'::"text") OR (("placa")::"text" ~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$'::"text")))
);


ALTER TABLE "public"."veiculo" OWNER TO "postgres";


ALTER TABLE "public"."veiculo" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."veiculo_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."venda" (
    "id" integer NOT NULL,
    "clienteid" integer NOT NULL,
    "status" "public"."enum_status_venda" NOT NULL,
    "valortotal" numeric NOT NULL,
    "datavenda" timestamp with time zone,
    "createdat" timestamp with time zone,
    "updatedat" timestamp with time zone,
    "created_by" "uuid",
    "desconto_tipo" "public"."enum_tipo_desconto_venda",
    "desconto_valor" numeric,
    "sub_total" numeric NOT NULL
);


ALTER TABLE "public"."venda" OWNER TO "postgres";


ALTER TABLE "public"."venda" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."venda_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."vendaproduto" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "venda_id" integer NOT NULL,
    "produtoid" integer NOT NULL,
    "sub_total" numeric NOT NULL,
    "valor_total" numeric NOT NULL,
    "valor_desconto" numeric,
    "tipo_desconto" "public"."enum_tipo_desconto_venda",
    "quantidade" integer NOT NULL
);


ALTER TABLE "public"."vendaproduto" OWNER TO "postgres";


ALTER TABLE "public"."vendaproduto" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."vendaproduto_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



ALTER TABLE ONLY "public"."nfe" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."nfe_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."nfe_config" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."nfe_config_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."nfe_item" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."nfe_item_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."osaprovacao" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."osaprovacao_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."pagamento" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."pagamento_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."pagamento_evento" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."pagamento_evento_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."bancoconta"
    ADD CONSTRAINT "banco_conta_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."categoriatransacao"
    ADD CONSTRAINT "categoria_transacao_nome_key" UNIQUE ("nome");



ALTER TABLE ONLY "public"."categoriaservico"
    ADD CONSTRAINT "categoriaservico_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."categoriatransacao"
    ADD CONSTRAINT "categoriatransacao_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."checklist_modelo_item"
    ADD CONSTRAINT "checklist_modelo_item_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."checklist_modelo"
    ADD CONSTRAINT "checklist_modelo_nome_key" UNIQUE ("nome");



ALTER TABLE ONLY "public"."checklist_modelo"
    ADD CONSTRAINT "checklist_modelo_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."checklist"
    ADD CONSTRAINT "checklist_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cliente"
    ADD CONSTRAINT "cliente_cpfcnpj_key" UNIQUE ("cpfcnpj");



ALTER TABLE ONLY "public"."cliente"
    ADD CONSTRAINT "cliente_nomerazaosocial_key" UNIQUE ("nomerazaosocial");



ALTER TABLE ONLY "public"."cliente"
    ADD CONSTRAINT "cliente_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cliente"
    ADD CONSTRAINT "cliente_telefone_key" UNIQUE ("telefone");



ALTER TABLE ONLY "public"."config_geral"
    ADD CONSTRAINT "config_geral_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cores_veiculos"
    ADD CONSTRAINT "cores_veiculos_nome_key" UNIQUE ("nome");



ALTER TABLE ONLY "public"."cores_veiculos"
    ADD CONSTRAINT "cores_veiculos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."empresa"
    ADD CONSTRAINT "empresa_cnpj_key" UNIQUE ("cnpj");



ALTER TABLE ONLY "public"."empresa"
    ADD CONSTRAINT "empresa_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fornecedor"
    ADD CONSTRAINT "fornecedor_cnpj_key" UNIQUE ("cpfcnpj");



ALTER TABLE ONLY "public"."fornecedor"
    ADD CONSTRAINT "fornecedor_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fornecedorprodutos"
    ADD CONSTRAINT "fornecedorprodutos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."imagemvistoria"
    ADD CONSTRAINT "imagemvistoria_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."nfe"
    ADD CONSTRAINT "nfe_chave_acesso_key" UNIQUE ("chave_acesso");



ALTER TABLE ONLY "public"."nfe_config"
    ADD CONSTRAINT "nfe_config_empresaid_key" UNIQUE ("empresaid");



ALTER TABLE ONLY "public"."nfe_config"
    ADD CONSTRAINT "nfe_config_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."nfe_item"
    ADD CONSTRAINT "nfe_item_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."nfe"
    ADD CONSTRAINT "nfe_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."nfse_config"
    ADD CONSTRAINT "nfse_config_pkey" PRIMARY KEY ("empresa_id");



ALTER TABLE ONLY "public"."notafiscal"
    ADD CONSTRAINT "notafiscal_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ordemservico"
    ADD CONSTRAINT "ordemservico_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."osaprovacao"
    ADD CONSTRAINT "osaprovacao_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."osaprovacao"
    ADD CONSTRAINT "osaprovacao_token_key" UNIQUE ("token");



ALTER TABLE ONLY "public"."osproduto_baixa"
    ADD CONSTRAINT "osproduto_baixa_pkey" PRIMARY KEY ("ordemservicoid", "produtoid");



ALTER TABLE ONLY "public"."osproduto"
    ADD CONSTRAINT "osproduto_pkey" PRIMARY KEY ("ordemservicoid", "produtoid");



ALTER TABLE ONLY "public"."osservico"
    ADD CONSTRAINT "osservico_pkey" PRIMARY KEY ("ordemservicoid", "servicoid");



ALTER TABLE ONLY "public"."osservico_realizador"
    ADD CONSTRAINT "osservico_realizador_pkey" PRIMARY KEY ("ordemservicoid", "servicoid", "usuarioid");



ALTER TABLE ONLY "public"."pagamento_config"
    ADD CONSTRAINT "pagamento_config_pkey" PRIMARY KEY ("empresa_id");



ALTER TABLE ONLY "public"."pagamento_evento"
    ADD CONSTRAINT "pagamento_evento_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pagamento"
    ADD CONSTRAINT "pagamento_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."peca"
    ADD CONSTRAINT "peca_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."perfil"
    ADD CONSTRAINT "perfil_nome_key" UNIQUE ("nome");



ALTER TABLE ONLY "public"."perfil"
    ADD CONSTRAINT "perfil_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."perfilpermissao"
    ADD CONSTRAINT "perfilpermissao_pkey" PRIMARY KEY ("perfilid", "permissaoid");



ALTER TABLE ONLY "public"."permissao"
    ADD CONSTRAINT "permissao_nome_key" UNIQUE ("nome");



ALTER TABLE ONLY "public"."permissao"
    ADD CONSTRAINT "permissao_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."produto_imagem"
    ADD CONSTRAINT "produto_imagem_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."produto"
    ADD CONSTRAINT "produto_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."produtoentrada"
    ADD CONSTRAINT "produtoentrada_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."produtogrupo"
    ADD CONSTRAINT "produtogrupo_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."servico"
    ADD CONSTRAINT "servico_codigo_key" UNIQUE ("codigo");



ALTER TABLE ONLY "public"."servico"
    ADD CONSTRAINT "servico_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."setor"
    ADD CONSTRAINT "setor_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tiposervico"
    ADD CONSTRAINT "tiposervico_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."transacao"
    ADD CONSTRAINT "transacao_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."transferencias_veiculos"
    ADD CONSTRAINT "transferencias_veiculos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."unidademedida"
    ADD CONSTRAINT "unidademedida_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."unidademedida"
    ADD CONSTRAINT "unidademedida_sigla_key" UNIQUE ("sigla");



ALTER TABLE ONLY "public"."usuario"
    ADD CONSTRAINT "usuario_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."usuario"
    ADD CONSTRAINT "usuario_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."veiculo"
    ADD CONSTRAINT "veiculo_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."veiculo"
    ADD CONSTRAINT "veiculo_placa_formatada_key" UNIQUE ("placa_formatada");



ALTER TABLE ONLY "public"."veiculo"
    ADD CONSTRAINT "veiculo_placa_key" UNIQUE ("placa");



ALTER TABLE ONLY "public"."venda"
    ADD CONSTRAINT "vendaonline_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vendaproduto"
    ADD CONSTRAINT "vendaproduto_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_checklist_modelo_item_modelo" ON "public"."checklist_modelo_item" USING "btree" ("modelo_id");



CREATE INDEX "idx_cliente_cpfcnpj" ON "public"."cliente" USING "btree" ("cpfcnpj");



CREATE INDEX "idx_nfe_cliente" ON "public"."nfe" USING "btree" ("clienteid");



CREATE INDEX "idx_nfe_item_nfe" ON "public"."nfe_item" USING "btree" ("nfe_id");



CREATE INDEX "idx_nfe_item_produto" ON "public"."nfe_item" USING "btree" ("produtoid");



CREATE INDEX "idx_nfe_ordemservico" ON "public"."nfe" USING "btree" ("ordemservicoid");



CREATE INDEX "idx_nfe_status" ON "public"."nfe" USING "btree" ("status");



CREATE INDEX "idx_nfe_venda" ON "public"."nfe" USING "btree" ("vendaid");



CREATE INDEX "idx_ordemservico_clienteid" ON "public"."ordemservico" USING "btree" ("clienteid");



CREATE INDEX "idx_ordemservico_setorid" ON "public"."ordemservico" USING "btree" ("setorid");



CREATE INDEX "idx_os_cliente" ON "public"."ordemservico" USING "btree" ("clienteid");



CREATE INDEX "idx_os_status" ON "public"."ordemservico" USING "btree" ("status");



CREATE INDEX "idx_transacao_ordemservicoid" ON "public"."transacao" USING "btree" ("ordemservicoid");



CREATE INDEX "idx_usuario_email" ON "public"."usuario" USING "btree" ("email");



CREATE INDEX "osaprovacao_ordem_idx" ON "public"."osaprovacao" USING "btree" ("ordemservicoid");



CREATE INDEX "produto_imagem_produto_id_idx" ON "public"."produto_imagem" USING "btree" ("produto_id");



CREATE UNIQUE INDEX "produto_imagem_produto_path_uq" ON "public"."produto_imagem" USING "btree" ("path");



CREATE OR REPLACE TRIGGER "ordemservico_status_estorno" AFTER UPDATE OF "status" ON "public"."ordemservico" FOR EACH ROW EXECUTE FUNCTION "public"."trg_os_status_estornar"();



CREATE OR REPLACE TRIGGER "trg_checklist_modelo_updated" BEFORE UPDATE ON "public"."checklist_modelo" FOR EACH ROW EXECUTE FUNCTION "public"."set_checklist_modelo_updated_at"();



CREATE OR REPLACE TRIGGER "trg_fill_titulo_marketplace" BEFORE INSERT OR UPDATE OF "tituloMarketplace", "titulo" ON "public"."produto" FOR EACH ROW EXECUTE FUNCTION "public"."fn_fill_titulo_marketplace"();



CREATE OR REPLACE TRIGGER "trg_normalize_placa_veiculo" BEFORE INSERT OR UPDATE OF "placa" ON "public"."veiculo" FOR EACH ROW EXECUTE FUNCTION "public"."normalize_placa"();



CREATE OR REPLACE TRIGGER "trg_os_execucao_set_times" BEFORE UPDATE OF "status" ON "public"."ordemservico" FOR EACH ROW EXECUTE FUNCTION "public"."fn_os_execucao_set_times"();



CREATE OR REPLACE TRIGGER "trg_recalc_or_del" AFTER DELETE ON "public"."osservico_realizador" FOR EACH ROW EXECUTE FUNCTION "public"."tg_recalc_comissao_osservico_realizador"();



CREATE OR REPLACE TRIGGER "trg_recalc_or_ins" AFTER INSERT ON "public"."osservico_realizador" FOR EACH ROW EXECUTE FUNCTION "public"."tg_recalc_comissao_osservico_realizador"();



CREATE OR REPLACE TRIGGER "trg_recalc_osservico_subtotal" AFTER UPDATE OF "subtotal" ON "public"."osservico" FOR EACH ROW EXECUTE FUNCTION "public"."tg_recalc_comissao_osservico_on_subtotal"();



CREATE OR REPLACE TRIGGER "trg_set_or_percent_before_ins" BEFORE INSERT ON "public"."osservico_realizador" FOR EACH ROW EXECUTE FUNCTION "public"."tg_set_comissao_percent_aplicada"();



CREATE OR REPLACE TRIGGER "trg_set_status_estoque" BEFORE INSERT OR UPDATE OF "estoque", "estoqueminimo" ON "public"."produto" FOR EACH ROW EXECUTE FUNCTION "public"."fn_set_status_estoque"();



ALTER TABLE ONLY "public"."bancoconta"
    ADD CONSTRAINT "bancoconta_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresa"("id");



ALTER TABLE ONLY "public"."checklist_modelo_item"
    ADD CONSTRAINT "checklist_modelo_item_modelo_id_fkey" FOREIGN KEY ("modelo_id") REFERENCES "public"."checklist_modelo"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cliente"
    ADD CONSTRAINT "cliente_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."usuario"("id");



ALTER TABLE ONLY "public"."cliente"
    ADD CONSTRAINT "cliente_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "public"."usuario"("id");



ALTER TABLE ONLY "public"."cliente"
    ADD CONSTRAINT "cliente_ranked_by_fkey" FOREIGN KEY ("ranked_by") REFERENCES "public"."usuario"("id");



ALTER TABLE ONLY "public"."cliente"
    ADD CONSTRAINT "cliente_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."usuario"("id");



ALTER TABLE ONLY "public"."cores_veiculos"
    ADD CONSTRAINT "cores_veiculos_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."cores_veiculos"
    ADD CONSTRAINT "cores_veiculos_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."checklist"
    ADD CONSTRAINT "fk_checklist_ordem_servico" FOREIGN KEY ("ordemservicoid") REFERENCES "public"."ordemservico"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."imagemvistoria"
    ADD CONSTRAINT "fk_imagem_vistoria_checklist" FOREIGN KEY ("checklistid") REFERENCES "public"."checklist"("id");



ALTER TABLE ONLY "public"."notafiscal"
    ADD CONSTRAINT "fk_nota_fiscal_ordem_servico" FOREIGN KEY ("ordemservicoid") REFERENCES "public"."ordemservico"("id");



ALTER TABLE ONLY "public"."notafiscal"
    ADD CONSTRAINT "fk_nota_fiscal_venda_online" FOREIGN KEY ("vendaonlineid") REFERENCES "public"."venda"("id");



ALTER TABLE ONLY "public"."osservico_realizador"
    ADD CONSTRAINT "fk_or_osservico" FOREIGN KEY ("ordemservicoid", "servicoid") REFERENCES "public"."osservico"("ordemservicoid", "servicoid") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."osservico_realizador"
    ADD CONSTRAINT "fk_or_usuario" FOREIGN KEY ("usuarioid") REFERENCES "public"."usuario"("id") ON UPDATE CASCADE;



ALTER TABLE ONLY "public"."ordemservico"
    ADD CONSTRAINT "fk_ordem_servico_cliente" FOREIGN KEY ("clienteid") REFERENCES "public"."cliente"("id");



ALTER TABLE ONLY "public"."ordemservico"
    ADD CONSTRAINT "fk_ordem_servico_setor" FOREIGN KEY ("setorid") REFERENCES "public"."setor"("id");



ALTER TABLE ONLY "public"."ordemservico"
    ADD CONSTRAINT "fk_ordem_servico_usuario" FOREIGN KEY ("usuariocriadorid") REFERENCES "public"."usuario"("id");



ALTER TABLE ONLY "public"."ordemservico"
    ADD CONSTRAINT "fk_ordem_servico_veiculo" FOREIGN KEY ("veiculoid") REFERENCES "public"."veiculo"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."osproduto"
    ADD CONSTRAINT "fk_os_produto_produto" FOREIGN KEY ("produtoid") REFERENCES "public"."produto"("id");



ALTER TABLE ONLY "public"."osservico"
    ADD CONSTRAINT "fk_os_servico_servico" FOREIGN KEY ("servicoid") REFERENCES "public"."servico"("id");



ALTER TABLE ONLY "public"."servico"
    ADD CONSTRAINT "fk_servico_tipo_servico" FOREIGN KEY ("tiposervicoid") REFERENCES "public"."tiposervico"("id");



ALTER TABLE ONLY "public"."tiposervico"
    ADD CONSTRAINT "fk_tipo_servico_categoria" FOREIGN KEY ("categoriaid") REFERENCES "public"."categoriaservico"("id");



ALTER TABLE ONLY "public"."veiculo"
    ADD CONSTRAINT "fk_veiculo_cliente" FOREIGN KEY ("clienteid") REFERENCES "public"."cliente"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."venda"
    ADD CONSTRAINT "fk_venda_online_cliente" FOREIGN KEY ("clienteid") REFERENCES "public"."cliente"("id");



ALTER TABLE ONLY "public"."fornecedorprodutos"
    ADD CONSTRAINT "fornecedorprodutos_fornecedorid_fkey" FOREIGN KEY ("fornecedorid") REFERENCES "public"."fornecedor"("id");



ALTER TABLE ONLY "public"."fornecedorprodutos"
    ADD CONSTRAINT "fornecedorprodutos_produtoid_fkey" FOREIGN KEY ("produtoid") REFERENCES "public"."produto"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."nfe"
    ADD CONSTRAINT "nfe_clienteid_fkey" FOREIGN KEY ("clienteid") REFERENCES "public"."cliente"("id");



ALTER TABLE ONLY "public"."nfe_config"
    ADD CONSTRAINT "nfe_config_empresaid_fkey" FOREIGN KEY ("empresaid") REFERENCES "public"."empresa"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."nfe"
    ADD CONSTRAINT "nfe_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."usuario"("id");



ALTER TABLE ONLY "public"."nfe"
    ADD CONSTRAINT "nfe_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "public"."usuario"("id");



ALTER TABLE ONLY "public"."nfe"
    ADD CONSTRAINT "nfe_empresaid_fkey" FOREIGN KEY ("empresaid") REFERENCES "public"."empresa"("id");



ALTER TABLE ONLY "public"."nfe_item"
    ADD CONSTRAINT "nfe_item_nfe_id_fkey" FOREIGN KEY ("nfe_id") REFERENCES "public"."nfe"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."nfe_item"
    ADD CONSTRAINT "nfe_item_produtoid_fkey" FOREIGN KEY ("produtoid") REFERENCES "public"."produto"("id");



ALTER TABLE ONLY "public"."nfe"
    ADD CONSTRAINT "nfe_ordemservicoid_fkey" FOREIGN KEY ("ordemservicoid") REFERENCES "public"."ordemservico"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."nfe"
    ADD CONSTRAINT "nfe_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."usuario"("id");



ALTER TABLE ONLY "public"."nfe"
    ADD CONSTRAINT "nfe_vendaid_fkey" FOREIGN KEY ("vendaid") REFERENCES "public"."venda"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."nfse_config"
    ADD CONSTRAINT "nfse_config_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresa"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ordemservico"
    ADD CONSTRAINT "ordemservico_checklist_modelo_id_fkey" FOREIGN KEY ("checklist_modelo_id") REFERENCES "public"."checklist_modelo"("id");



ALTER TABLE ONLY "public"."ordemservico"
    ADD CONSTRAINT "ordemservico_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."usuario"("id");



ALTER TABLE ONLY "public"."ordemservico"
    ADD CONSTRAINT "ordemservico_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "public"."usuario"("id");



ALTER TABLE ONLY "public"."ordemservico"
    ADD CONSTRAINT "ordemservico_pecaid_fkey" FOREIGN KEY ("pecaid") REFERENCES "public"."peca"("id");



ALTER TABLE ONLY "public"."ordemservico"
    ADD CONSTRAINT "ordemservico_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."usuario"("id");



ALTER TABLE ONLY "public"."osaprovacao"
    ADD CONSTRAINT "osaprovacao_aprovador_usuario_id_fkey" FOREIGN KEY ("aprovador_usuario_id") REFERENCES "public"."usuario"("id");



ALTER TABLE ONLY "public"."osaprovacao"
    ADD CONSTRAINT "osaprovacao_ordemservicoid_fkey" FOREIGN KEY ("ordemservicoid") REFERENCES "public"."ordemservico"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."osproduto_baixa"
    ADD CONSTRAINT "osproduto_baixa_ordemservicoid_fkey" FOREIGN KEY ("ordemservicoid") REFERENCES "public"."ordemservico"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."osproduto_baixa"
    ADD CONSTRAINT "osproduto_baixa_produtoid_fkey" FOREIGN KEY ("produtoid") REFERENCES "public"."produto"("id");



ALTER TABLE ONLY "public"."osproduto"
    ADD CONSTRAINT "osproduto_ordemservicoid_fkey" FOREIGN KEY ("ordemservicoid") REFERENCES "public"."ordemservico"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."osservico"
    ADD CONSTRAINT "osservico_ordemservicoid_fkey" FOREIGN KEY ("ordemservicoid") REFERENCES "public"."ordemservico"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pagamento_config"
    ADD CONSTRAINT "pagamento_config_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresa"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pagamento_evento"
    ADD CONSTRAINT "pagamento_evento_pagamentoid_fkey" FOREIGN KEY ("pagamentoid") REFERENCES "public"."pagamento"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pagamento"
    ADD CONSTRAINT "pagamento_ordemservicoid_fkey" FOREIGN KEY ("ordemservicoid") REFERENCES "public"."ordemservico"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."peca"
    ADD CONSTRAINT "peca_clienteid_fkey" FOREIGN KEY ("clienteid") REFERENCES "public"."cliente"("id");



ALTER TABLE ONLY "public"."peca"
    ADD CONSTRAINT "peca_veiculoid_fkey" FOREIGN KEY ("veiculoid") REFERENCES "public"."veiculo"("id");



ALTER TABLE ONLY "public"."perfilpermissao"
    ADD CONSTRAINT "perfilpermissao_perfil_fkey" FOREIGN KEY ("perfilid") REFERENCES "public"."perfil"("id");



ALTER TABLE ONLY "public"."perfilpermissao"
    ADD CONSTRAINT "perfilpermissao_permissao_fkey" FOREIGN KEY ("permissaoid") REFERENCES "public"."permissao"("id");



ALTER TABLE ONLY "public"."produto"
    ADD CONSTRAINT "produto_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."usuario"("id");



ALTER TABLE ONLY "public"."produto"
    ADD CONSTRAINT "produto_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "public"."usuario"("id");



ALTER TABLE ONLY "public"."produto"
    ADD CONSTRAINT "produto_grupo_produto_id_fkey" FOREIGN KEY ("grupo_produto_id") REFERENCES "public"."produtogrupo"("id") ON UPDATE CASCADE;



ALTER TABLE ONLY "public"."produto_imagem"
    ADD CONSTRAINT "produto_imagem_produto_id_fkey" FOREIGN KEY ("produto_id") REFERENCES "public"."produto"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."produto"
    ADD CONSTRAINT "produto_tipo_unidade_id_fkey" FOREIGN KEY ("tipo_unidade_id") REFERENCES "public"."unidademedida"("id") ON UPDATE CASCADE;



ALTER TABLE ONLY "public"."produto"
    ADD CONSTRAINT "produto_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."usuario"("id");



ALTER TABLE ONLY "public"."produtoentrada"
    ADD CONSTRAINT "produtoentrada_fornecedorid_fkey" FOREIGN KEY ("fornecedorid") REFERENCES "public"."fornecedor"("id");



ALTER TABLE ONLY "public"."produtoentrada"
    ADD CONSTRAINT "produtoentrada_produtoid_fkey" FOREIGN KEY ("produtoid") REFERENCES "public"."produto"("id");



ALTER TABLE ONLY "public"."transacao"
    ADD CONSTRAINT "transacao_banco_id_fkey" FOREIGN KEY ("banco_id") REFERENCES "public"."bancoconta"("id") ON UPDATE RESTRICT;



ALTER TABLE ONLY "public"."transacao"
    ADD CONSTRAINT "transacao_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "public"."cliente"("id") ON UPDATE CASCADE;



ALTER TABLE ONLY "public"."transacao"
    ADD CONSTRAINT "transacao_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."usuario"("id");



ALTER TABLE ONLY "public"."transacao"
    ADD CONSTRAINT "transacao_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "public"."usuario"("id");



ALTER TABLE ONLY "public"."transacao"
    ADD CONSTRAINT "transacao_ordemservicoid_fkey" FOREIGN KEY ("ordemservicoid") REFERENCES "public"."ordemservico"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transacao"
    ADD CONSTRAINT "transacao_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."usuario"("id");



ALTER TABLE ONLY "public"."transacao"
    ADD CONSTRAINT "transacao_vendaid_fkey" FOREIGN KEY ("vendaid") REFERENCES "public"."venda"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transferencias_veiculos"
    ADD CONSTRAINT "transferencias_veiculos_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."usuario"("id");



ALTER TABLE ONLY "public"."transferencias_veiculos"
    ADD CONSTRAINT "transferencias_veiculos_dono_anteior_fkey" FOREIGN KEY ("dono_anteior") REFERENCES "public"."cliente"("id");



ALTER TABLE ONLY "public"."transferencias_veiculos"
    ADD CONSTRAINT "transferencias_veiculos_novo_dono_fkey" FOREIGN KEY ("novo_dono") REFERENCES "public"."cliente"("id");



ALTER TABLE ONLY "public"."transferencias_veiculos"
    ADD CONSTRAINT "transferencias_veiculos_veiculo_id_fkey" FOREIGN KEY ("veiculo_id") REFERENCES "public"."veiculo"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."usuario"
    ADD CONSTRAINT "usuario_auth_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."usuario"
    ADD CONSTRAINT "usuario_perfilid_fkey" FOREIGN KEY ("perfilid") REFERENCES "public"."perfil"("id");



ALTER TABLE ONLY "public"."usuario"
    ADD CONSTRAINT "usuario_setorid_fkey" FOREIGN KEY ("setorid") REFERENCES "public"."setor"("id");



ALTER TABLE ONLY "public"."venda"
    ADD CONSTRAINT "venda_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."usuario"("id");



ALTER TABLE ONLY "public"."vendaproduto"
    ADD CONSTRAINT "vendaproduto_produtoid_fkey" FOREIGN KEY ("produtoid") REFERENCES "public"."produto"("id");



ALTER TABLE ONLY "public"."vendaproduto"
    ADD CONSTRAINT "vendaproduto_venda_id_fkey" FOREIGN KEY ("venda_id") REFERENCES "public"."venda"("id") ON DELETE CASCADE;



ALTER TABLE "public"."config_geral" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fornecedorprodutos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."transferencias_veiculos" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."ordemservico";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."produto";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";

























































































































































GRANT ALL ON FUNCTION "public"."atualizar_totais_nfe"("p_nfe_id" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."atualizar_totais_nfe"("p_nfe_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."atualizar_totais_nfe"("p_nfe_id" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."criar_nfe_de_os"("p_ordemservicoid" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."criar_nfe_de_os"("p_ordemservicoid" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."criar_nfe_de_os"("p_ordemservicoid" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."criar_nfe_de_venda"("p_vendaid" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."criar_nfe_de_venda"("p_vendaid" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."criar_nfe_de_venda"("p_vendaid" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."estornar_baixa_estoque_os"("p_os_id" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."estornar_baixa_estoque_os"("p_os_id" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."estornar_baixa_estoque_os"("p_os_id" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_baixa_estoque_produto"("p_produto_id" integer, "p_quantidade" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."fn_baixa_estoque_produto"("p_produto_id" integer, "p_quantidade" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_baixa_estoque_produto"("p_produto_id" integer, "p_quantidade" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_criar_venda_com_itens"("p_venda" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."fn_criar_venda_com_itens"("p_venda" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_criar_venda_com_itens"("p_venda" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_fill_titulo_marketplace"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_fill_titulo_marketplace"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_fill_titulo_marketplace"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_os_execucao_set_times"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_os_execucao_set_times"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_os_execucao_set_times"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_set_status_estoque"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_set_status_estoque"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_set_status_estoque"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_set_titulo_marketplace_product"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_set_titulo_marketplace_product"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_set_titulo_marketplace_product"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_auth_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_auth_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_auth_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_update_auth_user_email"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_update_auth_user_email"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_update_auth_user_email"() TO "service_role";



GRANT ALL ON FUNCTION "public"."normalize_placa"() TO "anon";
GRANT ALL ON FUNCTION "public"."normalize_placa"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."normalize_placa"() TO "service_role";



GRANT ALL ON FUNCTION "public"."preencher_itens_nfe_de_os"("p_nfe_id" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."preencher_itens_nfe_de_os"("p_nfe_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."preencher_itens_nfe_de_os"("p_nfe_id" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."preencher_itens_nfe_de_venda"("p_nfe_id" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."preencher_itens_nfe_de_venda"("p_nfe_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."preencher_itens_nfe_de_venda"("p_nfe_id" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."reaplicar_baixa_estoque_os"("p_os_id" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."reaplicar_baixa_estoque_os"("p_os_id" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."reaplicar_baixa_estoque_os"("p_os_id" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."recalcular_comissao_osservico"("p_ordemservicoid" integer, "p_servicoid" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."recalcular_comissao_osservico"("p_ordemservicoid" integer, "p_servicoid" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."recalcular_comissao_osservico"("p_ordemservicoid" integer, "p_servicoid" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."set_checklist_modelo_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_checklist_modelo_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_checklist_modelo_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."tg_recalc_comissao_osservico_on_subtotal"() TO "anon";
GRANT ALL ON FUNCTION "public"."tg_recalc_comissao_osservico_on_subtotal"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."tg_recalc_comissao_osservico_on_subtotal"() TO "service_role";



GRANT ALL ON FUNCTION "public"."tg_recalc_comissao_osservico_realizador"() TO "anon";
GRANT ALL ON FUNCTION "public"."tg_recalc_comissao_osservico_realizador"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."tg_recalc_comissao_osservico_realizador"() TO "service_role";



GRANT ALL ON FUNCTION "public"."tg_set_comissao_percent_aplicada"() TO "anon";
GRANT ALL ON FUNCTION "public"."tg_set_comissao_percent_aplicada"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."tg_set_comissao_percent_aplicada"() TO "service_role";



GRANT ALL ON FUNCTION "public"."to_mercosul_equivalente"("p" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."to_mercosul_equivalente"("p" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."to_mercosul_equivalente"("p" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_os_status_estornar"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_os_status_estornar"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_os_status_estornar"() TO "service_role";


















GRANT ALL ON TABLE "public"."bancoconta" TO "anon";
GRANT ALL ON TABLE "public"."bancoconta" TO "authenticated";
GRANT ALL ON TABLE "public"."bancoconta" TO "service_role";



GRANT ALL ON SEQUENCE "public"."bancoconta_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."bancoconta_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."bancoconta_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."categoriaservico" TO "anon";
GRANT ALL ON TABLE "public"."categoriaservico" TO "authenticated";
GRANT ALL ON TABLE "public"."categoriaservico" TO "service_role";



GRANT ALL ON SEQUENCE "public"."categoriaservico_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."categoriaservico_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."categoriaservico_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."categoriatransacao" TO "anon";
GRANT ALL ON TABLE "public"."categoriatransacao" TO "authenticated";
GRANT ALL ON TABLE "public"."categoriatransacao" TO "service_role";



GRANT ALL ON SEQUENCE "public"."categoriatransacao_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."categoriatransacao_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."categoriatransacao_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."checklist" TO "anon";
GRANT ALL ON TABLE "public"."checklist" TO "authenticated";
GRANT ALL ON TABLE "public"."checklist" TO "service_role";



GRANT ALL ON SEQUENCE "public"."checklist_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."checklist_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."checklist_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."checklist_modelo" TO "anon";
GRANT ALL ON TABLE "public"."checklist_modelo" TO "authenticated";
GRANT ALL ON TABLE "public"."checklist_modelo" TO "service_role";



GRANT ALL ON SEQUENCE "public"."checklist_modelo_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."checklist_modelo_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."checklist_modelo_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."checklist_modelo_item" TO "anon";
GRANT ALL ON TABLE "public"."checklist_modelo_item" TO "authenticated";
GRANT ALL ON TABLE "public"."checklist_modelo_item" TO "service_role";



GRANT ALL ON SEQUENCE "public"."checklist_modelo_item_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."checklist_modelo_item_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."checklist_modelo_item_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."cliente" TO "anon";
GRANT ALL ON TABLE "public"."cliente" TO "authenticated";
GRANT ALL ON TABLE "public"."cliente" TO "service_role";



GRANT ALL ON SEQUENCE "public"."cliente_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."cliente_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."cliente_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."config_geral" TO "anon";
GRANT ALL ON TABLE "public"."config_geral" TO "authenticated";
GRANT ALL ON TABLE "public"."config_geral" TO "service_role";



GRANT ALL ON SEQUENCE "public"."config_geral_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."config_geral_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."config_geral_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."cores_veiculos" TO "anon";
GRANT ALL ON TABLE "public"."cores_veiculos" TO "authenticated";
GRANT ALL ON TABLE "public"."cores_veiculos" TO "service_role";



GRANT ALL ON SEQUENCE "public"."cores_veiculos_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."cores_veiculos_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."cores_veiculos_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."empresa" TO "anon";
GRANT ALL ON TABLE "public"."empresa" TO "authenticated";
GRANT ALL ON TABLE "public"."empresa" TO "service_role";



GRANT ALL ON SEQUENCE "public"."empresa_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."empresa_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."empresa_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."fornecedor" TO "anon";
GRANT ALL ON TABLE "public"."fornecedor" TO "authenticated";
GRANT ALL ON TABLE "public"."fornecedor" TO "service_role";



GRANT ALL ON SEQUENCE "public"."fornecedor_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."fornecedor_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."fornecedor_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."fornecedorprodutos" TO "anon";
GRANT ALL ON TABLE "public"."fornecedorprodutos" TO "authenticated";
GRANT ALL ON TABLE "public"."fornecedorprodutos" TO "service_role";



GRANT ALL ON SEQUENCE "public"."fornecedorprodutos_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."fornecedorprodutos_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."fornecedorprodutos_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."imagemvistoria" TO "anon";
GRANT ALL ON TABLE "public"."imagemvistoria" TO "authenticated";
GRANT ALL ON TABLE "public"."imagemvistoria" TO "service_role";



GRANT ALL ON SEQUENCE "public"."imagemvistoria_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."imagemvistoria_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."imagemvistoria_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."nfe" TO "anon";
GRANT ALL ON TABLE "public"."nfe" TO "authenticated";
GRANT ALL ON TABLE "public"."nfe" TO "service_role";



GRANT ALL ON TABLE "public"."nfe_config" TO "anon";
GRANT ALL ON TABLE "public"."nfe_config" TO "authenticated";
GRANT ALL ON TABLE "public"."nfe_config" TO "service_role";



GRANT ALL ON SEQUENCE "public"."nfe_config_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."nfe_config_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."nfe_config_id_seq" TO "service_role";



GRANT ALL ON SEQUENCE "public"."nfe_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."nfe_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."nfe_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."nfe_item" TO "anon";
GRANT ALL ON TABLE "public"."nfe_item" TO "authenticated";
GRANT ALL ON TABLE "public"."nfe_item" TO "service_role";



GRANT ALL ON SEQUENCE "public"."nfe_item_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."nfe_item_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."nfe_item_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."nfse_config" TO "anon";
GRANT ALL ON TABLE "public"."nfse_config" TO "authenticated";
GRANT ALL ON TABLE "public"."nfse_config" TO "service_role";



GRANT ALL ON TABLE "public"."notafiscal" TO "anon";
GRANT ALL ON TABLE "public"."notafiscal" TO "authenticated";
GRANT ALL ON TABLE "public"."notafiscal" TO "service_role";



GRANT ALL ON SEQUENCE "public"."notafiscal_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."notafiscal_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."notafiscal_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."ordemservico" TO "anon";
GRANT ALL ON TABLE "public"."ordemservico" TO "authenticated";
GRANT ALL ON TABLE "public"."ordemservico" TO "service_role";



GRANT ALL ON SEQUENCE "public"."ordemservico_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."ordemservico_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."ordemservico_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."osaprovacao" TO "anon";
GRANT ALL ON TABLE "public"."osaprovacao" TO "authenticated";
GRANT ALL ON TABLE "public"."osaprovacao" TO "service_role";



GRANT ALL ON SEQUENCE "public"."osaprovacao_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."osaprovacao_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."osaprovacao_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."osproduto" TO "anon";
GRANT ALL ON TABLE "public"."osproduto" TO "authenticated";
GRANT ALL ON TABLE "public"."osproduto" TO "service_role";



GRANT ALL ON TABLE "public"."osproduto_baixa" TO "anon";
GRANT ALL ON TABLE "public"."osproduto_baixa" TO "authenticated";
GRANT ALL ON TABLE "public"."osproduto_baixa" TO "service_role";



GRANT ALL ON TABLE "public"."osservico" TO "anon";
GRANT ALL ON TABLE "public"."osservico" TO "authenticated";
GRANT ALL ON TABLE "public"."osservico" TO "service_role";



GRANT ALL ON TABLE "public"."osservico_realizador" TO "anon";
GRANT ALL ON TABLE "public"."osservico_realizador" TO "authenticated";
GRANT ALL ON TABLE "public"."osservico_realizador" TO "service_role";



GRANT ALL ON TABLE "public"."pagamento" TO "anon";
GRANT ALL ON TABLE "public"."pagamento" TO "authenticated";
GRANT ALL ON TABLE "public"."pagamento" TO "service_role";



GRANT ALL ON TABLE "public"."pagamento_config" TO "anon";
GRANT ALL ON TABLE "public"."pagamento_config" TO "authenticated";
GRANT ALL ON TABLE "public"."pagamento_config" TO "service_role";



GRANT ALL ON TABLE "public"."pagamento_evento" TO "anon";
GRANT ALL ON TABLE "public"."pagamento_evento" TO "authenticated";
GRANT ALL ON TABLE "public"."pagamento_evento" TO "service_role";



GRANT ALL ON SEQUENCE "public"."pagamento_evento_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."pagamento_evento_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."pagamento_evento_id_seq" TO "service_role";



GRANT ALL ON SEQUENCE "public"."pagamento_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."pagamento_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."pagamento_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."peca" TO "anon";
GRANT ALL ON TABLE "public"."peca" TO "authenticated";
GRANT ALL ON TABLE "public"."peca" TO "service_role";



GRANT ALL ON SEQUENCE "public"."peca_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."peca_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."peca_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."perfil" TO "anon";
GRANT ALL ON TABLE "public"."perfil" TO "authenticated";
GRANT ALL ON TABLE "public"."perfil" TO "service_role";



GRANT ALL ON SEQUENCE "public"."perfil_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."perfil_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."perfil_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."perfilpermissao" TO "anon";
GRANT ALL ON TABLE "public"."perfilpermissao" TO "authenticated";
GRANT ALL ON TABLE "public"."perfilpermissao" TO "service_role";



GRANT ALL ON TABLE "public"."permissao" TO "anon";
GRANT ALL ON TABLE "public"."permissao" TO "authenticated";
GRANT ALL ON TABLE "public"."permissao" TO "service_role";



GRANT ALL ON SEQUENCE "public"."permissao_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."permissao_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."permissao_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."produto" TO "anon";
GRANT ALL ON TABLE "public"."produto" TO "authenticated";
GRANT ALL ON TABLE "public"."produto" TO "service_role";



GRANT ALL ON SEQUENCE "public"."produto_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."produto_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."produto_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."produto_imagem" TO "anon";
GRANT ALL ON TABLE "public"."produto_imagem" TO "authenticated";
GRANT ALL ON TABLE "public"."produto_imagem" TO "service_role";



GRANT ALL ON SEQUENCE "public"."produto_imagem_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."produto_imagem_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."produto_imagem_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."produtoentrada" TO "anon";
GRANT ALL ON TABLE "public"."produtoentrada" TO "authenticated";
GRANT ALL ON TABLE "public"."produtoentrada" TO "service_role";



GRANT ALL ON SEQUENCE "public"."produtoentrada_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."produtoentrada_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."produtoentrada_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."produtogrupo" TO "anon";
GRANT ALL ON TABLE "public"."produtogrupo" TO "authenticated";
GRANT ALL ON TABLE "public"."produtogrupo" TO "service_role";



GRANT ALL ON SEQUENCE "public"."produtogrupo_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."produtogrupo_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."produtogrupo_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."servico" TO "anon";
GRANT ALL ON TABLE "public"."servico" TO "authenticated";
GRANT ALL ON TABLE "public"."servico" TO "service_role";



GRANT ALL ON SEQUENCE "public"."servico_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."servico_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."servico_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."setor" TO "anon";
GRANT ALL ON TABLE "public"."setor" TO "authenticated";
GRANT ALL ON TABLE "public"."setor" TO "service_role";



GRANT ALL ON SEQUENCE "public"."setor_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."setor_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."setor_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."tiposervico" TO "anon";
GRANT ALL ON TABLE "public"."tiposervico" TO "authenticated";
GRANT ALL ON TABLE "public"."tiposervico" TO "service_role";



GRANT ALL ON SEQUENCE "public"."tiposervico_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."tiposervico_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."tiposervico_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."transacao" TO "anon";
GRANT ALL ON TABLE "public"."transacao" TO "authenticated";
GRANT ALL ON TABLE "public"."transacao" TO "service_role";



GRANT ALL ON SEQUENCE "public"."transacao_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."transacao_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."transacao_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."transferencias_veiculos" TO "anon";
GRANT ALL ON TABLE "public"."transferencias_veiculos" TO "authenticated";
GRANT ALL ON TABLE "public"."transferencias_veiculos" TO "service_role";



GRANT ALL ON SEQUENCE "public"."transferencias_veiculos_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."transferencias_veiculos_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."transferencias_veiculos_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."unidademedida" TO "anon";
GRANT ALL ON TABLE "public"."unidademedida" TO "authenticated";
GRANT ALL ON TABLE "public"."unidademedida" TO "service_role";



GRANT ALL ON SEQUENCE "public"."unidademedida_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."unidademedida_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."unidademedida_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."usuario" TO "anon";
GRANT ALL ON TABLE "public"."usuario" TO "authenticated";
GRANT ALL ON TABLE "public"."usuario" TO "service_role";



GRANT ALL ON TABLE "public"."veiculo" TO "anon";
GRANT ALL ON TABLE "public"."veiculo" TO "authenticated";
GRANT ALL ON TABLE "public"."veiculo" TO "service_role";



GRANT ALL ON SEQUENCE "public"."veiculo_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."veiculo_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."veiculo_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."venda" TO "anon";
GRANT ALL ON TABLE "public"."venda" TO "authenticated";
GRANT ALL ON TABLE "public"."venda" TO "service_role";



GRANT ALL ON SEQUENCE "public"."venda_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."venda_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."venda_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."vendaproduto" TO "anon";
GRANT ALL ON TABLE "public"."vendaproduto" TO "authenticated";
GRANT ALL ON TABLE "public"."vendaproduto" TO "service_role";



GRANT ALL ON SEQUENCE "public"."vendaproduto_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."vendaproduto_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."vendaproduto_id_seq" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































drop extension if exists "pg_net";

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

CREATE TRIGGER on_auth_user_updated_email AFTER UPDATE OF email ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_update_auth_user_email();


  create policy "vistoria: anon can upload"
  on "storage"."objects"
  as permissive
  for insert
  to anon
with check ((bucket_id = 'vistoria'::text));



  create policy "vistoria: public read"
  on "storage"."objects"
  as permissive
  for select
  to public
using ((bucket_id = 'vistoria'::text));



