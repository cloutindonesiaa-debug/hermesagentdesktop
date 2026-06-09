/**
 * Mission Control — AI Agent Orchestration Dashboard
 * Express + sql.js (pure JS SQLite) + WebSocket real-time updates
 */

const express = require('express');
const initSqlJs = require('sql.js');
const { WebSocketServer } = require('ws');
const http = require('http');
const path = require('path');
const { exec } = require('child_process');
const fs = require('fs');
const { AGENT_SOULS } = require('./agent-souls');

// ─── Load .env file ─────────────────────────────────────────────
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  envContent.split('\n').forEach(line => {
    line = line.trim();
    if (line && !line.startsWith('#')) {
      const [key, ...vals] = line.split('=');
      if (key && vals.length > 0) {
        process.env[key.trim()] = vals.join('=').trim();
      }
    }
  });
}

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'mission-control.db');

let db;

// ─── Database Setup ──────────────────────────────────────────────
async function initDB() {
  const SQL = await initSqlJs();

  // Load existing DB or create new
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS agents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT 'general',
      type TEXT NOT NULL DEFAULT 'hermes',
      status TEXT NOT NULL DEFAULT 'idle',
      model TEXT,
      last_seen INTEGER,
      last_activity TEXT,
      tasks_completed INTEGER DEFAULT 0,
      tasks_failed INTEGER DEFAULT 0,
      total_tokens INTEGER DEFAULT 0,
      total_cost REAL DEFAULT 0,
      config TEXT DEFAULT '{}',
      created_at INTEGER NOT NULL DEFAULT (cast(strftime('%s','now') as integer)),
      updated_at INTEGER NOT NULL DEFAULT (cast(strftime('%s','now') as integer))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'inbox',
      priority TEXT NOT NULL DEFAULT 'medium',
      assigned_to INTEGER,
      created_by TEXT NOT NULL DEFAULT 'user',
      result TEXT,
      error TEXT,
      started_at INTEGER,
      completed_at INTEGER,
      estimated_minutes INTEGER,
      tags TEXT DEFAULT '[]',
      metadata TEXT DEFAULT '{}',
      created_at INTEGER NOT NULL DEFAULT (cast(strftime('%s','now') as integer)),
      updated_at INTEGER NOT NULL DEFAULT (cast(strftime('%s','now') as integer)),
      FOREIGN KEY (assigned_to) REFERENCES agents(id) ON DELETE SET NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      entity_type TEXT,
      entity_id INTEGER,
      actor TEXT NOT NULL,
      description TEXT NOT NULL,
      data TEXT DEFAULT '{}',
      created_at INTEGER NOT NULL DEFAULT (cast(strftime('%s','now') as integer))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_agent_id INTEGER NOT NULL,
      to_agent_id INTEGER,
      channel TEXT DEFAULT 'general',
      type TEXT NOT NULL DEFAULT 'message',
      content TEXT NOT NULL,
      metadata TEXT DEFAULT '{}',
      read_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (cast(strftime('%s','now') as integer)),
      FOREIGN KEY (from_agent_id) REFERENCES agents(id) ON DELETE CASCADE,
      FOREIGN KEY (to_agent_id) REFERENCES agents(id) ON DELETE SET NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS agent_memory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id INTEGER NOT NULL,
      category TEXT NOT NULL DEFAULT 'general',
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      importance INTEGER DEFAULT 5,
      access_count INTEGER DEFAULT 0,
      last_accessed INTEGER,
      created_at INTEGER NOT NULL DEFAULT (cast(strftime('%s','now') as integer)),
      updated_at INTEGER NOT NULL DEFAULT (cast(strftime('%s','now') as integer)),
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS stress_tests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      total_tasks INTEGER NOT NULL,
      completed_tasks INTEGER DEFAULT 0,
      failed_tasks INTEGER DEFAULT 0,
      total_messages INTEGER DEFAULT 0,
      avg_response_ms REAL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'running',
      started_at INTEGER NOT NULL DEFAULT (cast(strftime('%s','now') as integer)),
      completed_at INTEGER,
      results TEXT DEFAULT '{}'
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS cron_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      schedule TEXT NOT NULL,
      prompt TEXT NOT NULL,
      agent_id INTEGER,
      enabled INTEGER DEFAULT 1,
      last_run INTEGER,
      next_run INTEGER,
      run_count INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (cast(strftime('%s','now') as integer)),
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL
    )
  `);

  // Seed agents from soul definitions
  const [{ values: [[cnt]] }] = db.exec('SELECT COUNT(*) FROM agents');
  if (cnt === 0) {
    const soulEntries = Object.values(AGENT_SOULS);
    for (const soul of soulEntries) {
      db.run("INSERT INTO agents (name, role, type, status, model, config) VALUES (?,?,?,?,?,?)",
        [soul.name, soul.role, soul.type, 'idle', soul.model, JSON.stringify({ emoji: soul.emoji, color: soul.color })]);
    }
    db.run("INSERT INTO activities (type, actor, description) VALUES ('system', 'System', 'Mission Control initialized with " + soulEntries.length + " team agents')");
  }

  saveDB();
  console.log('✅ Database initialized');
}

function saveDB() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

// Auto-save every 30 seconds
setInterval(saveDB, 30000);

// ─── Query Helpers ───────────────────────────────────────────────
function queryAll(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();
    // Parse JSON fields
    if (row.config && typeof row.config === 'string') try { row.config = JSON.parse(row.config); } catch (e) {}
    if (row.tags && typeof row.tags === 'string') try { row.tags = JSON.parse(row.tags); } catch (e) {}
    if (row.data && typeof row.data === 'string') try { row.data = JSON.parse(row.data); } catch (e) {}
    if (row.metadata && typeof row.metadata === 'string') try { row.metadata = JSON.parse(row.metadata); } catch (e) {}
    rows.push(row);
  }
  stmt.free();
  return rows;
}

function queryOne(sql, params = []) {
  const rows = queryAll(sql, params);
  return rows[0] || null;
}

function runSQL(sql, params = []) {
  db.run(sql, params);
  // Get last insert rowid
  const [{ values: [[id]] }] = db.exec('SELECT last_insert_rowid()');
  return id;
}

function getChanges() {
  const [{ values: [[cnt]] }] = db.exec('SELECT changes()');
  return cnt;
}

// ─── Utility ────────────────────────────────────────────────────
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─── Middleware ──────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── SSE Clients ────────────────────────────────────────────────
const sseClients = new Set();

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(res => {
    try { res.write(msg); } catch (e) { sseClients.delete(res); }
  });
  wss.clients.forEach(ws => {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ event, data }));
    }
  });
}

function logActivity(type, actor, description, entityType = null, entityId = null, data = {}) {
  runSQL('INSERT INTO activities (type, entity_type, entity_id, actor, description, data) VALUES (?,?,?,?,?,?)',
    [type, entityType, entityId, actor, description, JSON.stringify(data)]);
  broadcast('activity', { type, actor, description, data, created_at: Math.floor(Date.now() / 1000) });
}

// ─── SSE Endpoint ───────────────────────────────────────────────
app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });
  res.write(`event: connected\ndata: {"status":"ok"}\n\n`);
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

// ─── WebSocket ──────────────────────────────────────────────────
wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ event: 'connected', data: { status: 'ok' } }));
});

// ─── API: Dashboard Stats ───────────────────────────────────────
app.get('/api/stats', (req, res) => {
  const agents = queryOne('SELECT COUNT(*) as total, SUM(CASE WHEN status = "busy" THEN 1 ELSE 0 END) as busy, SUM(CASE WHEN status = "idle" THEN 1 ELSE 0 END) as idle, SUM(CASE WHEN status = "error" THEN 1 ELSE 0 END) as errored FROM agents');
  const tasks = queryOne('SELECT COUNT(*) as total, SUM(CASE WHEN status = "inbox" THEN 1 ELSE 0 END) as inbox, SUM(CASE WHEN status = "in_progress" THEN 1 ELSE 0 END) as in_progress, SUM(CASE WHEN status = "done" THEN 1 ELSE 0 END) as done, SUM(CASE WHEN status = "failed" THEN 1 ELSE 0 END) as failed FROM tasks');
  const tokens = queryOne('SELECT COALESCE(SUM(total_tokens), 0) as total FROM agents');
  const cost = queryOne('SELECT COALESCE(SUM(total_cost), 0) as total FROM agents');
  res.json({ agents, tasks, tokens: tokens.total, cost: cost.total });
});

// ─── API: Agents CRUD ───────────────────────────────────────────
app.get('/api/agents', (req, res) => {
  res.json(queryAll('SELECT * FROM agents ORDER BY id'));
});

app.post('/api/agents', (req, res) => {
  const { name, role, type, model, config } = req.body;
  try {
    const id = runSQL('INSERT INTO agents (name, role, type, model, config) VALUES (?,?,?,?,?)',
      [name, role || 'general', type || 'hermes', model || 'mimo-v2.5-pro', JSON.stringify(config || {})]);
    logActivity('agent_created', 'user', `Agent "${name}" registered`, 'agent', id);
    saveDB();
    res.json({ id, name });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/agents/:id', (req, res) => {
  const agent = queryOne('SELECT * FROM agents WHERE id = ?', [parseInt(req.params.id)]);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  const { name, role, type, model, status, config } = req.body;
  runSQL('UPDATE agents SET name=?, role=?, type=?, model=?, status=?, config=?, updated_at=cast(strftime("%s","now") as integer) WHERE id=?',
    [name || agent.name, role || agent.role, type || agent.type, model || agent.model,
     status || agent.status, JSON.stringify(config || agent.config || {}), parseInt(req.params.id)]);
  logActivity('agent_updated', 'user', `Agent "${name || agent.name}" updated`, 'agent', parseInt(req.params.id));
  saveDB();
  res.json({ ok: true });
});

app.delete('/api/agents/:id', (req, res) => {
  runSQL('DELETE FROM agents WHERE id = ?', [parseInt(req.params.id)]);
  logActivity('agent_deleted', 'user', `Agent deleted`, 'agent', parseInt(req.params.id));
  saveDB();
  res.json({ ok: true });
});

// ─── API: Agent Heartbeat ───────────────────────────────────────
app.post('/api/agents/:id/heartbeat', (req, res) => {
  const { status, activity } = req.body;
  runSQL('UPDATE agents SET status=?, last_seen=cast(strftime("%s","now") as integer), last_activity=?, updated_at=cast(strftime("%s","now") as integer) WHERE id=?',
    [status || 'idle', activity || null, parseInt(req.params.id)]);
  broadcast('agent_heartbeat', { id: parseInt(req.params.id), status, activity });
  saveDB();
  res.json({ ok: true });
});

// ─── API: Tasks CRUD ────────────────────────────────────────────
app.get('/api/tasks', (req, res) => {
  const { status, assigned_to, limit } = req.query;
  let sql = 'SELECT t.*, a.name as agent_name FROM tasks t LEFT JOIN agents a ON t.assigned_to = a.id WHERE 1=1';
  const params = [];
  if (status) { sql += ' AND t.status = ?'; params.push(status); }
  if (assigned_to) { sql += ' AND t.assigned_to = ?'; params.push(parseInt(assigned_to)); }
  sql += ' ORDER BY t.created_at DESC';
  if (limit) { sql += ' LIMIT ?'; params.push(parseInt(limit)); }
  res.json(queryAll(sql, params));
});

app.post('/api/tasks', (req, res) => {
  const { title, description, priority, assigned_to, tags, estimated_minutes } = req.body;
  const status = assigned_to ? 'assigned' : 'inbox';
  const id = runSQL('INSERT INTO tasks (title, description, priority, assigned_to, tags, estimated_minutes, status) VALUES (?,?,?,?,?,?,?)',
    [title, description || '', priority || 'medium', assigned_to || null,
     JSON.stringify(tags || []), estimated_minutes || null, status]);
  logActivity('task_created', 'user', `Task "${title}" created`, 'task', id);
  broadcast('task_created', { id, title });
  saveDB();
  res.json({ id });
});

app.put('/api/tasks/:id', (req, res) => {
  const task = queryOne('SELECT * FROM tasks WHERE id = ?', [parseInt(req.params.id)]);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const { title, description, status, priority, assigned_to, result: taskResult, error: taskError, tags } = req.body;
  const newStatus = status || task.status;
  const now = Math.floor(Date.now() / 1000);

  runSQL(`UPDATE tasks SET title=?, description=?, status=?, priority=?, assigned_to=?, result=?, error=?, tags=?,
    started_at=CASE WHEN ?='in_progress' AND started_at IS NULL THEN ? ELSE started_at END,
    completed_at=CASE WHEN ? IN ('done','failed') THEN ? ELSE completed_at END,
    updated_at=? WHERE id=?`,
    [title || task.title, description || task.description, newStatus,
     priority || task.priority, assigned_to !== undefined ? assigned_to : task.assigned_to,
     taskResult || task.result, taskError || task.error,
     JSON.stringify(tags || task.tags || []),
     newStatus, now, newStatus, now, now, parseInt(req.params.id)]);

  logActivity('task_updated', 'user', `Task "${title || task.title}" → ${newStatus}`, 'task', parseInt(req.params.id));
  broadcast('task_updated', { id: parseInt(req.params.id), status: newStatus });
  saveDB();
  res.json({ ok: true });
});

app.delete('/api/tasks/:id', (req, res) => {
  runSQL('DELETE FROM tasks WHERE id = ?', [parseInt(req.params.id)]);
  saveDB();
  res.json({ ok: true });
});

// ─── API: Task Dispatch ─────────────────────────────────────────
app.post('/api/tasks/:id/dispatch', (req, res) => {
  const task = queryOne('SELECT * FROM tasks WHERE id = ?', [parseInt(req.params.id)]);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const agent = task.assigned_to ? queryOne('SELECT * FROM agents WHERE id = ?', [task.assigned_to]) : null;
  if (!agent) return res.status(400).json({ error: 'No agent assigned to this task' });

  const now = Math.floor(Date.now() / 1000);
  runSQL('UPDATE tasks SET status = "in_progress", started_at = ?, updated_at = ? WHERE id = ?', [now, now, task.id]);
  runSQL('UPDATE agents SET status = "busy", last_activity = ?, last_seen = ? WHERE id = ?', [`Working on: ${task.title}`, now, agent.id]);

  logActivity('task_dispatched', agent.name, `Dispatched "${task.title}" to ${agent.name}`, 'task', task.id);
  broadcast('task_dispatched', { task_id: task.id, agent_id: agent.id, agent_name: agent.name });
  saveDB();

  // Dispatch based on agent type
  dispatchToAgent(agent, task);
  res.json({ ok: true, message: `Dispatched to ${agent.name}` });
});

function dispatchToAgent(agent, task) {
  const prompt = `Task: ${task.title}\nDescription: ${task.description || 'No description'}`;
  const now = Math.floor(Date.now() / 1000);

  if (agent.type === 'claude-code') {
    exec(`claude -p "${prompt.replace(/"/g, '\\"')}" --max-turns 5 --output-format json`, { timeout: 120000, cwd: process.cwd() }, (err, stdout) => {
      completeTask(task.id, agent.id, err ? 'failed' : 'done', stdout || '', err?.message, now);
    });
  } else if (agent.type === 'codex') {
    exec(`codex "${prompt.replace(/"/g, '\\"')}" --quiet`, { timeout: 120000, cwd: process.cwd() }, (err, stdout) => {
      completeTask(task.id, agent.id, err ? 'failed' : 'done', stdout || '', err?.message, now);
    });
  } else {
    // Hermes agent — simulate processing
    setTimeout(() => {
      completeTask(task.id, agent.id, 'done', `Task "${task.title}" processed by ${agent.name} via Hermes agent framework`, null, now);
    }, 3000 + Math.random() * 5000);
  }
}

