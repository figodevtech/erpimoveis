begin;

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

drop trigger if exists on_auth_user_updated_email on auth.users;
create trigger on_auth_user_updated_email
  after update of email on auth.users
  for each row execute function public.handle_update_auth_user_email();

commit;
