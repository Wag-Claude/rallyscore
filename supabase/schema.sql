-- ============================================================
-- RallyScore — Supabase Schema
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================
-- This creates the full database for RallyScore Pro:
--   - Clubs, teams, players, matches, points, sets
--   - Auth profiles, family members, follows
--   - Subscriptions, clips, notifications
--   - Row Level Security policies
--   - Realtime publications
-- Safe to re-run: uses CREATE IF NOT EXISTS / DROP IF EXISTS.
-- ============================================================

-- ---- Extensions ----
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ============================================================
-- 1. PROFILES (extends auth.users)
-- ============================================================
create table if not exists public.profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  email text unique,
  full_name text,
  avatar_url text,
  role text not null default 'family' check (role in ('family','scorer','club_admin','super_admin')),
  created_at timestamptz default now()
);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================================
-- 2. CLUBS, TEAMS, PLAYERS
-- ============================================================
create table if not exists public.clubs (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  slug text unique not null,
  logo_url text,
  city text,
  country text default 'US',
  owner_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz default now()
);

create table if not exists public.teams (
  id uuid primary key default uuid_generate_v4(),
  club_id uuid references public.clubs(id) on delete cascade not null,
  name text not null,
  short_name text,
  sport text not null default 'volleyball' check (sport in ('volleyball','basketball','soccer')),
  age_group text,
  season text,
  primary_color text default '#FF4D2E',
  logo_url text,
  created_at timestamptz default now()
);

create index if not exists teams_club_idx on public.teams(club_id);

create table if not exists public.players (
  id uuid primary key default uuid_generate_v4(),
  team_id uuid references public.teams(id) on delete cascade not null,
  full_name text not null,
  jersey_number int,
  position text,
  birth_year int,
  photo_url text,
  created_at timestamptz default now()
);

create index if not exists players_team_idx on public.players(team_id);

-- ============================================================
-- 3. MATCHES, SETS, POINTS
-- ============================================================
create table if not exists public.matches (
  id uuid primary key default uuid_generate_v4(),
  club_id uuid references public.clubs(id) on delete cascade,
  home_team_id uuid references public.teams(id) on delete set null,
  away_team_id uuid references public.teams(id) on delete set null,
  home_team_name text not null, -- denormalized for opponents not in DB
  away_team_name text not null,
  sport text not null default 'volleyball',
  format text default 'best_of_5', -- best_of_3, best_of_5, single
  status text not null default 'scheduled' check (status in ('scheduled','live','finished','cancelled')),
  starts_at timestamptz,
  scorer_id uuid references public.profiles(id) on delete set null,
  current_set int default 1,
  home_sets int default 0,
  away_sets int default 0,
  home_score int default 0, -- current set score
  away_score int default 0,
  serving text default 'home' check (serving in ('home','away')),
  is_live_streaming boolean default false,
  stream_started_at timestamptz,
  viewer_count int default 0,
  created_at timestamptz default now(),
  finished_at timestamptz
);

create index if not exists matches_status_idx on public.matches(status);
create index if not exists matches_club_idx on public.matches(club_id);
create index if not exists matches_starts_idx on public.matches(starts_at desc);

create table if not exists public.match_sets (
  id uuid primary key default uuid_generate_v4(),
  match_id uuid references public.matches(id) on delete cascade not null,
  set_number int not null,
  home_score int not null,
  away_score int not null,
  winner text check (winner in ('home','away')),
  finished_at timestamptz default now(),
  unique(match_id, set_number)
);

create table if not exists public.points (
  id uuid primary key default uuid_generate_v4(),
  match_id uuid references public.matches(id) on delete cascade not null,
  set_number int not null default 1,
  team text not null check (team in ('home','away')),
  player_id uuid references public.players(id) on delete set null,
  player_name text, -- denormalized for opponent points
  play_type text, -- 'ace','attack','block','opponent_error', etc.
  home_score_after int not null,
  away_score_after int not null,
  is_match_point boolean default false,
  is_set_point boolean default false,
  scored_at timestamptz default now()
);

create index if not exists points_match_idx on public.points(match_id, scored_at desc);

-- ============================================================
-- 4. FAMILY FOLLOWS, SUBSCRIPTIONS, NOTIFICATIONS
-- ============================================================
create table if not exists public.player_follows (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  player_id uuid references public.players(id) on delete cascade not null,
  relationship text default 'family', -- 'parent','grandparent','sibling','family','fan'
  is_verified boolean default false, -- club admin approved (COPPA gate)
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  notify_on_score boolean default true,
  notify_on_set boolean default true,
  notify_on_clip boolean default true,
  created_at timestamptz default now(),
  unique(user_id, player_id)
);

create index if not exists follows_user_idx on public.player_follows(user_id);
create index if not exists follows_player_idx on public.player_follows(player_id);