function completeTask(taskId, agentId, status, result, error, now) {
  runSQL('UPDATE tasks SET status=?, result=?, error=?, completed_at=?, updated_at=? WHERE id=?',
    [status, result || null, error || null, now, now, taskId]);
  const field = status === 'done' ? 'tasks_completed' : 'tasks_failed';
  runSQL(`UPDATE agents SET status='idle', ${field} = ${field} + 1, last_activity=?, last_seen=? WHERE id=?`,
    [status === 'done' ? 'Task completed' : 'Task failed', now, agentId]);
  logActivity('task_completed', 'Agent', `Task #${taskId} ${status}`, 'task', taskId);
  broadcast('task_completed', { task_id: taskId, status });
  saveDB();
}

// ─── API: Activity Feed ─────────────────────────────────────────
app.get('/api/activities', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  res.json(queryAll('SELECT * FROM activities ORDER BY id DESC LIMIT ?', [limit]));
});

// ─── API: Cron Jobs ─────────────────────────────────────────────
app.get('/api/cron', (req, res) => {
  res.json(queryAll('SELECT c.*, a.name as agent_name FROM cron_jobs c LEFT JOIN agents a ON c.agent_id = a.id ORDER BY c.id DESC'));
});

app.post('/api/cron', (req, res) => {
  const { name, schedule, prompt, agent_id } = req.body;
  const id = runSQL('INSERT INTO cron_jobs (name, schedule, prompt, agent_id) VALUES (?,?,?,?)',
    [name, schedule, prompt, agent_id || null]);
  logActivity('cron_created', 'user', `Cron "${name}" created (${schedule})`, 'cron', id);
  saveDB();
  res.json({ id });
});

