-- T02 / CLAUDE.md §5 profiles; PLAN 4.3.
-- id = auth.users.id (Supabase Auth); username is the local part of {username}@pure.internal.

create table public.profiles (
  id uuid primary key,
  username text not null,
  display_name text not null,
  role public.user_role not null,
  department_id uuid,
  manager_id uuid,
  start_date date,
  status public.profile_status not null default 'active',
  must_change_password boolean not null default true,
  line_user_id text,
  created_at timestamptz not null default now(),
  constraint profiles_id_fkey foreign key (id)
    references auth.users (id) on delete cascade,
  constraint profiles_department_id_fkey foreign key (department_id)
    references public.departments (id) on delete restrict,
  constraint profiles_manager_id_fkey foreign key (manager_id)
    references public.profiles (id) on delete set null,
  constraint profiles_username_key unique (username),
  constraint profiles_username_chk check (username ~ '^[a-z0-9][a-z0-9_.-]{1,31}$'),
  constraint profiles_display_name_chk check (length(btrim(display_name)) > 0),
  constraint profiles_manager_id_chk check (manager_id <> id)
);

create index profiles_department_id_idx on public.profiles (department_id);
create index profiles_manager_id_idx on public.profiles (manager_id);
create index profiles_role_status_idx on public.profiles (role, status);

alter table public.profiles enable row level security;
revoke all on table public.profiles from anon, authenticated;
