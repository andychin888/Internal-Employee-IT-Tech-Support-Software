'use strict';

// ---------- tiny utilities ----------

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

// Tagged template that escapes every interpolation unless it was produced by html`` itself (or raw()).
class Safe { constructor(s) { this.s = s; } toString() { return this.s; } }
const raw = (s) => new Safe(s);
function html(strings, ...vals) {
  let out = strings[0];
  vals.forEach((v, i) => {
    const part = Array.isArray(v) ? v.map((x) => (x instanceof Safe ? x.s : esc(x))).join('') : v instanceof Safe ? v.s : v === false || v == null ? '' : esc(v);
    out += part + strings[i + 1];
  });
  return new Safe(out);
}

const ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  clip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  up: '<path d="m18 15-6-6-6 6"/>',
  hand: '<path d="M9 11V6a2 2 0 1 1 4 0v5M13 10V4a2 2 0 1 1 4 0v7M17 9a2 2 0 1 1 4 0v5a8 8 0 0 1-8 8h-1a8 8 0 0 1-6.3-3.1L3 15.5a2 2 0 0 1 3-2.6L9 16V8a2 2 0 1 1 4 0"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/>',
  out: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  headset: '<path d="M3 14v-2a9 9 0 0 1 18 0v2"/><path d="M21 16a2 2 0 0 1-2 2h-1v-6h3zM3 16a2 2 0 0 0 2 2h1v-6H3z"/>',
  release: '<path d="M18 6 6 18M6 6l12 12"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
};
const icon = (name) => raw(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`);

const toDate = (s) => new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
function ago(s) {
  const sec = Math.round((Date.now() - toDate(s)) / 1000);
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  if (sec < 86400 * 7) return `${Math.floor(sec / 86400)}d ago`;
  return toDate(s).toLocaleDateString();
}
const fullTime = (s) => toDate(s).toLocaleString();
const initials = (name) => name.replace(/\(.*\)/, '').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const fmtSize = (b) => (b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`);
const STATUS_LABEL = { open: 'Open', in_progress: 'In progress', closed: 'Closed' };

let toastTimer;
function toast(msg, isError = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'show' + (isError ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = ''), 2800);
}

