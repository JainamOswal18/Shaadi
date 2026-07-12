create extension if not exists vector;
create table photos (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('ingest','guest_upload')),
  content_hash text unique not null,
  original_key text not null,
  preview_key text not null,
  thumb_key text not null,
  width int, height int, bytes bigint,
  taken_at timestamptz, uploaded_by text, upload_session uuid,
  status text not null default 'active' check (status in ('active','deleted')),
  created_at timestamptz not null default now()
);
create table faces (
  id uuid primary key default gen_random_uuid(),
  photo_id uuid not null references photos(id) on delete cascade,
  embedding vector(512) not null,
  bbox jsonb, det_score real,
  created_at timestamptz not null default now()
);
create table media (
  id uuid primary key default gen_random_uuid(),
  source text not null, content_hash text unique not null,
  original_key text not null, poster_key text,
  duration real, bytes bigint, uploaded_by text, upload_session uuid,
  status text not null default 'active', created_at timestamptz not null default now()
);
create table search_sessions (
  id uuid primary key default gen_random_uuid(),
  guest_name text, ip text, user_agent text, selfie_key text,
  match_count int, created_at timestamptz not null default now()
);
create table upload_events (
  id uuid primary key default gen_random_uuid(),
  upload_session uuid, guest_name text, ip text, user_agent text,
  photo_count int default 0, video_count int default 0, created_at timestamptz not null default now()
);
create table download_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid, guest_name text, ip text,
  kind text check (kind in ('single','zip')), photo_id uuid, count int,
  created_at timestamptz not null default now()
);
create table admin_settings (
  id int primary key default 1,
  match_threshold real not null default 0.38,
  passcode_enabled boolean not null default false,
  passcode_hash text,
  kill_switch boolean not null default false
);
insert into admin_settings (id) values (1) on conflict do nothing;
