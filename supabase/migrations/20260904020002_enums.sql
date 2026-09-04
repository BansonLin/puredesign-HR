-- T02 / PLAN 4.2: the 8 enum types (values can only be added later, never removed; CLAUDE.md §5).

create type public.user_role as enum ('newcomer', 'manager', 'hr', 'ceo', 'admin');
create type public.profile_status as enum ('active', 'left', 'sample');
create type public.form_target_role as enum ('newcomer', 'manager');
create type public.form_version_status as enum ('draft', 'published', 'archived');
create type public.submission_source as enum ('app', 'import');
create type public.alert_status as enum ('open', 'responded', 'closed');
create type public.milestone_kind as enum ('D30', 'D60', 'D90');
create type public.milestone_outcome as enum ('continue', 'watch', 'adjust', 'end');
