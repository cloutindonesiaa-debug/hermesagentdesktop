# 🚀 Hermes Agent Desktop — Mission Control

> Backup & sync repository for Hermes Agent Mission Control system.
> Clone this repo to any desktop to restore your full agent setup.

## 📦 What's Included

### Mission Control (`mission-control/`)
- **server.js** — Express.js backend with SQLite, WebSocket, SSE
- **agent-souls.js** — 6 team agents with full soul/personality definitions
- **public/index.html** — Dark futuristic dashboard UI
- **package.json** — Dependencies (express, sql.js, ws)
- **mission-control.db** — SQLite database (agents, tasks, messages, memory)
- **.env.example** — Environment variables template

### Skills Backup (`skills-backup/`)
- **92 skills** across 17 categories
- Each skill has its SKILL.md file
- Categories: creative, software-development, research, social-media, etc.

## 🎯 Team Agents

| Agent | Role | Emoji | Soul |
|-------|------|-------|------|
| Dev Lead | Developer | 👨‍💻 | Senior engineer, precise, technical |
| Social Queen | Social Media | 👑 | Creative, trend-savvy, viral mindset |
| Research Brain | Researcher | 🧠 | Methodical, data-driven, thorough |
| Design Wizard | UI/UX Designer | 🎨 | Empathetic, aesthetic-focused |
| Auto Pilot | Automation | ⚙️ | Systematic, efficiency-focused |
| The Boss | Orchestrator | 🎯 | Strategic, team coordinator |

## 🛠️ Quick Setup (New Desktop)

### 1. Clone this repo
```bash
git clone https://github.com/cloutindonesiaa-debug/hermesagentdesktop.git
cd hermesagentdesktop
```

### 2. Install Mission Control
```bash
cd mission-control
npm install
```

### 3. Configure API Key (optional)
```bash
cp .env.example .env
# Edit .env and add your Xiaomi MiMo API key
# XIAOMI_API_KEY=***
```

### 4. Start the server
```bash
# Delete old database to get fresh agent setup
rm -f mission-control.db
PORT=3001 node server.js
```

### 5. Open dashboard
```
http://localhost:3001
```

### 6. Restore Skills
```bash
# Copy skills to Hermes Agent skills directory
# Windows: %USERPROFILE%\AppData\Local\hermes\skills\
# Linux/Mac: ~/.hermes/skills/

# For each category:
cp -r skills-backup/* ~/.hermes/skills/
```

## 📡 API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/agents` | GET | List all agents |
| `/api/agents/:id/chat` | POST | Chat with agent (soul-aware) |
| `/api/agents/:id/soul` | GET | View agent soul definition |
| `/api/agents/:id/memory` | GET/POST | Agent memory CRUD |
| `/api/delegate` | POST | The Boss delegates task to best agent |
| `/api/delegate-all` | POST | The Boss delegates all inbox tasks |
| `/api/memory/search?q=` | GET | Search memory across all agents |
| `/api/memory/stats` | GET | Memory statistics |
| `/api/memory/share` | POST | Share memory between agents |
| `/api/messages` | GET/POST | Inter-agent messages |
| `/api/messages/chat` | POST | Agent-to-agent chat with auto-reply |
| `/api/stress-test` | POST | Run stress test |
| `/api/skills` | GET | Skills catalog |
| `/api/team` | GET | Team overview with soul + memory |
| `/api/stats` | GET | Dashboard statistics |
| `/api/health` | GET | System health check |

## 🔄 Sync Workflow

### To save changes:
```bash
cd hermesagentdesktop
git add .
git commit -m "Update: [description]"
git push origin main
```

### To restore on new desktop:
```bash
git clone https://github.com/cloutindonesiaa-debug/hermesagentdesktop.git
cd hermesagentdesktop/mission-control
npm install
rm -f mission-control.db
PORT=3001 node server.js
```

## 📊 Current Stats

- **6 Team Agents** with soul & memory
- **92 Skills** across 17 categories
- **Real LLM integration** (Xiaomi MiMo API)
- **Task delegation** from The Boss
- **Cross-agent memory search**
- **Inter-agent messaging**
- **Stress testing**

## 🔑 Environment Variables

```bash
# .env file
XIAOMI_API_KEY=***  # Xiaomi MiMo API key
```

## 📝 License

MIT — Free to use and modify.

---

**Last updated: 2026-06-09**
**Synced from: Clout Indonesia's desktop**
