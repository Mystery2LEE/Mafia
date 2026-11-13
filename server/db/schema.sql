CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  nickname      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  rating        INTEGER NOT NULL DEFAULT 1000,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS matches (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  room_title   TEXT NOT NULL,
  winner_team  TEXT NOT NULL,
  played_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS match_players (
  match_id       INTEGER NOT NULL REFERENCES matches(id),
  user_id        INTEGER NOT NULL REFERENCES users(id),
  role           TEXT NOT NULL,
  team           TEXT NOT NULL,
  survived       INTEGER NOT NULL,
  result         TEXT NOT NULL,
  rating_delta   INTEGER NOT NULL DEFAULT 0,
  left_early     INTEGER NOT NULL DEFAULT 0,
  rating_counted INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (match_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_users_rating ON users(rating DESC);
CREATE INDEX IF NOT EXISTS idx_match_players_user ON match_players(user_id);
