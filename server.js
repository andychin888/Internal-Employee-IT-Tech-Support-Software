const express = require('express');
const multer = require('multer');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { db, hashPassword, verifyPassword } = require('./db');

const PORT = process.env.PORT || 3000;
const SESSION_DAYS = 7;
const MAX_TIER = 3;
const CATEGORIES = ['Hardware', 'Software', 'Network', 'Account & Access', 'Email', 'Printer', 'Other'];
const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const INLINE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

const UPLOAD_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, _file, cb) => cb(null, crypto.randomUUID()),
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 5 },
});

const app = express();
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- helpers ----------

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function parseCookies(header = '') {
  return Object.fromEntries(
    header.split(';').map((c) => c.trim().split('=')).filter(([k]) => k).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))])
  );
}

function publicUser(u) {
  return u && { id: u.id, username: u.username, displayName: u.display_name, email: u.email, role: u.role, tier: u.tier };
}

function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expires.toISOString());
  res.cookie('sid', token, { httpOnly: true, sameSite: 'lax', expires });
}

function auth(req, _res, next) {
  const token = parseCookies(req.headers.cookie).sid;
  if (token) {
    const row = db
      .prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ?')
      .get(token, new Date().toISOString());
    if (row) req.user = row;
  }
  next();
}
app.use(auth);

const requireUser = (req, _res, next) => (req.user ? next() : next(new HttpError(401, 'Please log in.')));
const requireStaff = (req, _res, next) =>
  req.user?.role === 'staff' ? next() : next(new HttpError(403, 'IT staff only.'));

const isStaff = (u) => u.role === 'staff';

function loadTicket(id, user) {
  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(Number(id));
  if (!ticket) throw new HttpError(404, 'Ticket not found.');
  if (!isStaff(user) && ticket.requester_id !== user.id) throw new HttpError(404, 'Ticket not found.');
  return ticket;
}

function addMessage(ticketId, userId, kind, body) {
  const r = db.prepare('INSERT INTO messages (ticket_id, user_id, kind, body) VALUES (?, ?, ?, ?)').run(ticketId, userId, kind, body);
  return Number(r.lastInsertRowid);
}

