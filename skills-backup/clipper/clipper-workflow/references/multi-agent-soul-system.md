# Multi-Agent Soul System — Kiro AI Pattern

Based on: [YouTube Tutorial — Hermes Multi-Agent Setup](https://youtu.be/t6W_Zpohb7g) by Kiro AI

## Core Concept: Agent Souls

Every agent has:
1. **SOUL.md** — Identity, persona, role boundaries, protocol
2. **MEMORY.md** — Task history, data, workspace, preferences
3. **skills/** — Specialized skill files for their domain

Key rule: **No cross-contaminate** — Scout never reads Scribe's memory, Dev never reads Scout's research, etc.

## Directory Structure

```
~/.hermes/agents/
├── orchestrator/
│   ├── SOUL.md
│   ├── MEMORY.md
│   └── skills/
│       └── orchestrator-coord.md
├── scout/
│   ├── SOUL.md
│   ├── MEMORY.md
│   └── skills/
│       └── scout-research.md
├── scribe/
│   ├── SOUL.md
│   ├── MEMORY.md
│   └── skills/
│       └── scribe-content.md
├── reach/
│   ├── SOUL.md
│   ├── MEMORY.md
│   └── skills/
│       └── reach-marketing.md
└── dev/
    ├── SOUL.md
    ├── MEMORY.md
    └── skills/
        └── dev-build.md
```

## Routing Cheat Sheet

| Erik's request | Route to | Action |
|----------------|----------|--------|
| Research | Scout | Gather data + cite sources |
| Content | Scribe | Write from research |
| Posting | Reach | Post via Repliz API |
| Build | Dev | Build + deploy |

## Soul Template (for new agents)

```markdown
# [Agent Name] — [Role] Soul

## Identity
- Name: [Agent Name]
- Role: [Specialist domain]
- Team: [Other agents]
- Personality: [Key traits]

## Memory Instructions
- Store [domain-specific data]
- Log every task: [format]
- NEVER access other agent's memory

## Role Boundaries
- DO: [What this agent does]
- DO NOT: [What other agents do — route to them]

## Output Format
[Expected output structure]
```

## Key Prompts from Kiro AI Video

### Create Soul System
```
We're going to create four additional independent persistent agents. 
The key aspect is that I want every agent to have their own soul, 
their own identity, their own memory. And it really doesn't 
cross-contaminate the system.
```

### Memory & Role Boundaries
```
In each agent's dedicated memory, they store content relevance 
to their role. I don't want dev to be writing a research report 
for me. If I tell them to write a research report, they're going 
to say hey I'm not the best guy for this. Why don't you talk to 
scout who is basically responsible for this.
```

### Activity Logging (for dashboard)
```
After every task, I want you to log every activity that you performed.
Log format: Task name | Time performed | Status | Notes
```

### Content Pipeline
```
Start that scout researches the topic first and then scout passes 
that information to scribe. Then scribe writes blog content for me 
and after that scribe passes it to reach. And then reach creates 
the social media post for that particular content. And after that 
reach also builds the marketing and promoting promotion strategy.
```

## Implemented for Clipper Company

This system was implemented for Erik's Clipper Company workflow:
- Orchestrator: coordinates all agents
- Scout: research (job intel, market data)
- Scribe: content (scripts, captions)
- Reach: marketing (Repliz API posting)
- Dev: build (websites, automation)

## Pipeline Validation (May 31, 2026)

Full end-to-end test completed:
- **Scout** → researched "AI Marketing Trends Indonesia 2026", stored 3 sources in MEMORY.md ✅
- **Scribe** → wrote 400-word article in Bahasa Indonesia, cited all 3 Scout sources ✅
- **Reach** → adapted article into YouTube script (hook, problem, 3 points, gaps, CTA) ✅
- **Repliz API** → tested posting: video=201 ✅, text-only=500 ❌, link=400 ❌

**Key Repliz finding:** Repliz only accepts `type: video` posts. Text/link posts fail. For article-to-social pipeline, must generate video clip first.

## Dashboard Integration

Mission Control Dashboard shows:
- Agent monitoring (real-time)
- Activity logs per agent
- Agent statistics (tasks/day, success rate, pie chart)
- Long-term memory per agent

SSH tunneling to access: `ssh -L 7860:localhost:7860 root@VPS_IP` → browser `http://localhost:7860`

---

Created: 2026-05-31
Source: Kiro AI YouTube video (53 min)
Live deployment: https://digitalnusa.com/hermes-multi-agent/