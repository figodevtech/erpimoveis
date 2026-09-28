begin;

-- Objetos da loja virtual passam a fazer parte do schema padrão.
--
-- Eles nasceram no banco do Demir, fora das migrations, e o `db:deploy` acusava
-- divergência em todo deploy. Clientes sem loja apenas não os usam. As
-- definições abaixo são as do Demir; lá esta migration não muda nada.

-- 1. Leads do formulário de contato do site. Só o backend (service_role) lê e grava.
create table if not exists public.contato_lead (
  id bigserial primary key,
  nome text,
  email text not null,
  telefone text,
  assunto text not null,
  mensagem text not null,
  status text not null default 'NOVO',
  origem text default 'SITE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_contato_lead_created_at on public.contato_lead (created_at desc);
create index if not exists idx_contato_lead_status on public.contato_lead (status);
create index if not exists idx_contato_lead_email on public.contato_lead (email);

alter table public.contato_lead enable row level security;
revoke all on table public.contato_lead from public, anon, authenticated;
grant all on table public.contato_lead to service_role;
revoke all on sequence public.contato_lead_id_seq from public, anon, authenticated;
grant usage, select, update on sequence public.contato_lead_id_seq to service_role;

drop policy if exists service_role_all_contato_lead on public.contato_lead;
create policy service_role_all_contato_lead
  on public.contato_lead
  for all
  to service_role
  using (true)
  with check (true);

-- 2. Disponibilidade exibida pela loja, derivada do saldo.
alter table public.produto
  add column if not exists em_estoque boolean generated always as (estoque > 0) stored;

create index if not exists idx_produto_em_estoque on public.produto (em_estoque);

-- 3. Pedido do site: cria a venda PENDENTE e os itens numa única transação.
create or replace function public.fn_criar_pedido_site(
  p_cliente_id integer,
  p_endereco_snapshot jsonb,
  p_itens jsonb,
  p_subtotal numeric,
  p_total numeric,
  p_canal text default 'ONLINE'::text,
  p_forma_pagamento text default 'Pagar.me'::text
)
 returns integer
 language plpgsql
 security definer
as $function$
DECLARE
    v_venda_id integer;
    v_item jsonb;
    v_produtoid integer;
    v_quantidade integer;
    v_sub_total numeric;
    v_valor_total numeric;
    v_canal public.enum_canal_venda;
    v_now timestamptz := now();
BEGIN
    IF p_cliente_id IS NULL OR p_cliente_id <= 0 THEN
        RAISE EXCEPTION 'Cliente inválido para criação de pedido.';
    END IF;

    IF p_itens IS NULL OR jsonb_array_length(p_itens) = 0 THEN
        RAISE EXCEPTION 'Pedido deve conter pelo menos um item.';
    END IF;

    -- Converte canal com fallback seguro para ONLINE
    BEGIN
        v_canal := COALESCE(p_canal, 'ONLINE')::public.enum_canal_venda;
    EXCEPTION WHEN OTHERS THEN
        v_canal := 'ONLINE'::public.enum_canal_venda;
    END;

    -- 1. Cria a venda com status PENDENTE (transação única)
    INSERT INTO public.venda (
        clienteid,
        status,
        valortotal,
        sub_total,
        datavenda,
        createdat,
        updatedat,
        forma_pagamento,
        endereco_entrega_snapshot,
        canal
    ) VALUES (
        p_cliente_id,
        'PENDENTE'::public.enum_status_venda,
        p_total,
        p_subtotal,
        v_now,
        v_now,
        v_now,
        p_forma_pagamento,
        p_endereco_snapshot,
        v_canal
    )
    RETURNING id INTO v_venda_id;

    -- 2. Insere todos os itens. Se qualquer item falhar, rollback total automático do plpgsql
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_itens)
    LOOP
        v_produtoid := (v_item->>'produtoid')::integer;
        v_quantidade := (v_item->>'quantidade')::integer;
        v_sub_total := (v_item->>'sub_total')::numeric;
        v_valor_total := (v_item->>'valor_total')::numeric;

        IF v_produtoid IS NULL OR v_quantidade IS NULL OR v_quantidade <= 0 THEN
            RAISE EXCEPTION 'Item com produto ou quantidade inválida no pedido: produto % quantidade %', v_produtoid, v_quantidade;
        END IF;

        INSERT INTO public.vendaproduto (
            venda_id,
            produtoid,
            quantidade,
            sub_total,
            valor_total,
            valor_frete,
            created_at,
            updated_at
        ) VALUES (
            v_venda_id,
            v_produtoid,
            v_quantidade,
            v_sub_total,
            v_valor_total,
            0,
            v_now,
            v_now
        );
    END LOOP;

    RETURN v_venda_id;