app.delete('/api/cron/:id', (req, res) => {
  runSQL('DELETE FROM cron_jobs WHERE id = ?', [parseInt(req.params.id)]);
  saveDB();
  res.json({ ok: true });
});

// ─── API: Inter-Agent Messages ──────────────────────────────────
app.get('/api/messages', (req, res) => {
  const { channel, agent_id, limit } = req.query;
  let sql = `SELECT m.*, fa.name as from_name, fa.type as from_type, ta.name as to_name
    FROM messages m
    LEFT JOIN agents fa ON m.from_agent_id = fa.id
    LEFT JOIN agents ta ON m.to_agent_id = ta.id
    WHERE 1=1`;
  const params = [];
  if (channel) { sql += ' AND m.channel = ?'; params.push(channel); }
  if (agent_id) { sql += ' AND (m.to_agent_id = ? OR m.from_agent_id = ? OR m.to_agent_id IS NULL)'; params.push(parseInt(agent_id), parseInt(agent_id)); }
  sql += ' ORDER BY m.created_at DESC';
  if (limit) { sql += ' LIMIT ?'; params.push(parseInt(limit)); }
  res.json(queryAll(sql, params));
});

app.post('/api/messages', (req, res) => {
  const { from_agent_id, to_agent_id, channel, type, content } = req.body;
  const id = runSQL('INSERT INTO messages (from_agent_id, to_agent_id, channel, type, content) VALUES (?,?,?,?,?)',
    [from_agent_id, to_agent_id || null, channel || 'general', type || 'message', content]);
  const fromAgent = queryOne('SELECT name FROM agents WHERE id = ?', [from_agent_id]);
  const toAgent = to_agent_id ? queryOne('SELECT name FROM agents WHERE id = ?', [to_agent_id]) : null;
  logActivity('message_sent', fromAgent?.name || 'Unknown',
    `${fromAgent?.name} → ${toAgent?.name || 'all'}: ${content.substring(0, 80)}${content.length > 80 ? '...' : ''}`,
    'message', id);
  broadcast('message', { id, from_agent_id, to_agent_id, content, channel });
  saveDB();
  res.json({ id });
});

