-- T02 / PLAN 4.4 #1: shared helpers.
-- (a) Default privileges: nothing created later in public is exposed to anon / authenticated
--     (PLAN 4.5). Per-table revoke lives in each table's own migration.
-- (b) set_updated_at(): trigger function for submissions.updated_at / settings.updated_at (PLAN 4.6).

alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on functions from anon, authenticated;

create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

revoke all on function public.set_updated_at() from anon, authenticated;
