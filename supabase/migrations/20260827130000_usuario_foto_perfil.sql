begin;

alter table public.usuario
  add column if not exists foto_url text,
  add column if not exists foto_path text;

comment on column public.usuario.foto_url is
  'URL publica da foto de perfil normalizada pela API do ERP.';

comment on column public.usuario.foto_path is
  'Caminho interno no bucket usuario-avatar; usado para substituir a foto sem deixar arquivos antigos.';

insert into storage.buckets (
  id,
  name,
  owner,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'usuario-avatar',
  'usuario-avatar',
  null,
  true,
  1048576,
  array['image/webp']
)
on conflict (id) do update
set name = excluded.name,
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- O bucket e publico somente para leitura das fotos. Escrita e exclusao
-- continuam restritas ao service_role usado pela API autenticada do ERP.
drop policy if exists usuario_avatar_insert_authenticated on storage.objects;
drop policy if exists usuario_avatar_update_authenticated on storage.objects;
drop policy if exists usuario_avatar_delete_authenticated on storage.objects;

commit;