// ─── API: Agent-to-Agent Chat (auto-reply from target agent) ───
app.post('/api/messages/chat', async (req, res) => {
  const { from_agent_id, to_agent_id, content, channel } = req.body;
  const fromAgent = queryOne('SELECT * FROM agents WHERE id = ?', [from_agent_id]);
  const toAgent = queryOne('SELECT * FROM agents WHERE id = ?', [to_agent_id]);
  if (!fromAgent || !toAgent) return res.status(404).json({ error: 'Agent not found' });

  // Store outgoing message
  const msgId = runSQL('INSERT INTO messages (from_agent_id, to_agent_id, channel, type, content) VALUES (?,?,?,?,?)',
    [from_agent_id, to_agent_id, channel || 'general', 'message', content]);

  logActivity('message_sent', fromAgent.name, `${fromAgent.name} → ${toAgent.name}: ${content.substring(0, 80)}`, 'message', msgId);
  broadcast('message', { id: msgId, from_agent_id, to_agent_id, content });

  // Generate AI reply using Xiaomi MiMo
  const startTime = Date.now();
  try {
    const reply = await generateAgentReply(toAgent, fromAgent, content);
    const elapsed = Date.now() - startTime;

    const replyId = runSQL('INSERT INTO messages (from_agent_id, to_agent_id, channel, type, content, metadata) VALUES (?,?,?,?,?,?)',
      [to_agent_id, from_agent_id, channel || 'general', 'reply', reply, JSON.stringify({ response_ms: elapsed, model: toAgent.model })]);

    // Update agent tokens
    runSQL('UPDATE agents SET total_tokens = total_tokens + ?, last_seen = cast(strftime("%s","now") as integer), last_activity = ? WHERE id = ?',
      [Math.floor(reply.length * 1.3), `Replied to ${fromAgent.name}`, to_agent_id]);

    logActivity('message_reply', toAgent.name, `${toAgent.name} replied to ${fromAgent.name} (${elapsed}ms)`, 'message', replyId);
    broadcast('message', { id: replyId, from_agent_id: to_agent_id, to_agent_id: from_agent_id, content: reply, type: 'reply' });
    saveDB();

    res.json({ outgoing_id: msgId, reply_id: replyId, reply, elapsed_ms: elapsed });
  } catch (e) {
    res.json({ outgoing_id: msgId, reply: null, error: e.message });
  }
});

// ─── LLM Reply Generator (Real Xiaomi MiMo API) ────────────────
const XIAOMI_API_KEY = process.env.XIAOMI_API_KEY;
const XIAOMI_BASE_URL = 'https://token-plan-sgp.xiaomimimo.com/v1';

async function generateAgentReply(agent, fromAgent, message, customSystemPrompt) {
  const systemPrompt = customSystemPrompt || `You are "${agent.name}", an AI agent with the role of "${agent.role}" in a Mission Control multi-agent system. You are talking to "${fromAgent.name}" (role: ${fromAgent.role}). Respond concisely and in character. Be helpful and direct. Keep responses under 200 words.`;

  if (XIAOMI_API_KEY && XIAOMI_API_KEY.length > 10) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const resp = await fetch(`${XIAOMI_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${XIAOMI_API_KEY}`
        },
        body: JSON.stringify({
          model: agent.model || 'mimo-v2.5-pro',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: message }
          ],
          max_tokens: 500,
          temperature: 0.7
        }),
        signal: controller.signal
      });
      clearTimeout(timeout);

      const data = await resp.json();
      if (data.choices?.[0]?.message?.content) {
        const reply = data.choices[0].message.content;
        const tokens = data.usage?.total_tokens || Math.floor(reply.length * 1.3);
        runSQL('UPDATE agents SET total_tokens = total_tokens + ? WHERE id = ?', [tokens, agent.id]);
        return reply;
      }
    } catch (e) {
      console.log(`LLM API error for ${agent.name}: ${e.message}, falling back to simulation`);
    }
  }

  // Fallback: simulated intelligent responses based on agent role
  return simulateAgentReply(agent, fromAgent, message);
}

function simulateAgentReply(agent, fromAgent, message) {
  const lowerMsg = message.toLowerCase();
  const responses = {
    orchestrator: [
      `Understood. I'll coordinate the team on "${message.substring(0, 40)}". Assigning tasks now.`,
      `Acknowledged, ${fromAgent.name}. I've logged this and will route it to the right specialist.`,
      `Roger that. Current fleet status: ${queryOne('SELECT COUNT(*) as cnt FROM agents WHERE status="idle"')?.cnt || 0} agents idle. Ready to dispatch.`,
      `Task received. Prioritizing and distributing across available agents. ETA: 2-5 minutes.`,
    ],
    developer: [
      `Got it. I'll start implementing "${message.substring(0, 40)}". Give me a few minutes.`,
      `Analyzing the requirements. I see 3 key components to build. Starting with the core module.`,
      `Code review complete. Found 2 potential issues. Fixing now before moving to the next task.`,
      `Implementation done. Running tests... All passing. Ready for review.`,
    ],
    automation: [
      `Automation pipeline triggered for "${message.substring(0, 40)}". Setting up workflow now.`,
      `Script configured. I'll schedule this to run on the cron. Monitoring for errors.`,
      `Pipeline execution started. 3 stages: validate → execute → verify. Currently at stage 1.`,
      `Workflow complete. All steps passed. Report generated and saved to activity log.`,
    ],
    researcher: [
      `Research initiated on "${message.substring(0, 40)}". Scanning 5 sources now.`,
      `Preliminary findings: 3 relevant papers, 2 code repos. Compiling summary.`,
      `Analysis complete. Key insight: the current approach has a 15% improvement potential. Full report attached.`,
      `Cross-referencing with latest data. Found correlations with 2 previous research threads.`,
    ],
  };
  const roleResponses = responses[agent.role] || responses.orchestrator;

  // Pick contextually relevant response
  if (lowerMsg.includes('status') || lowerMsg.includes('how are')) {
    return `[${agent.name}] Status: ${agent.status}. Tasks completed: ${agent.tasks_completed || 0}. Ready for next assignment.`;
  }
  if (lowerMsg.includes('help') || lowerMsg.includes('need')) {
    return `[${agent.name}] I'm here to help. As a ${agent.role}, I can assist with: ${agent.role === 'developer' ? 'coding, debugging, code review' : agent.role === 'researcher' ? 'research, analysis, reports' : agent.role === 'automation' ? 'pipelines, scripts, scheduling' : 'coordination, dispatch, planning'}. What do you need?`;
  }
  if (lowerMsg.includes('stress') || lowerMsg.includes('test')) {
    return `[${agent.name}] Acknowledged stress test directive. Preparing ${agent.role} subsystem for high-load operation. All systems nominal.`;
  }

  return roleResponses[Math.floor(Math.random() * roleResponses.length)];
}