async function api(path, { method = 'GET', body, form } = {}) {
  const opts = { method, headers: {} };
  if (form) opts.body = form;
  else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && state.user) {
    state.user = null;
    location.hash = '#/login';
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// ---------- state & routing ----------

const state = { user: null, meta: null, staff: [], cleanup: [] };
const app = $('#app');

function onLeave(fn) { state.cleanup.push(fn); }

async function router() {
  state.cleanup.splice(0).forEach((fn) => fn());
  const hash = location.hash || '#/';
  if (!state.user) return hash === '#/register' ? renderRegister() : renderLogin();
  const m = hash.match(/^#\/tickets\/(\d+)$/);
  if (m) return renderTicket(Number(m[1]));
  if (hash === '#/new') return renderNew();
  return renderList();
}

async function boot() {
  const [{ user }, meta] = await Promise.all([api('/api/me'), api('/api/meta')]);
  state.user = user;
  state.meta = meta;
  if (user?.role === 'staff') state.staff = (await api('/api/staff')).staff;
  window.addEventListener('hashchange', router);
  router();
}

async function afterLogin(user) {
  state.user = user;
  if (user.role === 'staff') state.staff = (await api('/api/staff')).staff;
  location.hash = '#/';
  router();
}

// ---------- auth views ----------

function authLayout(inner) {
  app.innerHTML = html`
    <div class="auth-wrap">
      <section class="auth-hero">
        <div class="brand"><span class="logo">${icon('headset')}</span> HelpDesk</div>
        <div>
          <h1>IT support, <span>without the runaround.</span></h1>
          <p>Report a problem, track its progress, and chat directly with the technician working on it.</p>
          <ul>
            <li>Open tickets with screenshots and log files attached</li>
            <li>Live chat with the IT team on every ticket</li>
            <li>Escalation to senior engineers when it's needed</li>
          </ul>
        </div>
        <div class="small" style="opacity:.6">Internal IT Service Desk</div>
      </section>
      <section class="auth-panel"><div class="auth-card">${inner}</div></section>
    </div>`;
}

function renderLogin(role = sessionStorage.getItem('loginRole') || 'user') {
  const staff = role === 'staff';
  authLayout(html`
    <h2>Sign in</h2>
    <p class="muted" style="margin:0">${staff ? 'IT staff portal — manage and resolve tickets.' : 'Get help with a technology problem.'}</p>
    <div class="role-toggle" role="tablist">
      <button type="button" data-role="user" class="${staff ? '' : 'active'}" role="tab">I need help</button>
      <button type="button" data-role="staff" class="${staff ? 'active' : ''}" role="tab">IT Staff</button>
    </div>
    <form id="login-form" novalidate>
      <div id="err"></div>
      <div class="field"><label for="u">Username</label><input id="u" name="username" type="text" autocomplete="username" required autofocus /></div>
      <div class="field"><label for="p">Password</label><input id="p" name="password" type="password" autocomplete="current-password" required /></div>
      <button class="btn primary block" type="submit">Sign in${staff ? ' to staff portal' : ''}</button>
    </form>
    ${staff
      ? html`<p class="muted small" style="margin-top:18px">Staff accounts are created by your IT administrator.</p>`
      : html`<p class="muted small" style="margin-top:18px">New here? <a href="#/register">Create an account</a></p>`}
    <div class="demo-box">
      <strong>Demo accounts</strong> (password <code>password123</code>)<br />
      ${staff
        ? html`<button data-demo="tech1">tech1</button> Tier 1 · <button data-demo="tech2">tech2</button> Tier 2 · <button data-demo="manager">manager</button> Tier 3`
        : html`<button data-demo="alice">alice</button> — regular employee`}
    </div>`);

  $$('.role-toggle button').forEach((b) =>
    b.addEventListener('click', () => {
      sessionStorage.setItem('loginRole', b.dataset.role);
      renderLogin(b.dataset.role);
    })
  );
  $$('[data-demo]').forEach((b) =>
    b.addEventListener('click', () => {
      $('#u').value = b.dataset.demo;
      $('#p').value = 'password123';
      $('#login-form').requestSubmit();
    })
  );
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      const { user } = await api('/api/auth/login', { method: 'POST', body: { username: f.get('username'), password: f.get('password'), role } });
      afterLogin(user);
    } catch (err) {
      $('#err').innerHTML = html`<div class="error">${err.message}</div>`;
    }
  });
}

function renderRegister() {
  authLayout(html`
    <h2>Create your account</h2>
    <p class="muted" style="margin:0 0 24px">So you can submit and track support tickets.</p>
    <form id="reg-form" novalidate>
      <div id="err"></div>
      <div class="field"><label for="dn">Full name</label><input id="dn" name="displayName" type="text" autocomplete="name" required autofocus /></div>
      <div class="field"><label for="em">Work email</label><input id="em" name="email" type="email" autocomplete="email" /></div>
      <div class="field"><label for="u">Username</label><input id="u" name="username" type="text" autocomplete="username" required /></div>
      <div class="field"><label for="p">Password</label><input id="p" name="password" type="password" autocomplete="new-password" minlength="8" required /><div class="muted small" style="margin-top:4px">At least 8 characters.</div></div>
      <button class="btn primary block" type="submit">Create account</button>
    </form>
    <p class="muted small" style="margin-top:18px">Already have an account? <a href="#/login">Sign in</a></p>`);

  $('#reg-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const { user } = await api('/api/auth/register', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
      toast('Welcome aboard!');
      afterLogin(user);
    } catch (err) {
      $('#err').innerHTML = html`<div class="error">${err.message}</div>`;
    }
  });
}

// ---------- app shell ----------

