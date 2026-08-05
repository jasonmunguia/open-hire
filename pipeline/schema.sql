create extension if not exists "pgcrypto";

create table if not exists jobs (
  id          uuid primary key default gen_random_uuid(),
  external_id text not null unique,
  title       text not null,
  label       text not null,
  created_at  timestamptz not null default now()
);

create table if not exists candidates (
  id           uuid primary key default gen_random_uuid(),
  job_id       uuid not null references jobs(id) on delete cascade,
  candidate_id text,
  email        text not null,
  name         text not null,
  school       text,
  school_year  text,
  majors       text,
  grad_date    date,
  phone        text,
  page_count   int  not null default 1,
  image_urls   text[] not null default '{}',
  pdf_key      text,
  sort_key     text,
  flags        text[] not null default '{}',
  created_at   timestamptz not null default now(),
  unique (job_id, email)
);

-- Append-only. Round state is replayed from this table, which is what makes
-- undo exact and lets a later round show the note written in an earlier one.
create table if not exists decisions (
  id           uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references candidates(id) on delete cascade,
  round        int  not null,
  action       text not null check (action in ('reject','auto_bid','next_round')),
  note         text,
  created_at   timestamptz not null default now()
);

create index if not exists decisions_candidate_idx on decisions (candidate_id, round desc);
create index if not exists candidates_job_sort_idx on candidates (job_id, sort_key);
