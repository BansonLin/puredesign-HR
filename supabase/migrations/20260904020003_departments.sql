-- T02 / CLAUDE.md §5 departments; PLAN 4.3.

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sort_order int not null default 0,
  constraint departments_name_key unique (name),
  constraint departments_name_chk check (length(btrim(name)) > 0)
);

alter table public.departments enable row level security;
revoke all on table public.departments from anon, authenticated;
