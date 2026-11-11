-- ============================================================================
-- ForgeVyn.com — full database setup
-- Paste this entire file into the Supabase SQL Editor and click "Run".
-- Safe to run on a fresh project, and safe to run twice.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. PROFILES  (one row per auth user)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  username    text not null,
  tier        text not null default 'free'
              check (tier in ('free', 'tier100', 'tier500', 'tier1000')),
  game_count  integer not null default 0 check (game_count >= 0),
  balance     numeric(12,2) not null default 0 check (balance >= 0),
  created_at  timestamptz not null default now(),
  constraint profiles_username_format
    check (username ~ '^[A-Za-z0-9_]{3,30}$')
);

-- usernames are unique regardless of capitalisation ("Alice" = "alice")
create unique index if not exists profiles_username_unique
  on public.profiles (lower(username));


-- ---------------------------------------------------------------------------
-- 2. GAMES
-- ---------------------------------------------------------------------------
create table if not exists public.games (
  id            uuid primary key default gen_random_uuid(),
  creator_id    uuid not null references public.profiles (id) on delete cascade,
  title         text not null
                check (char_length(trim(title)) between 1 and 120),
  description   text not null default '',
  hashtags      text[] not null default '{}',      -- e.g. '{puzzle,2d,arcade}' (no '#' symbol)
  thumbnail_url text,
  game_code     text not null default '',           -- the game's HTML/JS bundle
  aspect_ratio  text not null default '16:9'
                check (aspect_ratio in ('16:9', '9:16')),
  ad_mode       text not null default 'normal'
                check (ad_mode in ('normal', 'custom')),
  is_published  boolean not null default true,      -- true = visible to everyone, false = hidden draft
  likes_count   integer not null default 0 check (likes_count >= 0),
  saves_count   integer not null default 0 check (saves_count >= 0),
  created_at    timestamptz not null default now()
);


-- ---------------------------------------------------------------------------
-- 3. AD IMPRESSIONS  (revenue log, one row per ad view)
-- ---------------------------------------------------------------------------
create table if not exists public.ad_impressions (
  id            uuid primary key default gen_random_uuid(),
  game_id       uuid not null references public.games (id) on delete cascade,
  creator_id    uuid not null references public.profiles (id) on delete cascade,
  region_tier   text not null check (region_tier in ('Tier 1', 'Tier 3')),
  cpm_rate      numeric(10,4) not null default 0 check (cpm_rate >= 0),   -- USD per 1000 views
  creator_share numeric(12,4) not null default 0 check (creator_share >= 0), -- creator's cut in USD
  created_at    timestamptz not null default now()
);


-- ---------------------------------------------------------------------------
-- 4. PAYOUTS
-- ---------------------------------------------------------------------------
create table if not exists public.payouts (
  id         uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.profiles (id) on delete cascade,
  amount     numeric(12,2) not null check (amount > 0),
  status     text not null default 'pending'
             check (status in ('pending', 'approved', 'paid')),
  created_at timestamptz not null default now()
);


-- ---------------------------------------------------------------------------
-- 5. INDEXES (make the app's queries fast)
-- ---------------------------------------------------------------------------
create index if not exists games_creator_idx
  on public.games (creator_id, created_at desc);

create index if not exists games_published_idx
  on public.games (created_at desc) where is_published;

create index if not exists games_hashtags_idx
  on public.games using gin (hashtags);

create index if not exists ad_impressions_creator_idx
  on public.ad_impressions (creator_id, created_at desc);

create index if not exists ad_impressions_game_idx
  on public.ad_impressions (game_id);

create index if not exists payouts_creator_idx
  on public.payouts (creator_id, created_at desc);


-- ---------------------------------------------------------------------------
-- 6. AUTOMATION
-- ---------------------------------------------------------------------------

-- 6a. When someone signs up, create their profile row automatically.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  base_username text;
begin
  base_username := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'username'), ''),
    'player_' || left(replace(new.id::text, '-', ''), 8)
  );

  -- keep only letters, numbers and underscores, and stay inside the 3-30 char rule
  base_username := regexp_replace(base_username, '[^A-Za-z0-9_]', '', 'g');
  if char_length(base_username) < 3 then
    base_username := 'player_' || left(replace(new.id::text, '-', ''), 8);
  end if;
  base_username := left(base_username, 24);

  begin
    insert into public.profiles (id, username) values (new.id, base_username);
  exception when unique_violation then
    -- username is taken: add a short piece of the user's id
    insert into public.profiles (id, username)
    values (
      new.id,
      left(base_username, 20) || '_' || left(replace(new.id::text, '-', ''), 6)
    );
  end;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- 6b. Keep profiles.game_count in sync with the games table.
