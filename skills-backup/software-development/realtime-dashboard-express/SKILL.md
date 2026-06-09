---
name: realtime-dashboard-express
description: "Build real-time agent orchestration dashboards with Express.js + sql.js + WebSocket/SSE. Kanban boards, agent fleet management, task dispatch, live activity feeds, agent soul/personality system, persistent memory, inter-agent messaging, skills catalog viewer. Single-binary SQLite, zero external deps."
version: 1.0.0
author: agent-discovered
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [dashboard, express, sqlite, websocket, sse, kanban, agents, realtime, orchestration]
    discovered_date: 2026-06-09
    related_skills: [ai-creative-assistant, claude-code, codex]
---

# Real-Time Dashboard with Express + sql.js

Build a self-contained agent orchestration dashboard — no Docker, no Redis, no Postgres. Express.js serves the API + static SPA, sql.js provides SQLite without native compilation, and WebSocket + SSE push real-time updates to the frontend.

## When to use this skill

- User asks for a "mission control", "dashboard", "control panel", or "orchestration UI"
- Need to manage AI agents (Hermes, Claude Code, Codex, custom) from a web UI
- Need Kanban task board with dispatch-to-agent functionality
- Need real-time activity feed without page refresh
- Want dark futuristic UI aesthetic (user preference)
- Need it to run on Windows without C++ build tools

## Architecture

```
project/
├── server.js              # Express backend + SQLite + SSE + WebSocket
├── public/
│   └── index.html         # Full SPA dashboard (Tailwind CDN)
├── package.json           # Only 3 deps: express, sql.js, ws
└── mission-control.db     # Auto-created SQLite database
```

**Why sql.js instead of better-sqlite3**: better-sqlite3 requires native C++ compilation (node-gyp + Visual Studio Build Tools on Windows). sql.js is pure JavaScript — `npm install` works everywhere with zero build tools.

## Quick Start Template

### package.json
```json
{
  "name": "mission-control",
  "main": "server.js",
  "scripts": { "start": "node server.js" },
  "dependencies": {
    "express": "^4.21.0",
    "sql.js": "^1.11.0",
    "ws": "^8.18.0"
  }
}
```