function shell(inner, active) {
  const u = state.user;
  const staff = u.role === 'staff';
  app.innerHTML = html`
    <header class="topbar">
      <div class="left">
        <a class="brand" href="#/"><span class="logo">${icon('headset')}</span> HelpDesk${staff ? html` <span class="tier">STAFF</span>` : ''}</a>
        <nav>
          <a href="#/" class="${active === 'list' ? 'active' : ''}" title="${staff ? 'Ticket queue' : 'My tickets'}">${icon('list')}<span>${staff ? 'Ticket queue' : 'My tickets'}</span></a>
          <a href="#/new" class="${active === 'new' ? 'active' : ''}" title="New ticket">${icon('plus')}<span>New ticket</span></a>
        </nav>
      </div>
      <div class="who">
        <div class="avatar ${staff ? 'staff' : ''}">${initials(u.displayName)}</div>
        <div class="who-text">
          <div class="name">${u.displayName}</div>
          <div class="role">${staff ? `IT Staff · Tier ${u.tier}` : 'Employee'}</div>
        </div>
        <button class="btn ghost" id="logout" title="Sign out">${icon('out')}</button>
      </div>
    </header>
    <main>${inner}</main>`;
  $('#logout').addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' });
    state.user = null;
    location.hash = '#/login';
    router();
  });
}

// ---------- ticket list ----------

const listPrefs = { scope: 'unassigned', status: 'active', q: '' };

async function renderList() {
  const staff = state.user.role === 'staff';
  if (!staff && !['active', 'closed', 'all'].includes(listPrefs.status)) listPrefs.status = 'active';

  shell(html`
    <div class="page-head">
      <div>
        <h1>${staff ? 'Ticket queue' : 'My tickets'}</h1>
        <div class="muted">${staff ? `Signed in as Tier ${state.user.tier} support` : 'Track the status of your support requests.'}</div>
      </div>
      <a class="btn primary" href="#/new">${icon('plus')} New ticket</a>
    </div>
    ${staff ? html`<div class="stats" id="stats"></div>` : ''}
    <div class="card">
      <div class="toolbar">
        ${staff
          ? html`<div class="tabs" id="scope">
              ${[['unassigned', 'Unassigned'], ['mine', 'Assigned to me'], ['escalated', 'Escalated'], ['all', 'All tickets']].map(
                ([k, l]) => html`<button data-v="${k}" class="${listPrefs.scope === k ? 'active' : ''}">${l}</button>`
              )}
            </div>
            <select id="status" aria-label="Status filter">
              ${[['active', 'Active'], ['open', 'Open'], ['in_progress', 'In progress'], ['closed', 'Closed'], ['all', 'Any status']].map(
                ([k, l]) => html`<option value="${k}" ${raw(listPrefs.status === k ? 'selected' : '')}>${l}</option>`
              )}
            </select>`
          : html`<div class="tabs" id="ustatus">
              ${[['active', 'Active'], ['closed', 'Closed'], ['all', 'All']].map(
                ([k, l]) => html`<button data-v="${k}" class="${listPrefs.status === k ? 'active' : ''}">${l}</button>`
              )}
            </div>`}
        <div class="spacer"></div>
        <div class="search">${icon('search')}<input type="search" id="q" placeholder="Search tickets or #id" value="${listPrefs.q}" aria-label="Search tickets" /></div>
      </div>
      <div id="rows"><div class="empty">Loading…</div></div>
    </div>`, 'list');

  const load = async () => {
    const params = new URLSearchParams({ status: listPrefs.status, q: listPrefs.q });
    if (staff) params.set('scope', listPrefs.scope);
    try {
      const [{ tickets }, stats] = await Promise.all([api(`/api/tickets?${params}`), staff ? api('/api/stats') : null]);
      if (stats) renderStats(stats);
      renderRows(tickets, staff);
    } catch (err) {
      toast(err.message, true);
    }
  };

  $$('#scope button, #ustatus button').forEach((b) =>
    b.addEventListener('click', () => {
      if (staff) listPrefs.scope = b.dataset.v;
      else listPrefs.status = b.dataset.v;
      $$('button', b.parentElement).forEach((x) => x.classList.toggle('active', x === b));
      load();
    })
  );
  $('#status')?.addEventListener('change', (e) => { listPrefs.status = e.target.value; load(); });
  let t;
  $('#q').addEventListener('input', (e) => {
    clearTimeout(t);
    t = setTimeout(() => { listPrefs.q = e.target.value.trim(); load(); }, 250);
  });

  load();
  const poll = setInterval(load, 15000);
  onLeave(() => clearInterval(poll));
}

