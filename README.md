# Hermes Agent Desktop - Mission Control

Backup & sync for Hermes Agent Mission Control system.

## Team Agents (7)
- Dev Lead (developer)
- Social Queen (social-media)
- Research Brain (researcher)
- Design Wizard (designer)
- Auto Pilot (automation)
- Clip Master (clipper) - NEW
- The Boss (orchestrator)

## Clipper System
YouTube video -> 20 clips with face detection + subtitle

## Setup
```bash
git clone https://github.com/cloutindonesiaa-debug/hermesagentdesktop.git
cd hermesagentdesktop/mission-control
npm install
PORT=3001 node server.js
```

## API
- POST /api/clipper/process - Process YouTube video
- GET /api/clipper/status - Clipper status
- POST /api/delegate - The Boss delegates tasks
- GET /api/memory/search?q= - Search memory