### Server Bootstrap Pattern (server.js)
```javascript
const express = require('express');
const initSqlJs = require('sql.js');
const { WebSocketServer } = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const DB_PATH = path.join(__dirname, 'mission-control.db');
let db;

async function initDB() {
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    db = new SQL.Database(fs.readFileSync(DB_PATH));
  } else {
    db = new SQL.Database();
  }
  // Create tables...
  db.run(`CREATE TABLE IF NOT EXISTS agents (...)`);
  db.run(`CREATE TABLE IF NOT EXISTS tasks (...)`);
  db.run(`CREATE TABLE IF NOT EXISTS activities (...)`);
  saveDB();
}

function saveDB() {
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
}
setInterval(saveDB, 30000);  // Auto-save every 30s

// Query helpers
function queryAll(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function runSQL(sql, params = []) {
  db.run(sql, params);
  const [{ values: [[id]] }] = db.exec('SELECT last_insert_rowid()');
  return id;
}

// SSE broadcast
const sseClients = new Set();
function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(res => { try { res.write(msg); } catch(e) { sseClients.delete(res); } });
  wss.clients.forEach(ws => { if (ws.readyState === 1) ws.send(JSON.stringify({ event, data })); });
}

app.get('/api/events', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
  res.write(`event: connected\ndata: {"status":"ok"}\n\n`);
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

async function start() {
  await initDB();
  server.listen(PORT, () => console.log(`Dashboard at http://localhost:${PORT}`));
}
start();
```

## Database Schema (Agent Orchestration)

```sql
CREATE TABLE IF NOT EXISTS agents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'general',      -- orchestrator, developer, researcher, automation
  type TEXT NOT NULL DEFAULT 'hermes',        -- hermes, claude-code, codex, custom
  status TEXT NOT NULL DEFAULT 'idle',        -- idle, busy, error, offline
  model TEXT,                                  -- mimo-v2.5-pro, claude-sonnet-4, etc.
  last_seen INTEGER,
  last_activity TEXT,
  tasks_completed INTEGER DEFAULT 0,
  tasks_failed INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  total_cost REAL DEFAULT 0,
  config TEXT DEFAULT '{}',
  created_at INTEGER NOT NULL DEFAULT (cast(strftime('%s','now') as integer)),
  updated_at INTEGER NOT NULL DEFAULT (cast(strftime('%s','now') as integer))
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'inbox',       -- inbox, assigned, in_progress, review, done, failed
  priority TEXT NOT NULL DEFAULT 'medium',    -- low, medium, high, urgent
  assigned_to INTEGER,
  created_by TEXT NOT NULL DEFAULT 'user',
  result TEXT,
  error TEXT,
  started_at INTEGER,
  completed_at INTEGER,
  tags TEXT DEFAULT '[]',
  created_at INTEGER NOT NULL DEFAULT (cast(strftime('%s','now') as integer)),
  updated_at INTEGER NOT NULL DEFAULT (cast(strftime('%s','now') as integer)),
  FOREIGN KEY (assigned_to) REFERENCES agents(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  entity_type TEXT,
  entity_id INTEGER,
  actor TEXT NOT NULL,
  description TEXT NOT NULL,
  data TEXT DEFAULT '{}',
  created_at INTEGER NOT NULL DEFAULT (cast(strftime('%s','now') as integer))
);
```

## Task Dispatch Pattern

```javascript
app.post('/api/tasks/:id/dispatch', (req, res) => {
  const task = queryOne('SELECT * FROM tasks WHERE id = ?', [parseInt(req.params.id)]);
  const agent = queryOne('SELECT * FROM agents WHERE id = ?', [task.assigned_to]);
  
  // Update status
  runSQL('UPDATE tasks SET status="in_progress", started_at=? WHERE id=?', [now, task.id]);
  runSQL('UPDATE agents SET status="busy", last_activity=? WHERE id=?', [`Working: ${task.title}`, agent.id]);
  broadcast('task_dispatched', { task_id: task.id, agent_name: agent.name });
  saveDB();

  // Dispatch based on agent type
  if (agent.type === 'claude-code') {
    exec(`claude -p "${task.title}" --max-turns 5 --output-format json`, { timeout: 120000 }, (err, stdout) => {
      completeTask(task.id, agent.id, err ? 'failed' : 'done', stdout, err?.message);
    });
  } else if (agent.type === 'codex') {
    exec(`codex "${task.title}" --quiet`, { timeout: 120000 }, (err, stdout) => {
      completeTask(task.id, agent.id, err ? 'failed' : 'done', stdout, err?.message);
    });
  } else {
    // Hermes agent — use delegate_task or API
    setTimeout(() => completeTask(task.id, agent.id, 'done', 'Processed via Hermes', null), 5000);
  }
  res.json({ ok: true, message: `Dispatched to ${agent.name}` });
});
```

## Frontend (Dark Futuristic UI)

Use Tailwind CSS via CDN. Key color palette:
```javascript
tailwind.config = {
  theme: {
    extend: {
      colors: {
        bg: { 900: '#0a0a0f', 800: '#0f0f18', 700: '#161625', 600: '#1e1e32' },
        accent: { cyan: '#00f5d4', purple: '#9b5de5', pink: '#f15bb5', blue: '#00bbf9', yellow: '#fee440' }
      }
    }
  }
}
```

CSS effects for the "glass" look:
```css
.glass { background: rgba(15, 15, 24, 0.8); backdrop-filter: blur(12px); border: 1px solid rgba(255,255,255,0.05); }
.glow-cyan { box-shadow: 0 0 20px rgba(0, 245, 212, 0.15); }
.gradient-text { background: linear-gradient(135deg, #00f5d4, #9b5de5, #f15bb5); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
.glow-line { background: linear-gradient(90deg, transparent, #00f5d4, #9b5de5, #f15bb5, transparent); height: 1px; }
```

SSE client connection:
```javascript
const es = new EventSource('/api/events');
es.addEventListener('activity', (e) => {
  const data = JSON.parse(e.data);
  activities.unshift(data);
  renderActivityFeed();
});
```

## Inter-Agent Messaging

Agents can chat with each other. Add a `messages` table:

```sql
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_agent_id INTEGER NOT NULL,
  to_agent_id INTEGER,
  channel TEXT DEFAULT 'general',
  type TEXT NOT NULL DEFAULT 'message',   -- message, reply, system
  content TEXT NOT NULL,
  metadata TEXT DEFAULT '{}',             -- {"response_ms": 326, "model": "mimo-v2.5-pro"}
  read_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (cast(strftime('%s','now') as integer)),
  FOREIGN KEY (from_agent_id) REFERENCES agents(id) ON DELETE CASCADE,
  FOREIGN KEY (to_agent_id) REFERENCES agents(id) ON DELETE SET NULL
);
```

### Chat endpoint (send + auto-reply)

```javascript
app.post('/api/messages/chat', async (req, res) => {
  const { from_agent_id, to_agent_id, content, channel } = req.body;
  // Store outgoing
  const msgId = runSQL('INSERT INTO messages (from_agent_id, to_agent_id, channel, type, content) VALUES (?,?,?,?,?)',
    [from_agent_id, to_agent_id, channel || 'general', 'message', content]);
  // Generate reply (real LLM or simulated)
  const reply = await generateAgentReply(toAgent, fromAgent, content);
  const replyId = runSQL('INSERT INTO messages (from_agent_id, to_agent_id, channel, type, content, metadata) VALUES (?,?,?,?,?,?)',
    [to_agent_id, from_agent_id, channel || 'general', 'reply', reply, JSON.stringify({ response_ms: elapsed })]);
  res.json({ outgoing_id: msgId, reply_id: replyId, reply, elapsed_ms: elapsed });
});
```

### Simulated agent replies (when no LLM API available)

Generate role-based responses so the dashboard works without API keys:

```javascript
function simulateAgentReply(agent, fromAgent, message) {
  const responses = {
    orchestrator: [`Acknowledged. Routing to specialist.`, `Fleet status: ${idleCount} agents idle. Ready to dispatch.`],
    developer: [`Analyzing requirements. Starting implementation.`, `Tests passing. Ready for review.`],
    automation: [`Pipeline triggered. 3 stages: validate → execute → verify.`, `Workflow complete. All steps passed.`],
    researcher: [`Scanning 5 sources now.`, `Analysis complete. Key insight found. Full report attached.`],
  };
  // Context-aware: check for 'status', 'help', 'stress' keywords first
  return responses[agent.role]?.[Math.floor(Math.random() * responses[agent.role].length)] || 'Acknowledged.';
}
```

## Stress Test Pattern

Bulk task creation + inter-agent messaging burst with timing:

```javascript
app.post('/api/stress-test', async (req, res) => {
  const { num_tasks = 10, num_messages = 10 } = req.body;
  // Phase 1: Create N tasks, assign round-robin, dispatch, complete with simulated delay
  // Phase 2: N message pairs between agents with simulated replies
  // Track: completed_tasks, failed_tasks, total_messages, avg_response_ms
  // Broadcast progress via SSE: stress_test_progress { phase, current, total }
});
```

Key metrics to track: task completion rate, average response time, failure count, total throughput time.

## Bulk Dispatch

Dispatch all tasks matching a status filter:

```javascript
app.post('/api/tasks/dispatch-all', (req, res) => {
  const tasks = queryAll('SELECT * FROM tasks WHERE status = ?', [req.body.status || 'assigned']);
  tasks.forEach(task => {
    if (task.assigned_to) {
      // Update to in_progress, set agent busy, dispatch
    }
  });
  res.json({ count: dispatched });
});
```

## Key Patterns

### 1. Dual real-time (SSE + WebSocket)
SSE for server→client push (simpler, auto-reconnect). WebSocket as backup. Both broadcast the same events.

### 2. Auto-save with sql.js
Unlike better-sqlite3 (which persists automatically), sql.js is in-memory. Must call `saveDB()` after every write + `setInterval(saveDB, 30000)` for periodic saves.

### 3. Activity logging
Every state change (task created, dispatched, completed, agent updated) goes through `logActivity()` which writes to DB AND broadcasts via SSE/WebSocket.

### 4. Agent type dispatch
Different agent types get dispatched differently:
- `hermes` → simulate or call Hermes API
- `claude-code` → `exec('claude -p "..." --max-turns 5 --output-format json')`
- `codex` → `exec('codex "..." --quiet')`
- `custom` → user-defined handler

## Pitfalls

1. **sql.js requires manual save** — Unlike better-sqlite3, writes are NOT auto-persisted. Always call `saveDB()` after mutations and set up a periodic interval.

2. **ENOSPC on full drives** — sql.js `db.export()` writes the entire DB to disk. If the drive is full, it crashes with `ENOSPC`. **Check `df` BEFORE starting the project.** On Windows, use `df -h /c` and `df -h /d`. If C: is full, build on D: (or another drive with space). The symptom is silent data loss — writes fail but the server keeps running with stale in-memory data.

3. **`terminal(background=true)` on Windows needs `pty=true`** — Without it, Node.js processes crash with "stdin is not a tty". Always use `pty=True` for background server processes on Windows.

4. **Port conflicts** — Check `netstat -ano | grep ":PORT"` before starting. Kill with `taskkill //F //PID <pid>` (double-slash for MSYS). If port is in use, the server crashes with EADDRINUSE. Always check and kill before restart.

5. **better-sqlite3 needs C++ build tools** — On Windows without Visual Studio Build Tools, `npm install` fails for better-sqlite3. Use sql.js instead.

6. **SSE connection limits** — Browsers limit SSE connections per domain (~6). Don't open too many tabs. The auto-reconnect handles transient disconnects.

7. **Tailwind CDN is not for production** — The `cdn.tailwindcss.com` script is large and runs JIT in the browser. For production, use a proper Tailwind build step.

8. **Disk space check order** — Always `df -h` BEFORE `npm install` or `git clone`. On Windows with limited C: drive, the `node_modules` install can fill the drive. Pattern: check space → pick target directory → install → start. Never the reverse.

9. **Stress test timing** — Simulated agent replies are fast (5-50ms). Real LLM calls (Xiaomi MiMo, Claude) add 500-5000ms latency. When running stress tests with real APIs, use fewer messages (5-10) to avoid rate limits and timeouts.

## Reference files

- `references/agent-soul-memory-pattern.md` — Agent personality system with soul definitions, persistent memory, soul-aware chat, skills catalog
- `references/mission-control-repo-schema.md` — Full schema and API routes from the original GitHub repo (builderz-labs/mission-control v2.0.1)
- `references/local-implementation-notes.md` — Working instance details, seeded agents, API endpoints, known issues
