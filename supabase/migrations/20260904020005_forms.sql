-- T02 / CLAUDE.md §5 form_templates + form_versions; PLAN 4.3, 4.4 #5.
-- Circular FK: form_templates.active_version_id is added with `alter table` after form_versions exists.

create table public.form_templates (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  name text not null,
  description text,
  target_role public.form_target_role not null,
  active_version_id uuid,                -- composite FK added below
  created_at timestamptz not null default now(),
  constraint form_templates_key_key unique (key),
  constraint form_templates_key_chk check (key ~ '^[a-z][a-z0-9_]*$')
);

create table public.form_versions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null,
  version_no int not null,
  status public.form_version_status not null default 'draft',
  questions jsonb not null default '[]',
  change_note text,
  published_at timestamptz,
  published_by uuid,
  created_at timestamptz not null default now(),
  constraint form_versions_template_id_fkey foreign key (template_id)
    references public.form_templates (id) on delete restrict,
  constraint form_versions_published_by_fkey foreign key (published_by)
    references public.profiles (id) on delete set null,
  constraint form_versions_version_no_chk check (version_no > 0),
  constraint form_versions_questions_chk check (jsonb_typeof(questions) = 'array'),
  constraint form_versions_published_at_chk check (status = 'draft' or published_at is not null),
  constraint form_versions_template_id_version_no_key unique (template_id, version_no),
  constraint form_versions_id_template_id_key unique (id, template_id)   -- target of the composite FK
);

-- At most one draft and one published version per template (CLAUDE.md §5).
create unique index form_versions_one_draft_idx
  on public.form_versions (template_id) where status = 'draft';
create unique index form_versions_one_published_idx
  on public.form_versions (template_id) where status = 'published';

-- Composite FK guarantees the active version belongs to the same template.
-- PG 15+ column list on `set null`: only active_version_id is cleared, the PK id is untouched.
alter table public.form_templates
  add constraint form_templates_active_version_fkey
  foreign key (active_version_id, id)
  references public.form_versions (id, template_id)
  on delete set null (active_version_id);

alter table public.form_templates enable row level security;
revoke all on table public.form_templates from anon, authenticated;

alter table public.form_versions enable row level security;
revoke all on table public.form_versions from anon, authenticated;
