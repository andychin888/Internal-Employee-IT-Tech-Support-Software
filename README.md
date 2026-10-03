# HelpDesk — IT Tech Support Website

A full-stack IT service desk. Employees open tickets and chat with IT. IT staff claim, work, escalate and close them.

## Run it

```bash
npm install
npm start          # http://localhost:3000
```

Requires Node 22.5 or newer, because it uses the built-in `node:sqlite`. Use `npm run dev` to auto-restart on changes and `npm run reset` to wipe the database and uploaded files.

## Demo accounts (password: `password123`)

| Username  | Sign in as | Role                         |
|-----------|------------|------------------------------|
| `alice`   | I need help | Regular employee            |
| `tech1`   | IT Staff   | Tier 1 frontline technician  |
| `tech2`   | IT Staff   | Tier 2 senior technician     |
| `manager` | IT Staff   | Tier 3 IT manager            |

Anyone can register a regular account from the login page. Staff accounts can't be self-registered.

## Features

- **Two login portals:** "I need help" for employees and "IT Staff" for technicians. The staff portal rejects non-staff accounts.
- **Open tickets** with a subject, category, priority, description and up to 5 attachments (10 MB each, drag-and-drop).
- **Claim:** staff take ownership of an unassigned ticket, which moves it to *In progress*. Tier 3 can take over a ticket someone else has claimed.
- **Release:** hand a ticket back to the queue.
- **Escalate:** move a ticket up a tier (1 → 2 → 3). A reason is required. You can send it to that tier's queue or assign it directly to a specific higher-tier staff member. Staff below the ticket's tier can't claim it.
- **Close / Reopen:** both requesters and staff can do this. Closing takes an optional resolution note and reopening takes a reason. Both are logged in the ticket timeline.
- **Live chat** on every ticket, updated in real time over Server-Sent Events. You can attach files, paste screenshots, and see image previews inline.
- **Internal notes:** staff can post notes and files that requesters never see.
- **Staff dashboard:** counters, queue views (Unassigned / Assigned to me / Escalated / All), a status filter, search by text or `#id`, and priority changes.
- An audit trail of every action (claimed, escalated, closed, and so on) appears inline in the conversation.

## Structure

```
server.js       Express API: auth, tickets, chat, attachments, SSE
db.js           SQLite schema, password hashing, demo seed data
public/         Single-page frontend (vanilla HTML/CSS/JS, no build step)
uploads/        Stored attachments (created at runtime)
helpdesk.db     SQLite database (created at runtime)
```

## Security notes

Passwords are hashed with scrypt. Sessions use random tokens in an HttpOnly cookie. Every ticket and attachment request is checked against the viewer's role and ownership. Uploaded files are stored under random names and served with `nosniff`, and only common raster image types are shown inline. For production use, serve it behind HTTPS and set the cookie's `secure` flag.
