CREATE OR REPLACE FUNCTION public.fn_baixar_estoque_venda(p_venda_id integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  r record;
  q_baixada int;
  delta int;
begin
  perform 1 from public.venda where id = p_venda_id for update;

  for r in
    select vp.produtoid, vp.quantidade
      from public.vendaproduto vp
     where vp.venda_id = p_venda_id
  loop
    select b.quantidade into q_baixada
      from public.vendaproduto_baixa b
     where b.venda_id = p_venda_id
       and b.produtoid = r.produtoid;

    if q_baixada is null then
      delta := r.quantidade;
    else
      delta := r.quantidade - q_baixada;
    end if;

    if delta > 0 then
      update public.produto
         set estoque = estoque - delta,
             updatedat = now()
       where id = r.produtoid
         and estoque >= delta;

      if not found then
        raise exception 'Estoque insuficiente para o produto % (necessário: %, venda %)',
          r.produtoid, delta, p_venda_id
          using errcode = 'P0001';
      end if;
    elsif delta < 0 then
      update public.produto
         set estoque = estoque + (-delta),
             updatedat = now()
       where id = r.produtoid;
    end if;

    insert into public.vendaproduto_baixa (venda_id, produtoid, quantidade, updated_at)
    values (p_venda_id, r.produtoid, r.quantidade, now())
    on conflict (venda_id, produtoid) do update
      set quantidade = excluded.quantidade,
          updated_at = now();
  end loop;

  return jsonb_build_object('ok', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.fn_estornar_estoque_venda(p_venda_id integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  r record;
begin
  perform 1 from public.venda where id = p_venda_id for update;

  for r in
    select produtoid, quantidade
      from public.vendaproduto_baixa
     where venda_id = p_venda_id
  loop
    update public.produto
       set estoque = estoque + r.quantidade,
           updatedat = now()
     where id = r.produtoid;
  end loop;

  delete from public.vendaproduto_baixa
   where venda_id = p_venda_id;

  return jsonb_build_object('ok', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS boolean
LANGUAGE sql
STABLE
AS $function$
  select exists (
    select 1 from public.usuario u
    where u.id = (select auth.uid())
      and u.ativo = true
  );
$function$;

CREATE OR REPLACE FUNCTION public.replicar_baixa_estoque_venda(p_venda_id integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  r record;
  q_baixada int;
  delta int;
begin
  for r in
    select vp.produtoid, vp.quantidade
      from public.vendaproduto vp
     where vp.venda_id = p_venda_id
  loop
    select b.quantidade into q_baixada
      from public.vendaproduto_baixa b
     where b.venda_id = p_venda_id
       and b.produtoid = r.produtoid;

    if q_baixada is null then
      delta := r.quantidade;
    else
      delta := r.quantidade - q_baixada;
    end if;

    if delta > 0 then
      update public.produto
         set estoque = estoque - delta
       where id = r.produtoid
         and estoque >= delta;

      if not found then
        raise exception 'Estoque insuficiente para o produto % (necessário: %, venda %)', r.produtoid, delta, p_venda_id
          using errcode = 'P0001';
      end if;
    elsif delta < 0 then
      update public.produto
         set estoque = estoque + (-delta)
       where id = r.produtoid;
    end if;

    insert into public.vendaproduto_baixa (venda_id, produtoid, quantidade, updated_at)
    values (p_venda_id, r.produtoid, r.quantidade, now())
    on conflict (venda_id, produtoid) do update
      set quantidade = excluded.quantidade,
          updated_at = now();
  end loop;

  for r in
    select b.produtoid, b.quantidade
      from public.vendaproduto_baixa b
     where b.venda_id = p_venda_id
       and not exists (
         select 1
           from public.vendaproduto vp
          where vp.venda_id = p_venda_id
            and vp.produtoid = b.produtoid
       )
  loop
    update public.produto
       set estoque = estoque + r.quantidade
     where id = r.produtoid;

    delete from public.vendaproduto_baixa
     where venda_id = p_venda_id
       and produtoid = r.produtoid;
  end loop;
end;
$function$;

INSERT INTO storage.buckets (id, name, owner, public, file_size_limit, allowed_mime_types)
VALUES
  ('danfe', 'danfe', NULL, true, NULL, NULL),
  ('empresa', 'empresa', NULL, true, NULL, NULL),
  ('produto_imagem', 'produto_imagem', NULL, true, NULL, NULL),
  ('venda_anexos', 'venda_anexos', NULL, true, NULL, NULL),
  ('vistoria', 'vistoria', NULL, true, NULL, NULL)
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    owner = EXCLUDED.owner,
    public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "vistoria: anon can upload" ON storage.objects;
DROP POLICY IF EXISTS "vistoria: public read" ON storage.objects;
DROP POLICY IF EXISTS "authenticated can upload vistoria" ON storage.objects;

CREATE POLICY "authenticated can upload vistoria"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'vistoria'::text);
