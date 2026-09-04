-- T02 / CLAUDE.md §5 alerts; PLAN 4.3.
-- Rule-generated alerts attached to a daily log; unique per (submission, rule).

create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null,
  user_id uuid not null,                 -- newcomer (denormalised; queries still join submissions, A05)
  rule_key text not null,
  detail jsonb not null default '{}',
  status public.alert_status not null default 'open',
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  response_submission_id uuid,
  closed_at timestamptz,
  closed_by uuid,                        -- null when closed by the system
  closed_reason text,
  constraint alerts_submission_id_fkey foreign key (submission_id)
    references public.submissions (id) on delete cascade,
  constraint alerts_user_id_fkey foreign key (user_id)
    references public.profiles (id) on delete restrict,
  constraint alerts_response_submission_id_fkey foreign key (response_submission_id)
    references public.submissions (id) on delete restrict,
  constraint alerts_closed_by_fkey foreign key (closed_by)
    references public.profiles (id) on delete set null,
  constraint alerts_rule_key_chk check (rule_key ~ '^[A-Z][0-9]+$'),
  constraint alerts_detail_chk check (jsonb_typeof(detail) = 'object'),
  constraint alerts_responded_chk
    check (status <> 'responded' or (responded_at is not null and response_submission_id is not null)),
  constraint alerts_closed_chk check (status <> 'closed' or closed_at is not null),
  constraint alerts_submission_id_rule_key_key unique (submission_id, rule_key)
);

create index alerts_user_created_idx on public.alerts (user_id, created_at desc);
create index alerts_open_idx on public.alerts (created_at) where status = 'open';

alter table public.alerts enable row level security;
revoke all on table public.alerts from anon, authenticated;