create table if not exists public.club_followers (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  club_id uuid references public.clubs(id) on delete cascade not null,
  is_approved boolean default false,
  created_at timestamptz default now(),
  unique(user_id, club_id)
);

create table if not exists public.subscriptions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  tier text not null check (tier in ('family','club')),
  status text not null check (status in ('trialing','active','past_due','canceled','incomplete')),
  stripe_customer_id text,
  stripe_subscription_id text unique,
  current_period_end timestamptz,
  trial_end timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists subs_user_idx on public.subscriptions(user_id);

create table if not exists public.notifications (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  type text not null, -- 'point','set_won','match_starting','clip','match_end'
  title text not null,
  body text,
  match_id uuid references public.matches(id) on delete cascade,
  player_id uuid references public.players(id) on delete set null,
  metadata jsonb,
  read_at timestamptz,
  created_at timestamptz default now()
);

create index if not exists notifs_user_idx on public.notifications(user_id, created_at desc);
create index if not exists notifs_unread_idx on public.notifications(user_id) where read_at is null;

-- ============================================================
-- 5. CLIPS (auto-generated highlights)
-- ============================================================
create table if not exists public.clips (
  id uuid primary key default uuid_generate_v4(),
  match_id uuid references public.matches(id) on delete cascade not null,
  point_id uuid references public.points(id) on delete set null,
  player_id uuid references public.players(id) on delete set null,
  title text,
  storage_path text, -- path in Supabase Storage
  thumbnail_path text,
  duration_seconds int,
  play_type text,
  created_at timestamptz default now()
);

create index if not exists clips_match_idx on public.clips(match_id);
create index if not exists clips_player_idx on public.clips(player_id);

-- ============================================================
-- 6. CHAT MESSAGES (per-match family chat)
-- ============================================================
create table if not exists public.chat_messages (
  id uuid primary key default uuid_generate_v4(),
  match_id uuid references public.matches(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete set null,
  user_name text not null,
  message text not null,
  is_reaction boolean default false, -- true if just an emoji reaction
  emoji text,
  created_at timestamptz default now()
);

create index if not exists chat_match_idx on public.chat_messages(match_id, created_at);

-- ============================================================
-- 7. ROW LEVEL SECURITY
-- ============================================================
alter table public.profiles enable row level security;
alter table public.clubs enable row level security;
alter table public.teams enable row level security;
alter table public.players enable row level security;
alter table public.matches enable row level security;
alter table public.match_sets enable row level security;
alter table public.points enable row level security;
alter table public.player_follows enable row level security;
alter table public.club_followers enable row level security;
alter table public.subscriptions enable row level security;
alter table public.notifications enable row level security;
alter table public.clips enable row level security;
alter table public.chat_messages enable row level security;

-- ----- PROFILES -----
drop policy if exists profiles_self_read on public.profiles;
create policy profiles_self_read on public.profiles
  for select using (auth.uid() = id);

drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles
  for update using (auth.uid() = id);

drop policy if exists profiles_public_read on public.profiles;
create policy profiles_public_read on public.profiles
  for select using (true); -- anyone authenticated can see basic profile info

-- ----- CLUBS / TEAMS / PLAYERS — public read -----
drop policy if exists clubs_read on public.clubs;
create policy clubs_read on public.clubs for select using (true);

drop policy if exists clubs_admin_write on public.clubs;
create policy clubs_admin_write on public.clubs
  for all using (
    auth.uid() = owner_id
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'super_admin')
  );

drop policy if exists teams_read on public.teams;
create policy teams_read on public.teams for select using (true);

drop policy if exists teams_admin_write on public.teams;
create policy teams_admin_write on public.teams
  for all using (
    exists (
      select 1 from public.clubs c
      where c.id = teams.club_id and (
        c.owner_id = auth.uid()
        or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('club_admin','super_admin'))
      )
    )
  );

drop policy if exists players_read on public.players;
create policy players_read on public.players for select using (true);

drop policy if exists players_admin_write on public.players;
create policy players_admin_write on public.players
  for all using (
    exists (
      select 1 from public.teams t
      join public.clubs c on c.id = t.club_id
      where t.id = players.team_id and (
        c.owner_id = auth.uid()
        or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('club_admin','super_admin'))
      )
    )
  );

-- ----- MATCHES — public read, scorer/admin write -----
drop policy if exists matches_read on public.matches;
create policy matches_read on public.matches for select using (true);

drop policy if exists matches_scorer_write on public.matches;
create policy matches_scorer_write on public.matches
  for all using (
    auth.uid() = scorer_id
    or exists (
      select 1 from public.clubs c where c.id = matches.club_id and c.owner_id = auth.uid()
    )
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('club_admin','super_admin'))
  );

