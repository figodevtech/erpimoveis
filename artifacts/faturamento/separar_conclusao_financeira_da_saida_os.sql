CREATE OR REPLACE FUNCTION public.separar_conclusao_financeira_da_saida_os()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if new.status::text = 'CONCLUIDO'
     and old.status::text is distinct from 'CONCLUIDO' then
    new.pagamento_concluido_em := coalesce(new.pagamento_concluido_em, new.datasaida, now());
  end if;
  if old.status::text = 'CONCLUIDO' and new.status::text = 'PAGAMENTO' then
    new.pagamento_concluido_em := null;
  end if;

  if new.datasaida is distinct from old.datasaida
     and not exists (
       select 1 from public.os_saida s where s.ordemservico_id = old.id
     ) then
    new.datasaida := old.datasaida;
  end if;
  return new;
end;
$function$
