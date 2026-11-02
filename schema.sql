-- Atelier Projets V3 — preuve de synchronisation, schema v0.1
-- A executer UNE FOIS dans Supabase > SQL Editor, sur un projet de test vide.
-- Deux tables seulement pour ce jalon : projets et notes.

create extension if not exists pgcrypto;

create table if not exists public.ap_projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  objective text not null default '',
  status text not null default 'idea' check (status in ('idea','planned','active','paused','completed','abandoned')),
  interest smallint not null default 3 check (interest between 1 and 5),
  importance smallint not null default 3 check (importance between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id)
);

create table if not exists public.ap_notes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  owner_id uuid not null default auth.uid(),
  content text not null check (char_length(btrim(content)) between 1 and 12000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notes_project_owned foreign key (project_id, owner_id)
    references public.ap_projects(id, owner_id) on delete cascade
);

create index if not exists ap_projects_owner_status_idx on public.ap_projects(owner_id,status);
create index if not exists ap_notes_project_created_idx on public.ap_notes(project_id,created_at desc);

create or replace function public.ap_touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end; $$;

drop trigger if exists trg_ap_projects_touch on public.ap_projects;
create trigger trg_ap_projects_touch before update on public.ap_projects
for each row execute function public.ap_touch_updated_at();

drop trigger if exists trg_ap_notes_touch on public.ap_notes;
create trigger trg_ap_notes_touch before update on public.ap_notes
for each row execute function public.ap_touch_updated_at();

-- Limite de 5 projets actifs, appliquee aussi cote serveur pour eviter les contournements.
-- Le verrou transactionnel par utilisateur evite deux activations concurrentes > 5.
create or replace function public.ap_enforce_active_limit()
returns trigger language plpgsql set search_path = '' as $$
declare active_count integer;
begin
  if new.status = 'active' then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.owner_id::text, 67892));
    select count(*) into active_count from public.ap_projects
    where owner_id = new.owner_id and status = 'active' and id <> new.id;
    if active_count >= 5 then
      raise exception 'Maximum de 5 projets en cours atteint';
    end if;
  end if;
  return new;
end; $$;

drop trigger if exists trg_ap_active_limit on public.ap_projects;
create trigger trg_ap_active_limit before insert or update on public.ap_projects
for each row execute function public.ap_enforce_active_limit();

alter table public.ap_projects enable row level security;
alter table public.ap_notes enable row level security;

-- Le role anon n'a aucun droit aux donnees.
revoke all on public.ap_projects from anon, authenticated;
revoke all on public.ap_notes from anon, authenticated;
grant select,insert,update,delete on public.ap_projects to authenticated;
grant select,insert,update,delete on public.ap_notes to authenticated;

-- Les politiques imposent la correspondance entre l'utilisateur connecte et le proprietaire.
drop policy if exists ap_projects_select on public.ap_projects;
drop policy if exists ap_projects_insert on public.ap_projects;
drop policy if exists ap_projects_update on public.ap_projects;
drop policy if exists ap_projects_delete on public.ap_projects;
create policy ap_projects_select on public.ap_projects for select to authenticated
  using ((select auth.uid()) = owner_id);
create policy ap_projects_insert on public.ap_projects for insert to authenticated
  with check ((select auth.uid()) = owner_id);
create policy ap_projects_update on public.ap_projects for update to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy ap_projects_delete on public.ap_projects for delete to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists ap_notes_select on public.ap_notes;
drop policy if exists ap_notes_insert on public.ap_notes;
drop policy if exists ap_notes_update on public.ap_notes;
drop policy if exists ap_notes_delete on public.ap_notes;
create policy ap_notes_select on public.ap_notes for select to authenticated
  using ((select auth.uid()) = owner_id);
create policy ap_notes_insert on public.ap_notes for insert to authenticated
  with check ((select auth.uid()) = owner_id);
create policy ap_notes_update on public.ap_notes for update to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy ap_notes_delete on public.ap_notes for delete to authenticated
  using ((select auth.uid()) = owner_id);

-- Important : ce jalon ne cree AUCUN bucket Storage et ne migre pas la V2.
-- Ne jamais exposer une cle sb_secret_... ou service_role dans les fichiers publics.