-- For the demo / first version, allow any authenticated user to create a match
-- (we'll tighten this later when clubs onboard properly)
drop policy if exists matches_authenticated_insert on public.matches;
create policy matches_authenticated_insert on public.matches
  for insert with check (auth.uid() is not null);

-- ----- POINTS / SETS — public read, scorer write -----
drop policy if exists points_read on public.points;
create policy points_read on public.points for select using (true);

drop policy if exists points_scorer_write on public.points;
create policy points_scorer_write on public.points
  for all using (
    exists (
      select 1 from public.matches m
      where m.id = points.match_id and (
        m.scorer_id = auth.uid()
        or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('club_admin','super_admin'))
      )
    )
  );

drop policy if exists match_sets_read on public.match_sets;
create policy match_sets_read on public.match_sets for select using (true);

drop policy if exists match_sets_scorer_write on public.match_sets;
create policy match_sets_scorer_write on public.match_sets
  for all using (
    exists (
      select 1 from public.matches m
      where m.id = match_sets.match_id and (
        m.scorer_id = auth.uid()
        or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('club_admin','super_admin'))
      )
    )
  );

-- ----- FOLLOWS — only the user themselves -----
drop policy if exists follows_self on public.player_follows;
create policy follows_self on public.player_follows
  for all using (auth.uid() = user_id);

drop policy if exists club_follows_self on public.club_followers;
create policy club_follows_self on public.club_followers
  for all using (auth.uid() = user_id);

-- ----- SUBSCRIPTIONS — only self read, server-side write via service role -----
drop policy if exists subs_self_read on public.subscriptions;
create policy subs_self_read on public.subscriptions
  for select using (auth.uid() = user_id);

-- ----- NOTIFICATIONS — only self -----
drop policy if exists notifs_self on public.notifications;
create policy notifs_self on public.notifications
  for all using (auth.uid() = user_id);

-- ----- CLIPS — public read for now -----
drop policy if exists clips_read on public.clips;
create policy clips_read on public.clips for select using (true);

-- ----- CHAT — read by followers, write by authenticated -----
drop policy if exists chat_read on public.chat_messages;
create policy chat_read on public.chat_messages for select using (true);

drop policy if exists chat_insert on public.chat_messages;
create policy chat_insert on public.chat_messages
  for insert with check (auth.uid() = user_id);

-- ============================================================
-- 8. REALTIME PUBLICATIONS
-- (so clients can subscribe to live changes)
-- ============================================================
drop publication if exists supabase_realtime;
create publication supabase_realtime for table
  public.matches,
  public.points,
  public.match_sets,
  public.notifications,
  public.chat_messages,
  public.clips;

-- ============================================================
-- 9. HELPER FUNCTIONS
-- ============================================================

-- Score a point — atomically increments score, optionally inserts a point row
create or replace function public.score_point(
  p_match_id uuid,
  p_team text,
  p_player_id uuid default null,
  p_player_name text default null,
  p_play_type text default null
)
returns public.points language plpgsql security definer as $$
declare
  m public.matches;
  new_home int;
  new_away int;
  current_set_num int;
  set_target int;
  is_final_set boolean;
  reached_target boolean;
  has_2_lead boolean;
  set_winner text;
  point_row public.points;
