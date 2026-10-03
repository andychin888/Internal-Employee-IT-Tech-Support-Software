const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');
const path = require('node:path');

const db = new DatabaseSync(path.join(__dirname, 'helpdesk.db'));
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT UNIQUE NOT NULL COLLATE NOCASE,
  display_name  TEXT NOT NULL,
  email         TEXT,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('user', 'staff')),
  tier          INTEGER NOT NULL DEFAULT 0,   -- 0 = requester, 1..3 = support tier
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tickets (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT NOT NULL,
  description  TEXT NOT NULL,
  category     TEXT NOT NULL,
  priority     TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'closed')),
  tier         INTEGER NOT NULL DEFAULT 1,
  requester_id INTEGER NOT NULL REFERENCES users(id),
  assignee_id  INTEGER REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at    TEXT
);

-- kind: 'message' (visible to all), 'note' (staff-only), 'event' (system log line)
CREATE TABLE IF NOT EXISTS messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id  INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  user_id    INTEGER REFERENCES users(id),
  kind       TEXT NOT NULL CHECK (kind IN ('message', 'note', 'event')),
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS attachments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id     INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  message_id    INTEGER REFERENCES messages(id) ON DELETE CASCADE,
  uploader_id   INTEGER NOT NULL REFERENCES users(id),
  original_name TEXT NOT NULL,
  stored_name   TEXT NOT NULL,
  mime_type     TEXT NOT NULL,
  size          INTEGER NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_messages_ticket ON messages(ticket_id);
CREATE INDEX IF NOT EXISTS idx_attachments_ticket ON attachments(ticket_id);
CREATE INDEX IF NOT EXISTS idx_tickets_requester ON tickets(requester_id);
`);

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const candidate = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(candidate, Buffer.from(hash, 'hex'));
}

// Seed demo accounts on first run so the app is usable immediately.
const userCount = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
if (userCount === 0) {
  const insert = db.prepare(
    'INSERT INTO users (username, display_name, email, password_hash, role, tier) VALUES (?, ?, ?, ?, ?, ?)'
  );
  insert.run('alice', 'Alice Johnson', 'alice@example.com', hashPassword('password123'), 'user', 0);
  insert.run('tech1', 'Sam Rivera (Tier 1)', 'tech1@example.com', hashPassword('password123'), 'staff', 1);
  insert.run('tech2', 'Jordan Lee (Tier 2)', 'tech2@example.com', hashPassword('password123'), 'staff', 2);
  insert.run('manager', 'Morgan Chen (IT Manager)', 'manager@example.com', hashPassword('password123'), 'staff', 3);
}

module.exports = { db, hashPassword, verifyPassword };
