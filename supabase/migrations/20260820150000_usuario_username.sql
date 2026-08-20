begin;

alter table public.usuario
  add column if not exists username varchar(30);

alter table public.usuario
  drop constraint if exists usuario_username_formato_check;

alter table public.usuario
  add constraint usuario_username_formato_check
  check (
    username is null
    or (
      username = lower(btrim(username))
      and username ~ '^[a-z0-9._-]{3,30}$'
    )
  );

create unique index if not exists usuario_username_lower_key
  on public.usuario (lower(username))
  where username is not null;

comment on column public.usuario.username is
  'Identificador unico e normalizado usado como alternativa ao e-mail no login.';

commit;

