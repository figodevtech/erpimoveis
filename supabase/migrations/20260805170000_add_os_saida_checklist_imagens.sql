create table if not exists public.os_saida_checklist_imagem (
  id bigint generated always as identity primary key,
  checklist_item_id bigint not null references public.os_saida_checklist_item(id) on delete cascade,
  url text not null,
  descricao text,
  created_by uuid not null references public.usuario(id),
  created_at timestamptz not null default now()
);

create index if not exists os_saida_checklist_imagem_item_idx
  on public.os_saida_checklist_imagem(checklist_item_id);

alter table public.os_saida_checklist_imagem enable row level security;
alter table public.os_saida_checklist_imagem no force row level security;
grant select, insert, update, delete on public.os_saida_checklist_imagem to authenticated, service_role;
grant usage, select on sequence public.os_saida_checklist_imagem_id_seq to authenticated, service_role;

do $$
begin
  if to_regprocedure('public.habilitar_auditoria_tabela(regclass)') is not null then
    perform public.habilitar_auditoria_tabela('public.os_saida_checklist_imagem'::regclass);
  end if;
end;
$$;
