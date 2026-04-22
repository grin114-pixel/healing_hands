-- Healing Hands – Supabase schema
-- Run this in the Supabase SQL Editor

-- App settings (PIN hash)
create table if not exists public.hh_app_settings (
  id          text primary key default 'global',
  pin_hash    text not null,
  updated_at  timestamptz not null default now()
);

alter table public.hh_app_settings enable row level security;

create policy "anon can read settings"
  on public.hh_app_settings for select
  to anon using (true);

create policy "anon can upsert settings"
  on public.hh_app_settings for insert
  to anon with check (true);

create policy "anon can update settings"
  on public.hh_app_settings for update
  to anon using (true);

-- Records
create table if not exists public.hh_records (
  id           uuid primary key default gen_random_uuid(),
  record_date  date not null,
  location     text not null default '',
  therapist    text not null default '',
  course       text not null default '',
  amount       text not null default '',
  balance      text not null default '',
  memo         text not null default '',
  created_at   timestamptz not null default now()
);

alter table public.hh_records enable row level security;

create policy "anon can read records"
  on public.hh_records for select
  to anon using (true);

create policy "anon can insert records"
  on public.hh_records for insert
  to anon with check (true);

create policy "anon can update records"
  on public.hh_records for update
  to anon using (true);

create policy "anon can delete records"
  on public.hh_records for delete
  to anon using (true);