END;
$function$;

revoke all on function public.fn_criar_pedido_site(integer, jsonb, jsonb, numeric, numeric, text, text) from public, anon, authenticated;
grant execute on function public.fn_criar_pedido_site(integer, jsonb, jsonb, numeric, numeric, text, text) to service_role;

-- 4. Cliente da loja vê e altera só o que é dele, e só autenticado. As policies
--    antigas tinham a mesma condição, mas valiam para `public` (inclusive anon).
drop policy if exists "Endereços: Ver seus próprios" on public.cliente_endereco;
drop policy if exists "Endereços: Inserir seus próprios" on public.cliente_endereco;
drop policy if exists "Endereços: Atualizar seus próprios" on public.cliente_endereco;
drop policy if exists "Endereços: Deletar seus próprios" on public.cliente_endereco;
drop policy if exists "Favoritos: Ver seus próprios" on public.favorito;
drop policy if exists "Favoritos: Gerenciar seus próprios" on public.favorito;

drop policy if exists cliente_select_own on public.cliente;
create policy cliente_select_own on public.cliente
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists cliente_insert_own on public.cliente;
create policy cliente_insert_own on public.cliente
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists cliente_update_own on public.cliente;
create policy cliente_update_own on public.cliente
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists cliente_endereco_select_own on public.cliente_endereco;
create policy cliente_endereco_select_own on public.cliente_endereco
  for select to authenticated
  using (cliente_id in (select cliente.id from public.cliente where cliente.user_id = auth.uid()));

drop policy if exists cliente_endereco_insert_own on public.cliente_endereco;
create policy cliente_endereco_insert_own on public.cliente_endereco
  for insert to authenticated
  with check (cliente_id in (select cliente.id from public.cliente where cliente.user_id = auth.uid()));

drop policy if exists cliente_endereco_update_own on public.cliente_endereco;
create policy cliente_endereco_update_own on public.cliente_endereco
  for update to authenticated
  using (cliente_id in (select cliente.id from public.cliente where cliente.user_id = auth.uid()))
  with check (cliente_id in (select cliente.id from public.cliente where cliente.user_id = auth.uid()));

drop policy if exists cliente_endereco_delete_own on public.cliente_endereco;
create policy cliente_endereco_delete_own on public.cliente_endereco
  for delete to authenticated
  using (cliente_id in (select cliente.id from public.cliente where cliente.user_id = auth.uid()));

drop policy if exists favorito_select_own on public.favorito;
create policy favorito_select_own on public.favorito
  for select to authenticated
  using (cliente_id in (select cliente.id from public.cliente where cliente.user_id = auth.uid()));

drop policy if exists favorito_insert_own on public.favorito;
create policy favorito_insert_own on public.favorito
  for insert to authenticated
  with check (cliente_id in (select cliente.id from public.cliente where cliente.user_id = auth.uid()));

drop policy if exists favorito_delete_own on public.favorito;
create policy favorito_delete_own on public.favorito
  for delete to authenticated
  using (cliente_id in (select cliente.id from public.cliente where cliente.user_id = auth.uid()));

drop policy if exists venda_select_own on public.venda;
create policy venda_select_own on public.venda
  for select to authenticated
  using (clienteid in (select cliente.id from public.cliente where cliente.user_id = auth.uid()));

drop policy if exists vendaproduto_select_own on public.vendaproduto;
create policy vendaproduto_select_own on public.vendaproduto
  for select to authenticated
  using (venda_id in (
    select v.id
    from public.venda v
    join public.cliente c on c.id = v.clienteid
    where c.user_id = auth.uid()
  ));

commit;