function renderStats(s) {
  const el = $('#stats');
  if (!el) return;
  el.innerHTML = html`${[
    [s.open, 'Active tickets', 'inbox', 'info'],
    [s.unassigned, 'Unassigned', 'alert', 'warn'],
    [s.mine, 'Assigned to me', 'user', ''],
    [s.escalated, 'Escalated', 'up', 'danger'],
    [s.closedToday, 'Closed today', 'check', 'ok'],
  ].map(([n, l, ic, tone]) => html`<div class="card stat"><div class="top"><span class="l">${l}</span><span class="ic ${tone}">${icon(ic)}</span></div><div class="n">${n}</div></div>`)}`;
}

function tierBadge(tier) {
  return html`<span class="tier t${tier}">Tier ${tier}</span>`;
}

function renderRows(tickets, staff) {
  const el = $('#rows');
  if (!el) return;
  if (!tickets.length) {
    el.innerHTML = html`<div class="empty"><div class="ic">${icon('inbox')}</div>${staff ? 'No tickets match this view.' : html`You have no tickets here. <a href="#/new">Open a new ticket</a> if you need help.`}</div>`;
    return;
  }
  el.innerHTML = html`
    <div class="ticket-row head"><div>ID</div><div>Subject</div><div>Status</div><div>Priority</div><div>${staff ? 'Assignee' : 'Technician'}</div><div>Updated</div></div>
    ${tickets.map(
      (t) => html`
        <a class="ticket-row" href="#/tickets/${t.id}">
          <div class="id">#${t.id}</div>
          <div style="min-width:0">
            <div class="title">${t.title}</div>
            <div class="sub">${t.category}${staff ? ` · ${t.requester_name}` : ''} · ${t.message_count} message${t.message_count === 1 ? '' : 's'} ${t.tier > 1 ? tierBadge(t.tier) : ''}</div>
          </div>
          <div><span class="badge ${t.status}">${STATUS_LABEL[t.status]}</span></div>
          <div class="prio ${t.priority}">${t.priority}</div>
          <div class="assignee">${t.assignee_name
            ? html`<span class="avatar staff sm">${initials(t.assignee_name)}</span><span class="sub">${t.assignee_name}</span>`
            : html`<span class="sub">${t.status === 'closed' ? '—' : 'Unassigned'}</span>`}</div>
          <div class="sub" title="${fullTime(t.updated_at)}">${ago(t.updated_at)}</div>
        </a>`
    )}`;
}

// ---------- file picker helper ----------

const MAX_FILES = 5;
const MAX_SIZE = 10 * 1024 * 1024;

function filePicker({ input, list, dropTarget, onChange = () => {} }) {
  let files = [];
  const draw = () => {
    list.innerHTML = html`${files.map(
      (f, i) => html`<li class="file-chip">${icon('file')}<span title="${f.name}">${f.name}</span><span class="muted">${fmtSize(f.size)}</span><button type="button" data-i="${i}" aria-label="Remove ${f.name}">×</button></li>`
    )}`;
    $$('button', list).forEach((b) => b.addEventListener('click', () => { files.splice(Number(b.dataset.i), 1); draw(); }));
    onChange(files);
  };
  const add = (incoming) => {
    for (const f of incoming) {
      if (f.size > MAX_SIZE) { toast(`${f.name} is larger than 10 MB`, true); continue; }
      if (files.length >= MAX_FILES) { toast(`You can attach up to ${MAX_FILES} files`, true); break; }
      files.push(f);
    }
    draw();
  };
  input.addEventListener('change', () => { add(input.files); input.value = ''; });
  if (dropTarget) {
    dropTarget.addEventListener('dragover', (e) => { e.preventDefault(); dropTarget.classList.add('drag'); });
    dropTarget.addEventListener('dragleave', () => dropTarget.classList.remove('drag'));
    dropTarget.addEventListener('drop', (e) => { e.preventDefault(); dropTarget.classList.remove('drag'); add(e.dataTransfer.files); });
  }
  return { get: () => files, add, clear: () => { files = []; draw(); } };
}

