-- Garante o vinculo quando a transacao e registrada pelo dialog do financeiro.
alter table public.transacao add column if not exists evento_financeiro_id bigint;
alter table public.transacao drop constraint if exists transacao_evento_financeiro_id_fkey;
alter table public.transacao add constraint transacao_evento_financeiro_id_fkey
  foreign key (evento_financeiro_id) references public.eventos_financeiros(id) on delete set null;
create unique index if not exists idx_transacao_evento_financeiro
  on public.transacao (evento_financeiro_id) where evento_financeiro_id is not null;

create or replace function public.tg_vincular_transacao_evento_financeiro()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_evento public.eventos_financeiros%rowtype;
begin
  if new.evento_financeiro_id is null then return new; end if;
  select * into v_evento from public.eventos_financeiros where id = new.evento_financeiro_id for update;
  if not found then raise exception 'Evento financeiro nao encontrado.'; end if;
  if v_evento.status <> 'ATIVO' or v_evento.transacaoid is not null then
    raise exception 'Este evento ja foi convertido ou cancelado.';
  end if;
  if v_evento.ordemservicoid <> new.ordemservicoid or v_evento.natureza <> new.tipo::text then
    raise exception 'A transacao nao corresponde a OS ou a natureza do evento financeiro.';
  end if;
  return new;
end;
$$;

create or replace function public.tg_confirmar_transacao_evento_financeiro()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.evento_financeiro_id is not null then
    update public.eventos_financeiros
       set status = 'CONVERTIDO', transacaoid = new.id, updated_at = now()
     where id = new.evento_financeiro_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_validar_transacao_evento_financeiro on public.transacao;
create trigger trg_validar_transacao_evento_financeiro
before insert on public.transacao for each row execute function public.tg_vincular_transacao_evento_financeiro();
drop trigger if exists trg_confirmar_transacao_evento_financeiro on public.transacao;
create trigger trg_confirmar_transacao_evento_financeiro
after insert on public.transacao for each row execute function public.tg_confirmar_transacao_evento_financeiro();
