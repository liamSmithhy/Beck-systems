-- ============================================================================
-- BECK SYSTEMS — CLIENT PORTAL DATABASE SCHEMA
-- Run this in the Supabase SQL editor (Dashboard -> SQL Editor -> New query).
-- It creates every table, locks them down with row-level security (RLS) so
-- the owner sees everything and each client sees ONLY their own data, and
-- seeds the owner account.
-- ============================================================================

-- Needed for gen_random_uuid()
create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- PROFILES  (one row per login; extends Supabase auth.users)
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  role        text not null default 'client' check (role in ('owner','client')),
  full_name   text,
  company     text,
  email       text,
  phone       text,
  created_at  timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- PROJECTS  (a web build belonging to a client)
-- ----------------------------------------------------------------------------
create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.profiles(id) on delete cascade,
  name        text not null,
  summary     text,
  stage       text not null default 'Discovery',        -- Discovery / Design / Build / Review / Launched
  progress    int  not null default 0 check (progress between 0 and 100),
  status      text not null default 'active' check (status in ('active','paused','launched','archived')),
  site_url    text,
  deploy_status text default 'not_deployed',             -- not_deployed / building / live / error
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- MILESTONES  (design/build milestones inside a project)
-- ----------------------------------------------------------------------------
create table if not exists public.milestones (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  title       text not null,
  detail      text,
  status      text not null default 'pending' check (status in ('pending','in_progress','done')),
  position    int  not null default 0,
  due_date    date,
  created_at  timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- FEEDBACK  (revision hub: feedback / copy change / bug, tied to a section)
-- ----------------------------------------------------------------------------
create table if not exists public.feedback (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  author_id   uuid not null references public.profiles(id) on delete cascade,
  section     text,                                      -- e.g. "Hero", "Pricing", "Contact"
  type        text not null default 'feedback' check (type in ('feedback','copy','bug')),
  message     text not null,
  status      text not null default 'open' check (status in ('open','in_progress','resolved')),
  created_at  timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- TICKETS  (ongoing maintenance / retainer requests)
-- ----------------------------------------------------------------------------
create table if not exists public.tickets (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.profiles(id) on delete cascade,
  project_id  uuid references public.projects(id) on delete set null,
  subject     text not null,
  body        text,
  priority    text not null default 'normal' check (priority in ('low','normal','high')),
  status      text not null default 'open' check (status in ('open','in_progress','closed')),
  created_at  timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- INVOICES  (quotes / invoices, paid via Stripe Checkout)
-- ----------------------------------------------------------------------------
create table if not exists public.invoices (
  id                   uuid primary key default gen_random_uuid(),
  client_id            uuid not null references public.profiles(id) on delete cascade,
  project_id           uuid references public.projects(id) on delete set null,
  description          text not null,
  amount_cents         int  not null check (amount_cents >= 0),
  currency             text not null default 'usd',
  status               text not null default 'draft' check (status in ('draft','sent','paid','void')),
  stripe_session_id    text,
  stripe_payment_intent text,
  created_at           timestamptz not null default now(),
  paid_at              timestamptz
);

-- ----------------------------------------------------------------------------
-- CONTRACTS  (service agreements)
-- ----------------------------------------------------------------------------
create table if not exists public.contracts (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.profiles(id) on delete cascade,
  title       text not null,
  url         text,                                      -- link to the agreement / signed PDF
  status      text not null default 'sent' check (status in ('draft','sent','signed')),
  created_at  timestamptz not null default now(),
  signed_at   timestamptz
);

-- ============================================================================
-- ROW-LEVEL SECURITY
-- ============================================================================
alter table public.profiles   enable row level security;
alter table public.projects   enable row level security;
alter table public.milestones enable row level security;
alter table public.feedback   enable row level security;
alter table public.tickets    enable row level security;
alter table public.invoices   enable row level security;
alter table public.contracts  enable row level security;

-- Helper: is the current logged-in user the owner?
create or replace function public.is_owner()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'owner'
  );
$$;

-- ---- PROFILES ----
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select using ( id = auth.uid() or public.is_owner() );

drop policy if exists profiles_write on public.profiles;
create policy profiles_write on public.profiles
  for all using ( public.is_owner() ) with check ( public.is_owner() );

-- ---- PROJECTS ----
drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects
  for select using ( client_id = auth.uid() or public.is_owner() );

drop policy if exists projects_write on public.projects;
create policy projects_write on public.projects
  for all using ( public.is_owner() ) with check ( public.is_owner() );

-- ---- MILESTONES ----  (access follows the parent project)
drop policy if exists milestones_select on public.milestones;
create policy milestones_select on public.milestones
  for select using (
    public.is_owner() or exists (
      select 1 from public.projects p
      where p.id = milestones.project_id and p.client_id = auth.uid()
    )
  );

drop policy if exists milestones_write on public.milestones;
create policy milestones_write on public.milestones
  for all using ( public.is_owner() ) with check ( public.is_owner() );

-- ---- FEEDBACK ----  (client can read + create on their own project; owner all)
drop policy if exists feedback_select on public.feedback;
create policy feedback_select on public.feedback
  for select using (
    public.is_owner() or exists (
      select 1 from public.projects p
      where p.id = feedback.project_id and p.client_id = auth.uid()
    )
  );

drop policy if exists feedback_insert on public.feedback;
create policy feedback_insert on public.feedback
  for insert with check (
    author_id = auth.uid() and (
      public.is_owner() or exists (
        select 1 from public.projects p
        where p.id = feedback.project_id and p.client_id = auth.uid()
      )
    )
  );

drop policy if exists feedback_update on public.feedback;
create policy feedback_update on public.feedback
  for update using ( public.is_owner() ) with check ( public.is_owner() );

drop policy if exists feedback_delete on public.feedback;
create policy feedback_delete on public.feedback
  for delete using ( public.is_owner() );

-- ---- TICKETS ----  (client can read + create own; owner all)
drop policy if exists tickets_select on public.tickets;
create policy tickets_select on public.tickets
  for select using ( client_id = auth.uid() or public.is_owner() );

drop policy if exists tickets_insert on public.tickets;
create policy tickets_insert on public.tickets
  for insert with check ( client_id = auth.uid() or public.is_owner() );

drop policy if exists tickets_update on public.tickets;
create policy tickets_update on public.tickets
  for update using ( public.is_owner() ) with check ( public.is_owner() );

drop policy if exists tickets_delete on public.tickets;
create policy tickets_delete on public.tickets
  for delete using ( public.is_owner() );

-- ---- INVOICES ----  (client reads own; owner manages)
drop policy if exists invoices_select on public.invoices;
create policy invoices_select on public.invoices
  for select using ( client_id = auth.uid() or public.is_owner() );

drop policy if exists invoices_write on public.invoices;
create policy invoices_write on public.invoices
  for all using ( public.is_owner() ) with check ( public.is_owner() );

-- ---- CONTRACTS ----  (client reads own; owner manages)
drop policy if exists contracts_select on public.contracts;
create policy contracts_select on public.contracts
  for select using ( client_id = auth.uid() or public.is_owner() );

drop policy if exists contracts_write on public.contracts;
create policy contracts_write on public.contracts
  for all using ( public.is_owner() ) with check ( public.is_owner() );

-- ============================================================================
-- SEED THE OWNER PROFILE
-- Run this AFTER you have created the owner auth user (see SETUP.md step 3):
--   email:    owner@becksystems.studio
--   password: Manuel   (change it after first login)
-- This promotes that auth user to the owner role.
-- ============================================================================
insert into public.profiles (id, role, full_name, email)
select id, 'owner', 'Beck Systems', email
from auth.users
where lower(email) = 'owner@becksystems.studio'
on conflict (id) do update set role = 'owner', full_name = 'Beck Systems';