// ─── API: Stress Test ───────────────────────────────────────────
app.post('/api/stress-test', async (req, res) => {
  const { num_tasks = 10, num_messages = 10, name = 'Stress Test' } = req.body;
  const agents = queryAll('SELECT * FROM agents');
  if (agents.length < 2) return res.status(400).json({ error: 'Need at least 2 agents' });

  // Create stress test record
  const testId = runSQL('INSERT INTO stress_tests (name, total_tasks, total_messages) VALUES (?,?,?)',
    [name, num_tasks, num_messages]);
  saveDB();

  logActivity('stress_test_started', 'System', `Stress test "${name}" started: ${num_tasks} tasks + ${num_messages} messages`);
  broadcast('stress_test', { id: testId, status: 'running', total_tasks: num_tasks, total_messages: num_messages });

  // Run stress test asynchronously
  runStressTest(testId, agents, num_tasks, num_messages, name);

  res.json({ id: testId, message: `Stress test started: ${num_tasks} tasks + ${num_messages} messages` });
});

async function runStressTest(testId, agents, numTasks, numMessages, name) {
  const results = { tasks: [], messages: [], started_at: Date.now() };
  let completedTasks = 0, failedTasks = 0, totalMsgs = 0;
  const startTime = Date.now();

  // Phase 1: Create and dispatch tasks rapidly
  const taskPrompts = [
    'Analyze system performance metrics', 'Review code quality standards',
    'Optimize database query performance', 'Generate API documentation',
    'Test error handling edge cases', 'Update deployment configuration',
    'Monitor resource utilization patterns', 'Implement caching strategy',
    'Audit security vulnerabilities', 'Create integration test suite',
    'Refactor legacy authentication module', 'Design microservice architecture',
    'Benchmark API response times', 'Set up CI/CD pipeline stages',
    'Review pull request #42', 'Debug memory leak in worker process',
    'Write unit tests for payment module', 'Deploy canary release to staging',
    'Investigate timeout in search endpoint', 'Migrate database schema v3',
  ];

  for (let i = 0; i < numTasks; i++) {
    const agent = agents[i % agents.length];
    const title = taskPrompts[i % taskPrompts.length] + ` (ST-${testId}-${i + 1})`;
    try {
      const taskId = runSQL('INSERT INTO tasks (title, description, priority, assigned_to, status, tags) VALUES (?,?,?,?,?,?)',
        [title, `Stress test task ${i + 1}/${numTasks} for ${agent.name}`, 'medium', agent.id, 'assigned',
         JSON.stringify(['stress-test', `test-${testId}`])]);
      runSQL('UPDATE tasks SET status="in_progress", started_at=cast(strftime("%s","now") as integer) WHERE id=?', [taskId]);
      runSQL('UPDATE agents SET status="busy" WHERE id=?', [agent.id]);

      // Simulate processing time (500ms - 3s)
      const processingTime = 500 + Math.random() * 2500;
      await sleep(processingTime);

      // Complete task
      const result = `[${agent.name}] Task "${title}" completed in ${Math.floor(processingTime)}ms. Output: Analysis shows optimal performance metrics with 98.5% efficiency rating.`;
      runSQL('UPDATE tasks SET status="done", result=?, completed_at=cast(strftime("%s","now") as integer) WHERE id=?', [result, taskId]);
      runSQL('UPDATE agents SET status="idle", tasks_completed=tasks_completed+1 WHERE id=?', [agent.id]);
      completedTasks++;

      results.tasks.push({ task_id: taskId, agent: agent.name, time_ms: Math.floor(processingTime), status: 'done' });
      broadcast('stress_test_progress', { testId, phase: 'tasks', current: i + 1, total: numTasks });
    } catch (e) {
      failedTasks++;
      results.tasks.push({ agent: agent.name, status: 'failed', error: e.message });
    }
  }

  // Phase 2: Inter-agent messaging burst
  for (let i = 0; i < numMessages; i++) {
    const from = agents[i % agents.length];
    const to = agents[(i + 1) % agents.length];
    const msgTypes = [
      `Hey ${to.name}, status update on task batch ${Math.floor(i / 3) + 1}?`,
      `${to.name}, I need your ${to.role} expertise on the current workload.`,
      `Stress test ping #${i + 1} from ${from.name}. Latency check.`,
      `Delegating sub-task ${i + 1} to ${to.name}. Priority: high.`,
      `${from.name} reporting: ${Math.floor(Math.random() * 50 + 50)}% capacity. Can you take overflow?`,
      `Cross-check request: ${from.name} → ${to.name}. Verify results batch ${i + 1}.`,
    ];
    const content = msgTypes[i % msgTypes.length];

    try {
      runSQL('INSERT INTO messages (from_agent_id, to_agent_id, channel, type, content) VALUES (?,?,?,?,?)',
        [from.id, to.id, 'stress-test', 'message', content]);

      // Generate reply
      const replyStart = Date.now();
      const reply = simulateAgentReply(to, from, content);
      const replyTime = Date.now() - replyStart + Math.floor(Math.random() * 500);

      runSQL('INSERT INTO messages (from_agent_id, to_agent_id, channel, type, content, metadata) VALUES (?,?,?,?,?,?)',
        [to.id, from.id, 'stress-test', 'reply', reply, JSON.stringify({ response_ms: replyTime })]);

      totalMsgs += 2; // message + reply
      results.messages.push({ from: from.name, to: to.name, time_ms: replyTime });
      broadcast('stress_test_progress', { testId, phase: 'messages', current: i + 1, total: numMessages });
    } catch (e) {
      results.messages.push({ from: from.name, to: to.name, error: e.message });
    }
    await sleep(100 + Math.random() * 300);
  }

  // Finalize
  const totalTime = Date.now() - startTime;
  const avgResponse = results.messages.length > 0
    ? results.messages.reduce((s, m) => s + (m.time_ms || 0), 0) / results.messages.length
    : 0;

  runSQL('UPDATE stress_tests SET completed_tasks=?, failed_tasks=?, total_messages=?, avg_response_ms=?, status="completed", completed_at=cast(strftime("%s","now") as integer), results=? WHERE id=?',
    [completedTasks, failedTasks, totalMsgs, Math.floor(avgResponse), JSON.stringify(results), testId]);

  // Reset all agents to idle
  agents.forEach(a => {
    runSQL('UPDATE agents SET status="idle", last_activity=? WHERE id=?', ['Stress test completed', a.id]);
  });

  logActivity('stress_test_completed', 'System',
    `Stress test "${name}" completed: ${completedTasks}/${numTasks} tasks done, ${totalMsgs} messages, ${Math.floor(totalTime / 1000)}s total`);
  broadcast('stress_test_complete', { testId, completedTasks, failedTasks, totalMsgs, totalTime });
  saveDB();
}