create or replace function public.sync_game_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('forgevyn.internal', 'on', true);

  if tg_op = 'INSERT' then
    update public.profiles
       set game_count = game_count + 1
     where id = new.creator_id;
  elsif tg_op = 'DELETE' then
    update public.profiles
       set game_count = greatest(game_count - 1, 0)
     where id = old.creator_id;
  end if;

  perform set_config('forgevyn.internal', 'off', true);
  return null;
end;
$$;

drop trigger if exists games_sync_game_count on public.games;
create trigger games_sync_game_count
  after insert or delete on public.games
  for each row execute function public.sync_game_count();


-- 6c. Users may only edit their own username. tier, balance and game_count
--     are money/admin fields and can only be changed from the dashboard,
--     the SQL editor or a service-role server action.
create or replace function public.protect_profile_fields()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(current_setting('forgevyn.internal', true), '') = 'on'
     or coalesce(current_setting('request.jwt.claim.role', true), '')
        not in ('anon', 'authenticated') then
    return new;
  end if;

  new.tier       := old.tier;
  new.balance    := old.balance;
  new.game_count := old.game_count;
  return new;
end;
$$;

drop trigger if exists profiles_protect_fields on public.profiles;
create trigger profiles_protect_fields
  before update on public.profiles
  for each row execute function public.protect_profile_fields();


-- ---------------------------------------------------------------------------
-- 7. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------------
alter table public.profiles       enable row level security;
alter table public.games          enable row level security;
alter table public.ad_impressions enable row level security;
alter table public.payouts        enable row level security;

-- PROFILES ---------------------------------------------------------------
drop policy if exists "profiles_public_read"    on public.profiles;
drop policy if exists "profiles_insert_own"     on public.profiles;
drop policy if exists "profiles_update_own"     on public.profiles;

create policy "profiles_public_read"
  on public.profiles for select
  to anon, authenticated
  using (true);

create policy "profiles_insert_own"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id);

create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- GAMES ------------------------------------------------------------------
drop policy if exists "games_public_read_published" on public.games;
drop policy if exists "games_creator_read_own"      on public.games;
drop policy if exists "games_insert_own"            on public.games;
drop policy if exists "games_update_own"            on public.games;
drop policy if exists "games_delete_own"            on public.games;

-- anyone (even logged out) can view published games
create policy "games_public_read_published"
  on public.games for select
  to anon, authenticated
  using (is_published);

-- creators can also see their own unpublished drafts
create policy "games_creator_read_own"
  on public.games for select
  to authenticated
  using (auth.uid() = creator_id);

create policy "games_insert_own"
  on public.games for insert
  to authenticated
  with check (auth.uid() = creator_id);

create policy "games_update_own"
  on public.games for update
  to authenticated
  using (auth.uid() = creator_id)
  with check (auth.uid() = creator_id);

create policy "games_delete_own"
  on public.games for delete
  to authenticated
  using (auth.uid() = creator_id);

-- AD IMPRESSIONS ---------------------------------------------------------
drop policy if exists "impressions_creator_read_own"   on public.ad_impressions;
drop policy if exists "impressions_creator_insert_own" on public.ad_impressions;

-- earnings data is private: only the creator can read their own impressions
create policy "impressions_creator_read_own"
  on public.ad_impressions for select
  to authenticated
  using (creator_id = auth.uid());

create policy "impressions_creator_insert_own"
  on public.ad_impressions for insert
  to authenticated
  with check (
    creator_id = auth.uid()
    and exists (
      select 1 from public.games g
      where g.id = ad_impressions.game_id
        and g.creator_id = auth.uid()
    )
  );

-- PAYOUTS ----------------------------------------------------------------
drop policy if exists "payouts_creator_read_own" on public.payouts;

-- creators can see their payouts but never create or approve them;
-- you (admin) insert them from the SQL editor or with the service-role key
create policy "payouts_creator_read_own"
  on public.payouts for select
  to authenticated
  using (creator_id = auth.uid());


-- ---------------------------------------------------------------------------
-- 8. PERMISSIONS
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;

grant select          on public.profiles       to anon, authenticated;
grant insert, update  on public.profiles       to authenticated;

grant select          on public.games          to anon, authenticated;
grant insert, update, delete on public.games   to authenticated;

grant select, insert  on public.ad_impressions to authenticated;
grant select          on public.payouts        to authenticated;


-- ---------------------------------------------------------------------------
-- Done. Sanity check (optional, run on its own):
-- select tablename, policyname, cmd from pg_policies
--  where schemaname = 'public' order by tablename, policyname;
-- ---------------------------------------------------------------------------
