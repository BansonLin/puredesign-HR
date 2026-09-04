-- T02 / CLAUDE.md §5 milestones; PLAN 4.3, 4.7.
-- D30 / D60 / D90 per newcomer; rows are created by the application (lib/time/milestones.ts), not by a trigger.

create table public.milestones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  kind public.milestone_kind not null,
  due_date date not null,
  done_at timestamptz,
  interviewer_id uuid,
  notes text,
  outcome public.milestone_outcome,
  constraint milestones_user_id_fkey foreign key (user_id)
    references public.profiles (id) on delete cascade,
  constraint milestones_interviewer_id_fkey foreign key (interviewer_id)
    references public.profiles (id) on delete set null,
  constraint milestones_user_id_kind_key unique (user_id, kind)   -- upsert conflict target
);

create index milestones_due_idx on public.milestones (due_date) where done_at is null;

alter table public.milestones enable row level security;
revoke all on table public.milestones from anon, authenticated;