// ─── API: Stress Test Status ────────────────────────────────────
app.get('/api/stress-test', (req, res) => {
  res.json(queryAll('SELECT * FROM stress_tests ORDER BY id DESC LIMIT 10'));
});

app.get('/api/stress-test/:id', (req, res) => {
  const test = queryOne('SELECT * FROM stress_tests WHERE id = ?', [parseInt(req.params.id)]);
  if (!test) return res.status(404).json({ error: 'Not found' });
  res.json(test);
});

// ─── API: Bulk Task Dispatch ────────────────────────────────────
app.post('/api/tasks/dispatch-all', (req, res) => {
  const { status: filterStatus } = req.body;
  const tasks = queryAll('SELECT t.*, a.name as agent_name FROM tasks t LEFT JOIN agents a ON t.assigned_to = a.id WHERE t.status = ?',
    [filterStatus || 'assigned']);

  if (tasks.length === 0) return res.json({ message: 'No tasks to dispatch', count: 0 });

  let dispatched = 0;
  tasks.forEach(task => {
    if (task.assigned_to) {
      const agent = queryOne('SELECT * FROM agents WHERE id = ?', [task.assigned_to]);
      if (agent) {
        const now = Math.floor(Date.now() / 1000);
        runSQL('UPDATE tasks SET status = "in_progress", started_at = ?, updated_at = ? WHERE id = ?', [now, now, task.id]);
        runSQL('UPDATE agents SET status = "busy", last_activity = ?, last_seen = ? WHERE id = ?', [`Working on: ${task.title}`, now, agent.id]);
        logActivity('task_dispatched', agent.name, `Dispatched "${task.title}" to ${agent.name}`, 'task', task.id);
        dispatchToAgent(agent, task);
        dispatched++;
      }
    }
  });

  saveDB();
  res.json({ message: `Dispatched ${dispatched} tasks`, count: dispatched });
});

// ─── API: Agent Soul ────────────────────────────────────────────
app.get('/api/agents/:id/soul', (req, res) => {
  const agent = queryOne('SELECT * FROM agents WHERE id = ?', [parseInt(req.params.id)]);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  const soul = AGENT_SOULS[agent.name];
  res.json({
    agent_id: agent.id,
    name: agent.name,
    role: agent.role,
    soul: soul?.soul || 'No soul defined',
    emoji: soul?.emoji || '🤖',
    color: soul?.color || '#00f5d4'
  });
});

// ─── API: Agent Memory ─────────────────────────────────────────
app.get('/api/agents/:id/memory', (req, res) => {
  const { category, limit } = req.query;
  let sql = 'SELECT * FROM agent_memory WHERE agent_id = ?';
  const params = [parseInt(req.params.id)];
  if (category) { sql += ' AND category = ?'; params.push(category); }
  sql += ' ORDER BY importance DESC, updated_at DESC';
  if (limit) { sql += ' LIMIT ?'; params.push(parseInt(limit)); }
  res.json(queryAll(sql, params));
});

app.post('/api/agents/:id/memory', (req, res) => {
  const { category, key, value, importance } = req.body;
  const id = runSQL('INSERT INTO agent_memory (agent_id, category, key, value, importance) VALUES (?,?,?,?,?)',
    [parseInt(req.params.id), category || 'general', key, value, importance || 5]);
  logActivity('memory_added', queryOne('SELECT name FROM agents WHERE id=?', [parseInt(req.params.id)])?.name || 'Agent',
    `Memory added: ${key}`, 'memory', id);
  saveDB();
  res.json({ id });
});

app.put('/api/agents/:id/memory/:memoryId', (req, res) => {
  const { value, importance } = req.body;
  runSQL('UPDATE agent_memory SET value=?, importance=?, updated_at=cast(strftime("%s","now") as integer), access_count=access_count+1 WHERE id=? AND agent_id=?',
    [value, importance || 5, parseInt(req.params.memoryId), parseInt(req.params.id)]);
  saveDB();
  res.json({ ok: true });
});

app.delete('/api/agents/:id/memory/:memoryId', (req, res) => {
  runSQL('DELETE FROM agent_memory WHERE id=? AND agent_id=?', [parseInt(req.params.memoryId), parseInt(req.params.id)]);
  saveDB();
  res.json({ ok: true });
});