function saveAttachments(files, ticketId, messageId, uploaderId) {
  const insert = db.prepare(
    `INSERT INTO attachments (ticket_id, message_id, uploader_id, original_name, stored_name, mime_type, size)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  for (const f of files || []) {
    insert.run(ticketId, messageId, uploaderId, f.originalname, f.filename, f.mimetype || 'application/octet-stream', f.size);
  }
}

function updateTicket(id, fields) {
  const keys = Object.keys(fields);
  const sets = [...keys.map((k) => `${k} = ?`), "updated_at = datetime('now')"].join(', ');
  db.prepare(`UPDATE tickets SET ${sets} WHERE id = ?`).run(...keys.map((k) => fields[k]), id);
}

function removeUploadedFiles(files) {
  for (const f of files || []) fs.rm(f.path, () => {});
}

// Wrap route handlers so thrown HttpErrors reach the error middleware; also clean up
// uploaded files if the request fails after Multer already wrote them to disk.
const route = (fn) => (req, res, next) => {
  try {
    fn(req, res, next);
  } catch (err) {
    removeUploadedFiles(req.files);
    next(err);
  }
};

// ---------- live updates (Server-Sent Events) ----------

const listeners = new Map(); // ticketId -> Set<res>

function notify(ticketId) {
  for (const res of listeners.get(ticketId) || []) res.write(`data: ${JSON.stringify({ type: 'refresh' })}\n\n`);
}

app.get('/api/tickets/:id/stream', requireUser, route((req, res) => {
  const ticket = loadTicket(req.params.id, req.user);
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  res.write(': connected\n\n');
  if (!listeners.has(ticket.id)) listeners.set(ticket.id, new Set());
  listeners.get(ticket.id).add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(ping);
    listeners.get(ticket.id)?.delete(res);
  });
}));

// ---------- auth ----------

app.post('/api/auth/register', route((req, res) => {
  const { username = '', displayName = '', email = '', password = '' } = req.body || {};
  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) throw new HttpError(400, 'Username must be 3-32 letters, numbers, or _ . -');
  if (!displayName.trim()) throw new HttpError(400, 'Please enter your name.');
  if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters.');
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw new HttpError(409, 'That username is taken.');
  // Self-registration only ever creates regular users; staff accounts are provisioned by admins.
  const r = db
    .prepare("INSERT INTO users (username, display_name, email, password_hash, role, tier) VALUES (?, ?, ?, ?, 'user', 0)")
    .run(username, displayName.trim(), email.trim(), hashPassword(password));
  createSession(res, Number(r.lastInsertRowid));
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid)) });
}));

app.post('/api/auth/login', route((req, res) => {
  const { username = '', password = '', role = 'user' } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !verifyPassword(password, user.password_hash)) throw new HttpError(401, 'Invalid username or password.');
  if (role === 'staff' && user.role !== 'staff') throw new HttpError(403, 'This account is not an IT staff account.');
  createSession(res, user.id);
  res.json({ user: publicUser(user) });
}));

app.post('/api/auth/logout', (req, res) => {
  const token = parseCookies(req.headers.cookie).sid;
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.clearCookie('sid');
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => res.json({ user: publicUser(req.user) || null }));

app.get('/api/meta', (_req, res) => res.json({ categories: CATEGORIES, priorities: PRIORITIES, maxTier: MAX_TIER }));

app.get('/api/staff', requireStaff, (_req, res) => {
  const rows = db.prepare("SELECT * FROM users WHERE role = 'staff' ORDER BY tier, display_name").all();
  res.json({ staff: rows.map(publicUser) });
});

// ---------- tickets ----------

const TICKET_SELECT = `
  SELECT t.*, r.display_name AS requester_name, a.display_name AS assignee_name,
         (SELECT COUNT(*) FROM messages m WHERE m.ticket_id = t.id AND m.kind = 'message') AS message_count
  FROM tickets t
  JOIN users r ON r.id = t.requester_id
  LEFT JOIN users a ON a.id = t.assignee_id`;

app.get('/api/tickets', requireUser, (req, res) => {
  const { status, scope, q } = req.query;
  const where = [];
  const params = [];
  if (!isStaff(req.user)) {
    where.push('t.requester_id = ?');
    params.push(req.user.id);
  } else if (scope === 'mine') {
    where.push('t.assignee_id = ?');
    params.push(req.user.id);
  } else if (scope === 'unassigned') {
    where.push("t.assignee_id IS NULL AND t.status != 'closed'");
  } else if (scope === 'escalated') {
    where.push('t.tier > 1');
  }
  if (status && status !== 'all') {
    if (status === 'active') where.push("t.status != 'closed'");
    else {
      where.push('t.status = ?');
      params.push(status);
    }
  }
  if (q) {
    where.push('(t.title LIKE ? OR t.description LIKE ? OR CAST(t.id AS TEXT) = ?)');
    params.push(`%${q}%`, `%${q}%`, String(q).replace(/^#/, ''));
  }
  const sql = `${TICKET_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY CASE t.status WHEN 'closed' THEN 1 ELSE 0 END,
             CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
             t.updated_at DESC`;
  res.json({ tickets: db.prepare(sql).all(...params) });
});

app.get('/api/stats', requireStaff, (req, res) => {
  const one = (sql, ...p) => db.prepare(sql).get(...p).n;
  res.json({
    open: one("SELECT COUNT(*) n FROM tickets WHERE status != 'closed'"),
    unassigned: one("SELECT COUNT(*) n FROM tickets WHERE status != 'closed' AND assignee_id IS NULL"),
    mine: one("SELECT COUNT(*) n FROM tickets WHERE status != 'closed' AND assignee_id = ?", req.user.id),
    escalated: one("SELECT COUNT(*) n FROM tickets WHERE status != 'closed' AND tier > 1"),
    closedToday: one("SELECT COUNT(*) n FROM tickets WHERE status = 'closed' AND date(closed_at) = date('now')"),
  });
});

app.post('/api/tickets', requireUser, upload.array('files', 5), route((req, res) => {
  const { title = '', description = '', category = '', priority = 'medium' } = req.body || {};
  if (!title.trim() || title.length > 150) throw new HttpError(400, 'Please enter a title (max 150 characters).');
  if (!description.trim()) throw new HttpError(400, 'Please describe the problem.');
  if (!CATEGORIES.includes(category)) throw new HttpError(400, 'Please choose a category.');
  if (!PRIORITIES.includes(priority)) throw new HttpError(400, 'Invalid priority.');
  const r = db
    .prepare('INSERT INTO tickets (title, description, category, priority, requester_id) VALUES (?, ?, ?, ?, ?)')
    .run(title.trim(), description.trim(), category, priority, req.user.id);
  const id = Number(r.lastInsertRowid);
  const eventId = addMessage(id, req.user.id, 'event', `opened the ticket`);
  if (req.files?.length) saveAttachments(req.files, id, eventId, req.user.id);
  res.status(201).json({ id });
}));

app.get('/api/tickets/:id', requireUser, route((req, res) => {
  const ticket = loadTicket(req.params.id, req.user);
  const staff = isStaff(req.user);
  const full = db.prepare(`${TICKET_SELECT} WHERE t.id = ?`).get(ticket.id);
  const messages = db
    .prepare(
      `SELECT m.*, u.display_name AS author_name, u.role AS author_role, u.tier AS author_tier
       FROM messages m LEFT JOIN users u ON u.id = m.user_id
       WHERE m.ticket_id = ? ${staff ? '' : "AND m.kind != 'note'"} ORDER BY m.id`
    )
    .all(ticket.id);
  const attachments = db
    .prepare('SELECT id, message_id, original_name, mime_type, size, created_at FROM attachments WHERE ticket_id = ? ORDER BY id')
    .all(ticket.id);
  const visibleIds = new Set(messages.map((m) => m.id));
  for (const m of messages) m.attachments = [];
  const byId = new Map(messages.map((m) => [m.id, m]));
  for (const a of attachments) if (visibleIds.has(a.message_id)) byId.get(a.message_id).attachments.push(a);
  res.json({ ticket: full, messages });
}));

// Post a chat message (optionally with attachments). Staff may flag it as an internal note.
app.post('/api/tickets/:id/messages', requireUser, upload.array('files', 5), route((req, res) => {
  const ticket = loadTicket(req.params.id, req.user);
  if (ticket.status === 'closed') throw new HttpError(409, 'This ticket is closed. Reopen it to continue the conversation.');
  const body = (req.body?.body || '').trim();
  if (!body && !req.files?.length) throw new HttpError(400, 'Message is empty.');
  const internal = isStaff(req.user) && req.body?.internal === 'true';
  const msgId = addMessage(ticket.id, req.user.id, internal ? 'note' : 'message', body);
  saveAttachments(req.files, ticket.id, msgId, req.user.id);
  updateTicket(ticket.id, {});
  notify(ticket.id);
  res.status(201).json({ id: msgId });
}));

app.post('/api/tickets/:id/claim', requireStaff, route((req, res) => {
  const ticket = loadTicket(req.params.id, req.user);
  if (ticket.status === 'closed') throw new HttpError(409, 'Reopen the ticket before claiming it.');
  if (ticket.assignee_id === req.user.id) throw new HttpError(409, 'You already own this ticket.');
  if (req.user.tier < ticket.tier) throw new HttpError(403, `This ticket is escalated to Tier ${ticket.tier}. You are Tier ${req.user.tier}.`);
  if (ticket.assignee_id && req.user.tier < MAX_TIER) throw new HttpError(409, 'Ticket is already claimed by another technician.');
  const takeover = !!ticket.assignee_id;
  updateTicket(ticket.id, { assignee_id: req.user.id, status: 'in_progress' });
  addMessage(ticket.id, req.user.id, 'event', takeover ? 'took over the ticket' : 'claimed the ticket');
  notify(ticket.id);
  res.json({ ok: true });
}));

app.post('/api/tickets/:id/unassign', requireStaff, route((req, res) => {
  const ticket = loadTicket(req.params.id, req.user);
  if (!ticket.assignee_id) throw new HttpError(409, 'Ticket is not assigned.');
  if (ticket.assignee_id !== req.user.id && req.user.tier < MAX_TIER) throw new HttpError(403, 'Only the assignee or a manager can release this ticket.');
  updateTicket(ticket.id, { assignee_id: null, status: ticket.status === 'closed' ? 'closed' : 'open' });
  addMessage(ticket.id, req.user.id, 'event', 'released the ticket back to the queue');
  notify(ticket.id);
  res.json({ ok: true });
}));

app.post('/api/tickets/:id/escalate', requireStaff, route((req, res) => {
  const ticket = loadTicket(req.params.id, req.user);
  const reason = (req.body?.reason || '').trim();
  if (ticket.status === 'closed') throw new HttpError(409, 'Reopen the ticket before escalating it.');
  if (ticket.tier >= MAX_TIER) throw new HttpError(409, 'Ticket is already at the highest support tier.');
  if (!reason) throw new HttpError(400, 'Please give a reason for escalating.');
  const newTier = ticket.tier + 1;
  let assignee = null;
  if (req.body?.assigneeId) {
    assignee = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'staff'").get(Number(req.body.assigneeId));
    if (!assignee) throw new HttpError(400, 'Selected staff member not found.');
    if (assignee.tier < newTier) throw new HttpError(400, `${assignee.display_name} is below Tier ${newTier}.`);
  }
  updateTicket(ticket.id, { tier: newTier, assignee_id: assignee?.id ?? null, status: assignee ? 'in_progress' : 'open' });
  addMessage(
    ticket.id,
    req.user.id,
    'event',
    `escalated the ticket to Tier ${newTier}${assignee ? ` and assigned it to ${assignee.display_name}` : ''} — Reason: ${reason}`
  );
  notify(ticket.id);
  res.json({ ok: true });
}));

app.post('/api/tickets/:id/close', requireUser, route((req, res) => {
  const ticket = loadTicket(req.params.id, req.user);
  if (ticket.status === 'closed') throw new HttpError(409, 'Ticket is already closed.');
  const resolution = (req.body?.resolution || '').trim();
  updateTicket(ticket.id, { status: 'closed', closed_at: new Date().toISOString().replace('T', ' ').slice(0, 19) });
  addMessage(ticket.id, req.user.id, 'event', `closed the ticket${resolution ? ` — Resolution: ${resolution}` : ''}`);
  notify(ticket.id);
  res.json({ ok: true });
}));

app.post('/api/tickets/:id/reopen', requireUser, route((req, res) => {
  const ticket = loadTicket(req.params.id, req.user);
  if (ticket.status !== 'closed') throw new HttpError(409, 'Ticket is not closed.');
  const reason = (req.body?.reason || '').trim();
  updateTicket(ticket.id, { status: ticket.assignee_id ? 'in_progress' : 'open', closed_at: null });
  addMessage(ticket.id, req.user.id, 'event', `reopened the ticket${reason ? ` — Reason: ${reason}` : ''}`);
  notify(ticket.id);
  res.json({ ok: true });
}));

app.patch('/api/tickets/:id', requireStaff, route((req, res) => {
  const ticket = loadTicket(req.params.id, req.user);
  const { priority } = req.body || {};
  if (!PRIORITIES.includes(priority)) throw new HttpError(400, 'Invalid priority.');
  if (priority === ticket.priority) return res.json({ ok: true });
  updateTicket(ticket.id, { priority });
  addMessage(ticket.id, req.user.id, 'event', `changed priority from ${ticket.priority} to ${priority}`);
  notify(ticket.id);
  res.json({ ok: true });
}));

// ---------- attachments ----------

app.get('/api/attachments/:id', requireUser, route((req, res) => {
  const a = db
    .prepare('SELECT a.*, m.kind FROM attachments a LEFT JOIN messages m ON m.id = a.message_id WHERE a.id = ?')
    .get(Number(req.params.id));
  if (!a) throw new HttpError(404, 'File not found.');
  loadTicket(a.ticket_id, req.user); // access check
  if (a.kind === 'note' && !isStaff(req.user)) throw new HttpError(404, 'File not found.');
  const inline = INLINE_TYPES.has(a.mime_type) && req.query.download === undefined;
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Content-Type', inline ? a.mime_type : 'application/octet-stream');
  res.set(
    'Content-Disposition',
    `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(a.original_name)}`
  );
  res.sendFile(path.join(UPLOAD_DIR, a.stored_name));
}));

// ---------- errors ----------

app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found.')));

app.use((err, req, res, _next) => {
  removeUploadedFiles(req.files);
  if (err instanceof multer.MulterError) {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Each file must be 10 MB or smaller.' : err.code === 'LIMIT_FILE_COUNT' ? 'You can attach up to 5 files.' : err.message;
    return res.status(400).json({ error: msg });
  }
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong.' });
});

app.listen(PORT, () => console.log(`IT Help Desk running at http://localhost:${PORT}`));
