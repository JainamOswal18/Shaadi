create table reel_jobs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'queued'
    check (status in ('queued','rendering','done','error')),
  spec jsonb not null,
  output_key text,
  error text,
  session_id uuid,
  guest_name text,
  ip text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists reel_jobs_status_created on reel_jobs(status, created_at desc);