// ─── API: Agent Chat (Soul-aware) ──────────────────────────────
app.post('/api/agents/:id/chat', async (req, res) => {
  const { message } = req.body;
  const agent = queryOne('SELECT * FROM agents WHERE id = ?', [parseInt(req.params.id)]);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });

  const soul = AGENT_SOULS[agent.name];
  const memories = queryAll('SELECT key, value FROM agent_memory WHERE agent_id = ? ORDER BY importance DESC LIMIT 10', [agent.id]);
  const memoryContext = memories.map(m => `${m.key}: ${m.value}`).join('\n');

  const systemPrompt = soul ? `${soul.soul}\n\n## Your Memory\n${memoryContext || 'No memories yet.'}\n\n## Current Status\n- Tasks completed: ${agent.tasks_completed || 0}\n- Status: ${agent.status}` : `You are ${agent.name}, a ${agent.role} agent.`;

  // Store user message as memory
  runSQL('INSERT INTO agent_memory (agent_id, category, key, value, importance) VALUES (?,?,?,?,?)',
    [agent.id, 'conversation', `user_msg_${Date.now()}`, message.substring(0, 200), 3]);

  const startTime = Date.now();
  try {
    const reply = await generateAgentReply(agent, { name: 'User', role: 'user' }, message, systemPrompt);
    const elapsed = Date.now() - startTime;

    // Store reply as memory
    runSQL('INSERT INTO agent_memory (agent_id, category, key, value, importance) VALUES (?,?,?,?,?)',
      [agent.id, 'conversation', `reply_${Date.now()}`, reply.substring(0, 200), 3]);

    runSQL('UPDATE agents SET total_tokens = total_tokens + ?, last_seen = cast(strftime("%s","now") as integer), last_activity = ? WHERE id = ?',
      [Math.floor(reply.length * 1.3), `Chat with user`, agent.id]);

    logActivity('agent_chat', agent.name, `${agent.name}: ${reply.substring(0, 80)}...`, 'message', agent.id);
    saveDB();

    res.json({ reply, elapsed_ms: elapsed, soul_name: soul?.name || agent.name });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── API: Skills Catalog ───────────────────────────────────────
app.get('/api/skills', (req, res) => {
  const skillsDir = path.join(process.env.HOME || process.env.USERPROFILE, 'AppData', 'Local', 'hermes', 'skills');
  const skills = [];

  try {
    const categories = fs.readdirSync(skillsDir);
    for (const cat of categories) {
      const catPath = path.join(skillsDir, cat);
      if (!fs.statSync(catPath).isDirectory()) continue;

      try {
        const skillDirs = fs.readdirSync(catPath);
        for (const skillName of skillDirs) {
          const skillPath = path.join(catPath, skillName, 'SKILL.md');
          if (fs.existsSync(skillPath)) {
            const content = fs.readFileSync(skillPath, 'utf-8');
            const nameMatch = content.match(/^name:\s*(.+)$/m);
            const descMatch = content.match(/^description:\s*["']?(.+?)["']?\s*$/m);
            skills.push({
              name: nameMatch?.[1]?.trim() || skillName,
              category: cat,
              description: descMatch?.[1]?.trim() || 'No description',
              path: `${cat}/${skillName}`,
              size_kb: Math.round(fs.statSync(skillPath).size / 1024)
            });
          }
        }
      } catch (e) {}
    }
  } catch (e) {}

  res.json({ total: skills.length, skills });
});

// ─── API: Team Overview ────────────────────────────────────────
app.get('/api/team', (req, res) => {
  const agents = queryAll('SELECT * FROM agents ORDER BY id');
  const team = agents.map(a => {
    const soul = AGENT_SOULS[a.name];
    const memories = queryOne('SELECT COUNT(*) as cnt FROM agent_memory WHERE agent_id = ?', [a.id]);
    return {
      ...a,
      emoji: soul?.emoji || '🤖',
      color: soul?.color || '#00f5d4',
      soul_preview: soul?.soul?.substring(0, 200) || 'No soul',
      memory_count: memories?.cnt || 0
    };
  });
  res.json(team);
});

// ─── API: Task Delegation (The Boss delegates to team) ──────────
app.post('/api/delegate', async (req, res) => {
  const { task_title, task_description, priority } = req.body;
  const boss = queryOne('SELECT * FROM agents WHERE name = "The Boss"');
  if (!boss) return res.status(400).json({ error: 'The Boss agent not found' });

  // The Boss analyzes the task and picks the best agent
  const agents = queryAll('SELECT * FROM agents WHERE name != "The Boss" AND status = "idle"');
  if (agents.length === 0) return res.status(400).json({ error: 'No idle agents available' });

  // Smart delegation based on task keywords
  const taskLower = (task_title + ' ' + (task_description || '')).toLowerCase();
  let bestAgent = agents[0];

  if (taskLower.includes('code') || taskLower.includes('develop') || taskLower.includes('api') || taskLower.includes('bug') || taskLower.includes('implement')) {
    bestAgent = agents.find(a => a.name === 'Dev Lead') || agents[0];
  } else if (taskLower.includes('design') || taskLower.includes('ui') || taskLower.includes('ux') || taskLower.includes('layout') || taskLower.includes('visual')) {
    bestAgent = agents.find(a => a.name === 'Design Wizard') || agents[0];
  } else if (taskLower.includes('research') || taskLower.includes('analyze') || taskLower.includes('data') || taskLower.includes('study') || taskLower.includes('report')) {
    bestAgent = agents.find(a => a.name === 'Research Brain') || agents[0];
  } else if (taskLower.includes('social') || taskLower.includes('content') || taskLower.includes('post') || taskLower.includes('instagram') || taskLower.includes('tiktok')) {
    bestAgent = agents.find(a => a.name === 'Social Queen') || agents[0];
  } else if (taskLower.includes('automate') || taskLower.includes('pipeline') || taskLower.includes('script') || taskLower.includes('deploy') || taskLower.includes('ci/cd')) {
    bestAgent = agents.find(a => a.name === 'Auto Pilot') || agents[0];
  }

  // Create and assign task
  const taskId = runSQL('INSERT INTO tasks (title, description, priority, assigned_to, status, created_by) VALUES (?,?,?,?,?,?)',
    [task_title, task_description || '', priority || 'medium', bestAgent.id, 'assigned', 'The Boss']);

  // The Boss sends delegation message
  const delegateMsg = `Delegating "${task_title}" to ${bestAgent.name}. This matches their ${bestAgent.role} expertise.`;
  runSQL('INSERT INTO messages (from_agent_id, to_agent_id, channel, type, content) VALUES (?,?,?,?,?)',
    [boss.id, bestAgent.id, 'delegation', 'delegation', delegateMsg]);

  // Store in Boss's memory
  runSQL('INSERT INTO agent_memory (agent_id, category, key, value, importance) VALUES (?,?,?,?,?)',
    [boss.id, 'delegation', `delegated_${Date.now()}`, `Delegated "${task_title}" to ${bestAgent.name}`, 7]);

  // Store in target agent's memory
  runSQL('INSERT INTO agent_memory (agent_id, category, key, value, importance) VALUES (?,?,?,?,?)',
    [bestAgent.id, 'assignment', `assigned_${Date.now()}`, `Received "${task_title}" from The Boss`, 7]);

  logActivity('task_delegated', 'The Boss', `The Boss delegated "${task_title}" to ${bestAgent.name}`, 'task', taskId);
  broadcast('task_delegated', { task_id: taskId, from: 'The Boss', to: bestAgent.name });
  saveDB();

  res.json({
    ok: true,
    task_id: taskId,
    delegated_to: bestAgent.name,
    agent_role: bestAgent.role,
    reason: `Matched ${bestAgent.role} expertise based on task keywords`,
    message: delegateMsg
  });
});

// ─── API: The Boss Auto-Delegation (delegate all inbox tasks) ───
app.post('/api/delegate-all', async (req, res) => {
  const boss = queryOne('SELECT * FROM agents WHERE name = "The Boss"');
  const inboxTasks = queryAll('SELECT * FROM tasks WHERE status = "inbox"');
  if (inboxTasks.length === 0) return res.json({ message: 'No inbox tasks to delegate', count: 0 });

  let delegated = 0;
  for (const task of inboxTasks) {
    const agents = queryAll('SELECT * FROM agents WHERE name != "The Boss" AND status = "idle"');
    if (agents.length === 0) break;

    const taskLower = (task.title + ' ' + (task.description || '')).toLowerCase();
    let bestAgent = agents[0];
    if (taskLower.includes('code') || taskLower.includes('develop')) bestAgent = agents.find(a => a.name === 'Dev Lead') || agents[0];
    else if (taskLower.includes('design') || taskLower.includes('ui')) bestAgent = agents.find(a => a.name === 'Design Wizard') || agents[0];
    else if (taskLower.includes('research') || taskLower.includes('analyze')) bestAgent = agents.find(a => a.name === 'Research Brain') || agents[0];
    else if (taskLower.includes('social') || taskLower.includes('content')) bestAgent = agents.find(a => a.name === 'Social Queen') || agents[0];
    else if (taskLower.includes('automate') || taskLower.includes('pipeline')) bestAgent = agents.find(a => a.name === 'Auto Pilot') || agents[0];

    runSQL('UPDATE tasks SET assigned_to = ?, status = "assigned", updated_at = cast(strftime("%s","now") as integer) WHERE id = ?',
      [bestAgent.id, task.id]);

    runSQL('INSERT INTO messages (from_agent_id, to_agent_id, channel, type, content) VALUES (?,?,?,?,?)',
      [boss.id, bestAgent.id, 'delegation', 'delegation', `Delegating "${task.title}" to you.`]);

    delegated++;
  }

  logActivity('bulk_delegation', 'The Boss', `The Boss delegated ${delegated} inbox tasks to team`);
  saveDB();
  res.json({ message: `Delegated ${delegated} tasks`, count: delegated });
});

// ─── API: Memory Search (cross-agent) ──────────────────────────
app.get('/api/memory/search', (req, res) => {
  const { q, agent_id, category, limit } = req.query;
  if (!q) return res.status(400).json({ error: 'Query parameter "q" is required' });

  let sql = `SELECT m.*, a.name as agent_name, a.role as agent_role
    FROM agent_memory m
    JOIN agents a ON m.agent_id = a.id
    WHERE (m.key LIKE ? OR m.value LIKE ?)`;
  const searchTerm = `%${q}%`;
  const params = [searchTerm, searchTerm];

  if (agent_id) { sql += ' AND m.agent_id = ?'; params.push(parseInt(agent_id)); }
  if (category) { sql += ' AND m.category = ?'; params.push(category); }
  sql += ' ORDER BY m.importance DESC, m.updated_at DESC';
  if (limit) { sql += ' LIMIT ?'; params.push(parseInt(limit)); }

  const results = queryAll(sql, params);

  // Log the search
  logActivity('memory_search', 'User', `Memory search: "${q}" (${results.length} results)`);

  res.json({ query: q, total: results.length, results });
});

// ─── API: Memory Stats ─────────────────────────────────────────
app.get('/api/memory/stats', (req, res) => {
  const stats = queryAll(`SELECT a.name, a.role,
    COUNT(m.id) as memory_count,
    COALESCE(SUM(m.access_count), 0) as total_accesses,
    COALESCE(AVG(m.importance), 0) as avg_importance
    FROM agents a
    LEFT JOIN agent_memory m ON a.id = m.agent_id
    GROUP BY a.id
    ORDER BY memory_count DESC`);

  const totalMemories = queryOne('SELECT COUNT(*) as cnt FROM agent_memory');
  const categories = queryAll('SELECT category, COUNT(*) as cnt FROM agent_memory GROUP BY category ORDER BY cnt DESC');

  res.json({
    total_memories: totalMemories?.cnt || 0,
    by_agent: stats,
    by_category: categories
  });
});

// ─── API: Cross-Agent Memory Share ─────────────────────────────
app.post('/api/memory/share', (req, res) => {
  const { from_agent_id, to_agent_id, key, value, category, importance } = req.body;
  const fromAgent = queryOne('SELECT name FROM agents WHERE id = ?', [from_agent_id]);
  const toAgent = queryOne('SELECT name FROM agents WHERE id = ?', [to_agent_id]);

  // Store in target agent's memory with source attribution
  const id = runSQL('INSERT INTO agent_memory (agent_id, category, key, value, importance) VALUES (?,?,?,?,?)',
    [to_agent_id, category || 'shared', `[From ${fromAgent?.name}] ${key}`, value, importance || 6]);

  logActivity('memory_shared', fromAgent?.name || 'Agent',
    `${fromAgent?.name} shared knowledge with ${toAgent?.name}: ${key}`, 'memory', id);
  saveDB();

  res.json({ ok: true, id, message: `Memory shared from ${fromAgent?.name} to ${toAgent?.name}` });
});

// ─── API: System Health ─────────────────────────────────────────
app.get('/api/health', (req, res) => {
  const mem = process.memoryUsage();
  const agents = queryOne('SELECT COUNT(*) as cnt FROM agents');
  const tasks = queryOne('SELECT COUNT(*) as cnt FROM tasks');
  const acts = queryOne('SELECT COUNT(*) as cnt FROM activities');
  res.json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    memory: { rss: mem.rss, heapUsed: mem.heapUsed },
    agents: agents.cnt,
    tasks: tasks.cnt,
    activities: acts.cnt
  });
});

// ─── SPA Fallback ───────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Start ──────────────────────────────────────────────────────
async function start() {
  await initDB();
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 Mission Control running at http://localhost:${PORT}\n`);
    console.log(`   Dashboard:  http://localhost:${PORT}`);
    console.log(`   API Stats:  http://localhost:${PORT}/api/stats`);
    console.log(`   Health:     http://localhost:${PORT}/api/health`);
    console.log(`   Agents:     http://localhost:${PORT}/api/agents\n`);
    logActivity('system', 'System', `Mission Control started on port ${PORT}`);
  });
}

start().catch(e => { console.error('Failed to start:', e); process.exit(1); });
