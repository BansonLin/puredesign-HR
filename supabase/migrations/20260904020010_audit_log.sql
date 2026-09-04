-- T02 / CLAUDE.md §5 audit_log; PLAN 4.3. Insert-only from the application.

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null,
  action text not null,                  -- e.g. user.create, form.publish, submission.edit
  entity text not null,                  -- table name
  entity_id text not null,
  before jsonb,
  after jsonb,
  reason text,
  created_at timestamptz not null default now(),
  constraint audit_log_actor_id_fkey foreign key (actor_id)
    references public.profiles (id) on delete restrict
);

create index audit_log_created_idx on public.audit_log (created_at);
create index audit_log_actor_idx on public.audit_log (actor_id, created_at desc);
create index audit_log_entity_idx on public.audit_log (entity, entity_id);

alter table public.audit_log enable row level security;
revoke all on table public.audit_log from anon, authenticated;
