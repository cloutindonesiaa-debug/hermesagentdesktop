---
name: realtime-agent-orchestration
description: "Build real-time multi-agent orchestration dashboards — Express.js + sql.js + WebSocket/SSE, agent fleet management, inter-agent messaging with AI replies, task Kanban dispatch, stress testing. Use when user asks for mission control, agent dashboard, multi-agent coordination, agent-to-agent chat, or fleet monitoring."
version: 1.0.0
author: Hermes Agent
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [dashboard, agents, orchestration, websocket, sse, sqlite, express, kanban, multi-agent, stress-test]
    related_skills: [realtime-dashboard-express, team-orchestrator, claude-code, codex]
---

# Real-Time Agent Orchestration Dashboard

Build full-stack agent fleet management systems with real-time updates, inter-agent communication, task dispatch, and stress testing.

## When to Use

- User wants a "mission control" or "command center" for AI agents
- Multi-agent coordination dashboard with live status
- Agent-to-agent messaging/chat with AI-powered replies
- Task Kanban board with dispatch to different agent types
- Stress testing agent fleets with bulk tasks + messages
- Fleet monitoring with activity feeds and metrics

## Tech Stack

- **Backend**: Express.js + sql.js (pure JS SQLite, no native compile) + ws (WebSocket)
- **Frontend**: Single HTML SPA with Tailwind CSS (CDN) + dark futuristic UI
- **Real-time**: SSE (Server-Sent Events) primary + WebSocket backup
- **Database**: sql.js (NOT better-sqlite3 — see Pitfalls)

## Architecture

```
server.js          — Express backend: REST API + SSE + WebSocket + DB
public/index.html  — SPA dashboard: tabs for each panel
mission-control.db — SQLite database (auto-created)
```

### Database Schema (5 tables)

```sql
-- Core tables
agents       — id, name, role, type(hermes|claude-code|codex|custom), status(idle|busy|error), model, tasks_completed, total_tokens
tasks        — id, title, description, status(inbox|assigned|in_progress|done|failed), priority, assigned_to→agents, result, tags
activities   — id, type, entity_type, entity_id, actor, description, data(JSON)
messages     — id, from_agent_id→agents, to_agent_id→agents, channel, type(message|reply), content, metadata(JSON)
stress_tests — id, name, total_tasks, completed_tasks, failed_tasks, total_messages, avg_response_ms, status, results(JSON)
```

## Step-by-Step Build

### 1. Initialize Project

```bash
mkdir mission-control && cd mission-control
npm init -y
npm install express sql.js ws
mkdir public
```

### 2. Server Architecture

Key server patterns:

```javascript
// sql.js initialization (async required)
const initSqlJs = require('sql.js');
const SQL = await initSqlJs();
const db = fs.existsSync(DB_PATH)
  ? new SQL.Database(fs.readFileSync(DB_PATH))
  : new SQL.Database();

// Query helpers (sql.js API is different from better-sqlite3)
function queryAll(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

// SSE broadcast
const sseClients = new Set();
function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(res => { try { res.write(msg); } catch(e) { sseClients.delete(res); } });
}

// Auto-save DB to disk every 30s
setInterval(() => {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}, 30000);
```

### 3. Inter-Agent Messaging with AI Replies

```javascript
// Agent-to-agent chat endpoint
app.post('/api/messages/chat', async (req, res) => {
  const { from_agent_id, to_agent_id, content } = req.body;
  // Store outgoing message
  const msgId = runSQL('INSERT INTO messages ...', [...]);
  // Generate AI reply using LLM API or simulation
  const reply = await generateAgentReply(toAgent, fromAgent, content);
  const replyId = runSQL('INSERT INTO messages ...', [...]);
  res.json({ outgoing_id: msgId, reply_id: replyId, reply });
});

// LLM reply generator with fallback simulation
async function generateAgentReply(agent, fromAgent, message) {
  if (process.env.XIAOMI_API_KEY) {
    // Real API call
    const resp = await fetch(`${BASE_URL}/chat/completions`, { ... });
    return data.choices[0].message.content;
  } else {
    // Role-based simulated responses
    return simulateAgentReply(agent, fromAgent, message);
  }
}
```