// ---------- new ticket ----------

function renderNew() {
  const { categories, priorities } = state.meta;
  shell(html`
    <a class="back" href="#/">${icon('back')} Back to tickets</a>
    <div class="page-head"><div><h1>Open a new ticket</h1><div class="muted">Tell us what's going wrong and we'll get the right person on it.</div></div></div>
    <form class="card form-card" id="new-form" novalidate>
      <div id="err"></div>
      <div class="field"><label for="title">Subject</label><input id="title" name="title" type="text" maxlength="150" placeholder="e.g. Laptop won't connect to office Wi-Fi" required autofocus /></div>
      <div class="row">
        <div class="field"><label for="category">Category</label>
          <select id="category" name="category" required>
            <option value="">Choose a category…</option>
            ${categories.map((c) => html`<option>${c}</option>`)}
          </select>
        </div>
        <div class="field"><label for="priority">Priority</label>
          <select id="priority" name="priority">
            ${priorities.map((p) => html`<option value="${p}" ${raw(p === 'medium' ? 'selected' : '')}>${p[0].toUpperCase() + p.slice(1)}</option>`)}
          </select>
        </div>
      </div>
      <div class="field"><label for="description">Description</label>
        <textarea id="description" name="description" rows="7" placeholder="What happened? When did it start? Any error messages? What have you already tried?" required></textarea>
      </div>
      <div class="field">
        <label>Attachments <span class="muted" style="font-weight:400">(optional · up to 5 files, 10 MB each)</span></label>
        <div class="dropzone" id="drop"><div class="ic">${icon('upload')}</div>Drag files here or <a href="#" id="browse">browse</a><div class="small" style="margin-top:2px">Screenshots, logs, documents</div></div>
        <input type="file" id="file-input" multiple hidden />
        <ul class="file-list" id="file-list"></ul>
      </div>
      <div class="form-foot">
        <a class="btn" href="#/">Cancel</a>
        <button class="btn primary" type="submit">Submit ticket</button>
      </div>
    </form>`, 'new');

  const picker = filePicker({ input: $('#file-input'), list: $('#file-list'), dropTarget: $('#drop') });
  $('#drop').addEventListener('click', (e) => { e.preventDefault(); $('#file-input').click(); });

  $('#new-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button[type=submit]', e.target);
    const form = new FormData(e.target);
    picker.get().forEach((f) => form.append('files', f));
    btn.disabled = true;
    try {
      const { id } = await api('/api/tickets', { method: 'POST', form });
      toast(`Ticket #${id} created`);
      location.hash = `#/tickets/${id}`;
    } catch (err) {
      $('#err').innerHTML = html`<div class="error">${err.message}</div>`;
      btn.disabled = false;
    }
  });
}

// ---------- modal ----------

function modal({ title, text, body = '', confirm, confirmClass = 'primary', onConfirm }) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = html`
    <form class="card modal" role="dialog" aria-modal="true">
      <h2>${title}</h2>
      ${text ? html`<p class="muted">${text}</p>` : ''}
      <div class="merr"></div>
      ${body}
      <div class="foot"><button type="button" class="btn" data-cancel>Cancel</button><button type="submit" class="btn ${confirmClass}">${confirm}</button></div>
    </form>`;
  document.body.appendChild(wrap);
  const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => e.key === 'Escape' && close();
  document.addEventListener('keydown', onKey);
  wrap.addEventListener('click', (e) => e.target === wrap && close());
  $('[data-cancel]', wrap).addEventListener('click', close);
  $('form', wrap).addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button[type=submit]', wrap);
    btn.disabled = true;
    try {
      await onConfirm(Object.fromEntries(new FormData(e.target)));
      close();
    } catch (err) {
      $('.merr', wrap).innerHTML = html`<div class="error">${err.message}</div>`;
      btn.disabled = false;
    }
  });
  ($('textarea, select, input', wrap) || $('button[type=submit]', wrap)).focus();
  onLeave(close);
}

