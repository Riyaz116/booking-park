const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '..', 'data.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  phone         TEXT,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin'))
);

CREATE TABLE IF NOT EXISTS attractions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  description TEXT,
  category    TEXT NOT NULL,
  image       TEXT
);

CREATE TABLE IF NOT EXISTS slots (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  attraction_id INTEGER NOT NULL REFERENCES attractions(id) ON DELETE CASCADE,
  starts_at     TEXT NOT NULL,           -- ISO: 2026-11-05T10:00
  capacity      INTEGER NOT NULL CHECK (capacity > 0)
);

CREATE TABLE IF NOT EXISTS ticket_types (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  name    TEXT NOT NULL,
  min_age INTEGER NOT NULL,
  max_age INTEGER,
  price   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bookings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  slot_id     INTEGER NOT NULL REFERENCES slots(id),
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','confirmed','cancelled')),
  total_price INTEGER NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS booking_items (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id     INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  ticket_type_id INTEGER NOT NULL REFERENCES ticket_types(id),
  quantity       INTEGER NOT NULL CHECK (quantity > 0),
  unit_price     INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_slots_attraction ON slots(attraction_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings(user_id);
CREATE INDEX IF NOT EXISTS idx_bookings_slot ON bookings(slot_id);
`);

module.exports = db;