### 4. Stress Test System

```javascript
// Phase 1: Create and dispatch tasks rapidly
for (let i = 0; i < numTasks; i++) {
  const agent = agents[i % agents.length];
  // INSERT task → UPDATE to in_progress → sleep(500-3000ms) → UPDATE to done
  broadcast('stress_test_progress', { phase: 'tasks', current: i+1, total: numTasks });
}

// Phase 2: Inter-agent messaging burst
for (let i = 0; i < numMessages; i++) {
  const from = agents[i % agents.length];
  const to = agents[(i + 1) % agents.length];
  // INSERT message → generate reply → INSERT reply
  broadcast('stress_test_progress', { phase: 'messages', current: i+1, total: numMessages });
}
```

### 5. Frontend Dashboard Tabs

| Tab | Content |
|-----|---------|
| Dashboard | Stats cards + mini Kanban + live activity feed |
| Agents | Fleet grid with status, dispatch, stats per agent |
| Tasks | Full Kanban (inbox→assigned→in_progress→done) + list view |
| Activity | Real-time event stream via SSE |
| Messages | Inter-agent chat history + send message modal |
| Stress Test | Quick/Medium/Heavy buttons + results dashboard |
| Cron Jobs | Schedule recurring tasks |

## Support Files

- `references/mission-control-template.md` — Complete server template, API endpoints, frontend tabs, UI design principles
- `references/github-skill-install.md` — Pattern for installing community skills from GitHub repos

## Pitfalls

1. **DO NOT use better-sqlite3 on Windows** — requires C++ build tools (node-gyp, Visual Studio Build Tools). Use `sql.js` instead — pure JavaScript, zero native compilation, same SQL syntax. On Linux/macOS better-sqlite3 is fine and faster.

2. **sql.js API is async for init** — `const SQL = await initSqlJs()` must complete before creating Database. Query methods are synchronous after that.

3. **sql.js query pattern differs from better-sqlite3**:
   - No `db.prepare(sql).all(params)` — use `stmt.step()` loop + `stmt.getAsObject()`
   - No `db.run(sql, params)` returning `{ lastInsertRowid }` — use `db.exec('SELECT last_insert_rowid()')`
   - Must call `stmt.free()` after each query
   - Must call `saveDB()` manually (no auto-persist)

4. **Background Node.js on Windows** — `terminal(background=true)` may fail with "stdin is not a tty". Use `pty=true` parameter to fix. See `hermes-windows-shell-quirks` skill.

5. **C: drive full on Windows** — Use D: drive or other available partition. Check with `df -h` before starting.

6. **SSE vs WebSocket** — SSE is simpler and more reliable for server→client push. Use WebSocket only if you need bidirectional. Implement both as fallback.

7. **JSON fields in sql.js** — `getAsObject()` returns raw strings for JSON columns. Must manually `JSON.parse()` in query helper.

8. **Agent reply simulation** — When no LLM API key is available, use role-based response templates. Each agent role (orchestrator, developer, researcher, automation) gets contextual responses. This enables demos without API costs.

## Related Skills

- `realtime-dashboard-express` — Simpler Express dashboard template (generic, no agent-specific features). This skill (`realtime-agent-orchestration`) is the agent-specific superset with messaging, dispatch, and stress testing.
- `team-orchestrator` — About delegating tasks to sub-agents via `delegate_task`. Complementary — that skill is about HOW to delegate, this skill is about BUILDING a dashboard to monitor and coordinate agents.
- `hermes-windows-shell-quirks` — Windows terminal workarounds. Relevant for pitfall #4 (background process pty=true).
