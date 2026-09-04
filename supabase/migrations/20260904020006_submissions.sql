-- T02 / CLAUDE.md §5 submissions; PLAN 4.3, 4.6.
-- One row per newcomer per day (newcomer_daily), manager responses, weekly feedback; answers = jsonb.

create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  template_key text not null,
  form_version_id uuid not null,
  user_id uuid not null,                 -- author
  target_user_id uuid,                   -- newcomer targeted by manager_response / weekly_feedback
  target_submission_id uuid,             -- daily log targeted by manager_response
  log_date date,
  week_start date,
  answers jsonb not null default '{}',
  source public.submission_source not null default 'app',
  submitted_at timestamptz not null default now(),   -- first submission; resubmits do not change it
  updated_at timestamptz not null default now(),     -- maintained by trigger
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,
  constraint submissions_template_key_fkey foreign key (template_key)
    references public.form_templates (key) on delete restrict,
  constraint submissions_form_version_id_fkey foreign key (form_version_id)
    references public.form_versions (id) on delete restrict,
  constraint submissions_user_id_fkey foreign key (user_id)
    references public.profiles (id) on delete restrict,
  constraint submissions_target_user_id_fkey foreign key (target_user_id)
    references public.profiles (id) on delete restrict,
  constraint submissions_target_submission_id_fkey foreign key (target_submission_id)
    references public.submissions (id) on delete restrict,
  constraint submissions_deleted_by_fkey foreign key (deleted_by)
    references public.profiles (id) on delete set null,
  constraint submissions_week_start_chk
    check (week_start is null or extract(isodow from week_start) = 1),
  constraint submissions_answers_chk check (jsonb_typeof(answers) = 'object'),
  constraint submissions_delete_reason_chk
    check (deleted_at is null or delete_reason is not null),
  constraint submissions_shape_chk check (
    case template_key
      when 'newcomer_daily'   then log_date is not null and target_user_id is null
                                   and target_submission_id is null and week_start is null
      when 'manager_response' then target_user_id is not null and target_submission_id is not null
                                   and log_date is null and week_start is null
      when 'weekly_feedback'  then target_user_id is not null and week_start is not null
                                   and target_submission_id is null and log_date is null
      else true
    end)
);

-- CLAUDE.md §5 partial unique indexes (soft-deleted rows do not count).
create unique index submissions_daily_user_date_uidx
  on public.submissions (template_key, user_id, log_date)
  where template_key = 'newcomer_daily' and deleted_at is null;
create unique index submissions_weekly_uidx
  on public.submissions (template_key, user_id, target_user_id, week_start)
  where template_key = 'weekly_feedback' and deleted_at is null;

-- Query indexes (PLAN 4.3).
create index submissions_daily_date_idx
  on public.submissions (log_date, user_id)
  where template_key = 'newcomer_daily' and deleted_at is null;
create index submissions_target_submission_idx
  on public.submissions (target_submission_id)
  where target_submission_id is not null;
create index submissions_target_user_idx
  on public.submissions (target_user_id, submitted_at desc)
  where target_user_id is not null;
create index submissions_form_version_idx
  on public.submissions (form_version_id);

create trigger submissions_set_updated_at
  before update on public.submissions
  for each row when (old.* is distinct from new.*)
  execute function public.set_updated_at();

alter table public.submissions enable row level security;
revoke all on table public.submissions from anon, authenticated;
