-- T02 / CLAUDE.md §5 settings; PLAN 4.3, 4.6, 4.8.
-- Required keys (daily_cutoff_time, response_threshold_hours, rules, workweek) are inserted by seed, not here (PLAN 4.9).

create table public.settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),   -- maintained by trigger
  updated_by uuid,
  constraint settings_updated_by_fkey foreign key (updated_by)
    references public.profiles (id) on delete set null
);

create trigger settings_set_updated_at
  before update on public.settings
  for each row when (old.* is distinct from new.*)
  execute function public.set_updated_at();

alter table public.settings enable row level security;
revoke all on table public.settings from anon, authenticated;