// ---------- ticket detail ----------

async function renderTicket(id) {
  const me = state.user;
  const staff = me.role === 'staff';
  shell(html`
    <a class="back" href="#/">${icon('back')} Back to ${staff ? 'queue' : 'my tickets'}</a>
    <div id="head"><div class="muted">Loading…</div></div>
    <div class="detail-grid">
      <section class="card conversation">
        <div class="thread" id="thread"></div>
        <form class="composer" id="composer">
          <div class="box">
            <textarea name="body" id="msg" placeholder="Write a message… (Enter to send, Shift+Enter for a new line)"></textarea>
            <ul class="file-list" id="msg-files"></ul>
            <div class="bar">
              <button type="button" class="btn ghost" id="attach" title="Attach files">${icon('clip')} Attach</button>
              <input type="file" id="msg-input" multiple hidden />
              ${staff ? html`<label class="switch"><input type="checkbox" id="internal" /> Internal note<span class="long">&nbsp;(staff only)</span></label>` : ''}
              <div class="spacer"></div>
              <button class="btn primary" type="submit" id="send">${icon('send')} Send</button>
            </div>
          </div>
        </form>
        <div class="closed-banner hidden" id="closed-banner">${icon('lock')} This ticket is closed. Reopen it to continue the conversation.</div>
      </section>
      <aside class="card side" id="side"></aside>
    </div>`, 'ticket');

  let ticket;
  const composer = $('#composer');
  const picker = filePicker({ input: $('#msg-input'), list: $('#msg-files'), dropTarget: composer });
  $('#attach').addEventListener('click', () => $('#msg-input').click());
  $('#internal')?.addEventListener('change', (e) => {
    composer.classList.toggle('note-mode', e.target.checked);
    $('#msg').placeholder = e.target.checked ? 'Internal note — only IT staff will see this' : 'Write a message… (Enter to send, Shift+Enter for a new line)';
  });
  $('#msg').addEventListener('paste', (e) => {
    const imgs = [...(e.clipboardData?.files || [])];
    if (imgs.length) { e.preventDefault(); picker.add(imgs); }
  });
  $('#msg').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); composer.requestSubmit(); }
  });
  composer.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = $('#msg').value.trim();
    if (!body && !picker.get().length) return;
    const form = new FormData();
    form.append('body', body);
    form.append('internal', String(!!$('#internal')?.checked));
    picker.get().forEach((f) => form.append('files', f));
    $('#send').disabled = true;
    try {
      await api(`/api/tickets/${id}/messages`, { method: 'POST', form });
      $('#msg').value = '';
      picker.clear();
      await refresh();
    } catch (err) {
      toast(err.message, true);
    } finally {
      $('#send').disabled = false;
      $('#msg').focus();
    }
  });

  const action = async (path, body, okMsg) => {
    await api(`/api/tickets/${id}/${path}`, { method: 'POST', body });
    toast(okMsg);
    await refresh();
  };

  async function refresh() {
    let data;
    try {
      data = await api(`/api/tickets/${id}`);
    } catch (err) {
      $('#head').innerHTML = html`<div class="error">${err.message}</div>`;
      $('.detail-grid')?.remove();
      return;
    }
    ticket = data.ticket;
    const thread = $('#thread');
    if (!thread) return;
    const nearBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 80;
    drawHead(ticket);
    drawSide(ticket);
    thread.innerHTML = html`${data.messages.map(drawMessage)}`;
    if (nearBottom || !thread.dataset.loaded) thread.scrollTop = thread.scrollHeight;
    thread.dataset.loaded = '1';
    const closed = ticket.status === 'closed';
    composer.classList.toggle('hidden', closed);
    $('#closed-banner').classList.toggle('hidden', !closed);
  }

  function drawMessage(m) {
    const files = m.attachments.length
      ? html`<div class="files">${m.attachments.map((a) =>
          a.mime_type.startsWith('image/') && /png|jpeg|gif|webp/.test(a.mime_type)
            ? html`<a href="/api/attachments/${a.id}" target="_blank" rel="noopener"><img class="thumb" src="/api/attachments/${a.id}" alt="${a.original_name}" loading="lazy" /></a>`
            : html`<a class="file-link" href="/api/attachments/${a.id}?download">${icon('file')} ${a.original_name} <span style="opacity:.7">${fmtSize(a.size)}</span></a>`
        )}</div>`
      : '';
    if (m.kind === 'event') {
      return html`<div class="event"><b>${m.author_name || 'System'}</b> ${m.body} · <span title="${fullTime(m.created_at)}">${ago(m.created_at)}</span>${files}</div>`;
    }
    const mine = m.user_id === me.id;
    const isStaffAuthor = m.author_role === 'staff';
    return html`
      <div class="msg ${mine ? 'mine' : ''} ${m.kind === 'note' ? 'note' : ''}">
        <div class="avatar ${isStaffAuthor ? 'staff' : ''}" title="${m.author_name}">${initials(m.author_name || '?')}</div>
        <div>
          <div class="author">${mine ? 'You' : m.author_name}${isStaffAuthor && !mine ? ' · IT Support' : ''} · <span title="${fullTime(m.created_at)}">${ago(m.created_at)}</span></div>
          <div class="bubble">
            ${m.kind === 'note' ? html`<div class="note-tag">${icon('lock')} Internal note</div>` : ''}
            ${m.body ? html`<div class="text">${m.body}</div>` : ''}
            ${files}
          </div>
        </div>
      </div>`;
  }

  function drawHead(t) {
    const closed = t.status === 'closed';
    const mineAssigned = t.assignee_id === me.id;
    const btns = [];
    if (staff && !closed) {
      const canClaim = !mineAssigned && me.tier >= t.tier && (!t.assignee_id || me.tier >= state.meta.maxTier);
      if (canClaim) btns.push(html`<button class="btn primary" data-act="claim">${icon('hand')} ${t.assignee_id ? 'Take over' : 'Claim ticket'}</button>`);
      if (t.assignee_id && (mineAssigned || me.tier >= state.meta.maxTier)) btns.push(html`<button class="btn" data-act="unassign">${icon('release')} Release</button>`);
      if (t.tier < state.meta.maxTier) btns.push(html`<button class="btn warn" data-act="escalate">${icon('up')} Escalate</button>`);
    }
    if (!closed) btns.push(html`<button class="btn danger" data-act="close">${icon('check')} ${staff ? 'Close ticket' : 'Mark as resolved'}</button>`);
    else btns.push(html`<button class="btn" data-act="reopen">${icon('undo')} Reopen ticket</button>`);

    $('#head').innerHTML = html`
      <div class="detail-head">
        <div style="min-width:0">
          <div class="muted small">Ticket #${t.id} · ${t.category}</div>
          <h1>${t.title}</h1>
          <div class="meta-line">
            <span class="badge ${t.status}">${STATUS_LABEL[t.status]}</span>
            ${tierBadge(t.tier)}
            <span>Opened by <b>${t.requester_name}</b> ${ago(t.created_at)}</span>
          </div>
        </div>
        <div class="actions">${btns}</div>
      </div>`;

    $$('[data-act]', $('#head')).forEach((b) => b.addEventListener('click', () => handlers[b.dataset.act]()));
  }

  function drawSide(t) {
    $('#side').innerHTML = html`
      <dl>
        <div><dt>Status</dt><dd><span class="badge ${t.status}">${STATUS_LABEL[t.status]}</span></dd></div>
        <div><dt>Priority</dt><dd>${staff
          ? html`<select id="prio">${state.meta.priorities.map((p) => html`<option value="${p}" ${raw(p === t.priority ? 'selected' : '')}>${p[0].toUpperCase() + p.slice(1)}</option>`)}</select>`
          : html`<span class="prio ${t.priority}">${t.priority}</span>`}</dd></div>
        <div><dt>Support level</dt><dd>${tierBadge(t.tier)} ${t.tier === 1 ? 'Frontline' : t.tier === 2 ? 'Senior technician' : 'IT management'}</dd></div>
        <div><dt>Assigned to</dt><dd>${t.assignee_name
          ? html`<span class="avatar staff sm">${initials(t.assignee_name)}</span> ${t.assignee_name}`
          : html`<span class="muted">Waiting for a technician</span>`}</dd></div>
        <div><dt>Requester</dt><dd>${t.requester_name}</dd></div>
        <div><dt>Created</dt><dd>${fullTime(t.created_at)}</dd></div>
        ${t.closed_at ? html`<div><dt>Closed</dt><dd>${fullTime(t.closed_at)}</dd></div>` : ''}
      </dl>
      <hr />
      <div class="dt">Description</div>
      <div class="desc small">${t.description}</div>`;
    $('#prio')?.addEventListener('change', async (e) => {
      try {
        await api(`/api/tickets/${id}`, { method: 'PATCH', body: { priority: e.target.value } });
        toast('Priority updated');
        refresh();
      } catch (err) {
        toast(err.message, true);
      }
    });
  }

  const handlers = {
    claim: () => action('claim', {}, 'Ticket claimed — it’s yours').catch((e) => toast(e.message, true)),
    unassign: () => action('unassign', {}, 'Ticket released to the queue').catch((e) => toast(e.message, true)),
    close: () =>
      modal({
        title: staff ? 'Close ticket' : 'Mark as resolved',
        text: staff ? 'Let the requester know how the issue was resolved.' : 'Glad it’s sorted! You can reopen this ticket later if the problem comes back.',
        body: html`<div class="field"><label for="res">Resolution ${staff ? '' : '(optional)'}</label><textarea id="res" name="resolution" rows="3" placeholder="${staff ? 'e.g. Reset the network adapter and updated the Wi-Fi driver.' : 'What fixed it?'}"></textarea></div>`,
        confirm: 'Close ticket',
        confirmClass: 'primary',
        onConfirm: (f) => action('close', f, 'Ticket closed'),
      }),
    reopen: () =>
      modal({
        title: 'Reopen ticket',
        text: 'The ticket will go back into the active queue.',
        body: html`<div class="field"><label for="why">Why are you reopening it?</label><textarea id="why" name="reason" rows="3" placeholder="e.g. The problem came back this morning."></textarea></div>`,
        confirm: 'Reopen',
        onConfirm: (f) => action('reopen', f, 'Ticket reopened'),
      }),
    escalate: () => {
      const next = ticket.tier + 1;
      const eligible = state.staff.filter((s) => s.tier >= next);
      modal({
        title: `Escalate to Tier ${next}`,
        text: next === state.meta.maxTier ? 'This sends the ticket to IT management.' : 'This sends the ticket to a senior technician.',
        body: html`
          <div class="field"><label for="why">Reason for escalation</label><textarea id="why" name="reason" rows="3" required placeholder="What have you tried, and why does this need a higher level?"></textarea></div>
          <div class="field"><label for="to">Assign to</label>
            <select id="to" name="assigneeId">
              <option value="">Tier ${next} queue (anyone at Tier ${next}+ can claim)</option>
              ${eligible.map((s) => html`<option value="${s.id}">${s.displayName} — Tier ${s.tier}</option>`)}
            </select>
          </div>`,
        confirm: 'Escalate',
        confirmClass: 'primary',
        onConfirm: (f) => action('escalate', f, `Escalated to Tier ${next}`),
      });
    },
  };

  await refresh();

  // Live updates: server pushes a "refresh" event whenever anything on this ticket changes.
  const es = new EventSource(`/api/tickets/${id}/stream`);
  es.onmessage = () => refresh();
  const tick = setInterval(() => $$('#thread [title]').length && refresh(), 60000); // keep "x min ago" fresh
  onLeave(() => { es.close(); clearInterval(tick); });
}

boot().catch((err) => {
  app.innerHTML = html`<main><div class="error">Could not reach the HelpDesk server: ${err.message}</div></main>`;
});
