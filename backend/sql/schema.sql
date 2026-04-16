create table if not exists users (
  id text primary key,
  display_name text not null,
  is_guest boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists sessions (
  id text primary key,
  user_id text not null references users(id),
  access_token_hash text not null unique,
  reconnect_token_hash text not null unique,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists games (
  id text primary key,
  status text not null,
  ruleset text not null,
  version integer not null,
  winner_seat_id text,
  created_at timestamptz not null,
  started_at timestamptz,
  finished_at timestamptz
);

create table if not exists game_seats (
  game_id text not null references games(id) on delete cascade,
  seat_id text not null,
  user_id text references users(id),
  display_name text not null,
  color text not null,
  joined_at timestamptz,
  primary key (game_id, seat_id)
);

create table if not exists game_events (
  game_id text not null references games(id) on delete cascade,
  version integer not null,
  event_id text not null,
  event_type text not null,
  actor_user_id text,
  actor_seat_id text,
  payload_json jsonb not null,
  created_at timestamptz not null default now(),
  primary key (game_id, version),
  unique (game_id, event_id)
);

create index if not exists game_events_game_id_version_idx
on game_events (game_id, version);

create table if not exists game_snapshots (
  game_id text not null references games(id) on delete cascade,
  version integer not null,
  snapshot_json jsonb not null,
  created_at timestamptz not null default now(),
  primary key (game_id, version)
);

create index if not exists game_snapshots_game_id_version_idx
on game_snapshots (game_id, version desc);

create table if not exists processed_commands (
  game_id text not null references games(id) on delete cascade,
  command_id text not null,
  result_json jsonb not null,
  created_at timestamptz not null default now(),
  primary key (game_id, command_id)
);