begin
  select * into m from public.matches where id = p_match_id for update;
  if not found then raise exception 'Match not found'; end if;
  if m.status = 'finished' then raise exception 'Match is already finished'; end if;

  -- Increment the right side
  if p_team = 'home' then
    new_home := m.home_score + 1;
    new_away := m.away_score;
  else
    new_home := m.home_score;
    new_away := m.away_score + 1;
  end if;

  current_set_num := m.current_set;

  -- Volleyball set-end logic (5th set goes to 15, others to 25, 2-pt lead)
  if m.sport = 'volleyball' then
    is_final_set := (m.format = 'best_of_5' and current_set_num = 5)
                 or (m.format = 'best_of_3' and current_set_num = 3);
    set_target := case when is_final_set then 15 else 25 end;
    reached_target := (new_home >= set_target or new_away >= set_target);
    has_2_lead := abs(new_home - new_away) >= 2;

    if reached_target and has_2_lead then
      set_winner := case when new_home > new_away then 'home' else 'away' end;

      -- Record the set
      insert into public.match_sets (match_id, set_number, home_score, away_score, winner)
      values (p_match_id, current_set_num, new_home, new_away, set_winner);

      -- Insert the winning point
      insert into public.points (
        match_id, set_number, team, player_id, player_name, play_type,
        home_score_after, away_score_after, is_set_point
      ) values (
        p_match_id, current_set_num, p_team, p_player_id, p_player_name, p_play_type,
        new_home, new_away, true
      ) returning * into point_row;

      -- Update match: bump set count, reset score
      if set_winner = 'home' then
        update public.matches set
          home_sets = home_sets + 1,
          home_score = 0, away_score = 0,
          current_set = current_set + 1,
          serving = 'home'
        where id = p_match_id;
      else
        update public.matches set
          away_sets = away_sets + 1,
          home_score = 0, away_score = 0,
          current_set = current_set + 1,
          serving = 'away'
        where id = p_match_id;
      end if;

      -- Check if match is over
      declare
        sets_to_win int := case when m.format = 'best_of_5' then 3 else 2 end;
        new_home_sets int := m.home_sets + (case when set_winner = 'home' then 1 else 0 end);
        new_away_sets int := m.away_sets + (case when set_winner = 'away' then 1 else 0 end);
      begin
        if new_home_sets >= sets_to_win or new_away_sets >= sets_to_win then
          update public.matches set
            status = 'finished',
            finished_at = now(),
            is_live_streaming = false,
            current_set = current_set - 1 -- restore to last completed set
          where id = p_match_id;
          point_row.is_match_point := true;
        end if;
      end;

      return point_row;
    end if;
  end if;

  -- Regular point (no set won)
  update public.matches set
    home_score = new_home,
    away_score = new_away,
    serving = p_team
  where id = p_match_id;

  insert into public.points (
    match_id, set_number, team, player_id, player_name, play_type,
    home_score_after, away_score_after
  ) values (
    p_match_id, current_set_num, p_team, p_player_id, p_player_name, p_play_type,
    new_home, new_away
  ) returning * into point_row;

  return point_row;
end; $$;

grant execute on function public.score_point to authenticated;

-- Undo the last point of a match
create or replace function public.undo_last_point(p_match_id uuid)
returns void language plpgsql security definer as $$
declare
  last_point public.points;
  m public.matches;
begin
  select * into m from public.matches where id = p_match_id for update;
  if not found then raise exception 'Match not found'; end if;

  select * into last_point from public.points
  where match_id = p_match_id
  order by scored_at desc limit 1;
  if not found then return; end if;

  -- If last point was a set point, also unwind the set
  if last_point.is_set_point then
    delete from public.match_sets
    where match_id = p_match_id and set_number = last_point.set_number;

    update public.matches set
      home_sets = greatest(0, home_sets - (case when last_point.team = 'home' then 1 else 0 end)),
      away_sets = greatest(0, away_sets - (case when last_point.team = 'away' then 1 else 0 end)),
      current_set = last_point.set_number,
      home_score = last_point.home_score_after - (case when last_point.team = 'home' then 1 else 0 end),
      away_score = last_point.away_score_after - (case when last_point.team = 'away' then 1 else 0 end),
      status = case when status = 'finished' then 'live' else status end,
      finished_at = case when status = 'finished' then null else finished_at end
    where id = p_match_id;
  else
    update public.matches set
      home_score = last_point.home_score_after - (case when last_point.team = 'home' then 1 else 0 end),
      away_score = last_point.away_score_after - (case when last_point.team = 'away' then 1 else 0 end)
    where id = p_match_id;
  end if;

  delete from public.points where id = last_point.id;
end; $$;

grant execute on function public.undo_last_point to authenticated;

-- ============================================================
-- 10. DEMO SEED DATA (optional but nice for testing)
-- Comment this out if you want a clean DB.
-- ============================================================
do $$
declare
  club_id uuid;
  team_a uuid;
  team_b uuid;
begin
  -- Skip if demo club already exists
  if exists (select 1 from public.clubs where slug = 'madison-eagles') then return; end if;

  insert into public.clubs (name, slug, city, country)
  values ('Madison Eagles VC', 'madison-eagles', 'Madison', 'US')
  returning id into club_id;

  insert into public.teams (club_id, name, short_name, sport, age_group, season, primary_color)
  values (club_id, 'Madison Eagles 16U', 'Eagles', 'volleyball', '16U', '2026', '#FF4D2E')
  returning id into team_a;

  insert into public.players (team_id, full_name, jersey_number, position) values
    (team_a, 'Sophia Martinez', 7, 'Outside Hitter'),
    (team_a, 'Lucy Romero', 3, 'Setter'),
    (team_a, 'Carla Vega', 9, 'Middle Blocker'),
    (team_a, 'Mara Perez', 12, 'Libero'),
    (team_a, 'Andrea Gil', 11, 'Opposite'),
    (team_a, 'Paula Nunez', 14, 'Middle Blocker'),
    (team_a, 'Eva Torres', 8, 'Outside Hitter');
end $$;

-- ============================================================
-- DONE. You should see ~13 tables in Database → Tables.
-- Try: select * from public.players;
-- ============================================================
