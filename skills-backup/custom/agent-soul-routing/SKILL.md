# Multi-Agent Soul System — Routing & Dispatch

<!--
SKILL: multi-agent-soul-system
Trigger: "agent coordination", "multi-agent", "routing", "soul system", "agent memory"
When to load: When Erik asks about multi-agent setup OR when coordinating tasks across specialists

This skill defines how the orchestrator routes tasks to specialized agents,
how each agent accesses their soul (SOUL.md) and memory (MEMORY.md),
and how agents maintain separation (no cross-contaminate).
-->

## How the System Works

### 5 Agents with Own Souls

```
Orchestrator — coordinates everything, routes tasks
    ↓ (dispatch)
Scout — research, data gathering
Scribe — content writing, articles, scripts
Reach — marketing, social media posting
Dev — development, websites, automation
```

### Each Agent Has:
1. **SOUL.md** — Identity, persona, role boundaries, protocol
2. **MEMORY.md** — Task history, data, preferences, workspace
3. **skills/** — Specialized skills directory

### Agent Directory Structure
```
~/.hermes/agents/
  orchestrator/
    SOUL.md         ← "I coordinate, never do the work myself"
    MEMORY.md       ← task tracking, agent status
  scout/
    SOUL.md         ← "I research, cite sources, never write content"
    MEMORY.md       ← research database, sources, topics
  scribe/
    SOUL.md         ← "I write from research, never research myself"
    MEMORY.md       ← content templates, successful angles
  reach/
    SOUL.md         ← "I market/distribute, never write content"
    MEMORY.md       ← posting schedule, engagement metrics
  dev/
    SOUL.md         ← "I build, never write content or research"
    MEMORY.md       ← project status, deployed sites, code templates
```

## Routing Cheat Sheet

When Erik says something, the orchestrator identifies which agent:

| Erik's request | Route to | Action |
|----------------|----------|--------|
| "research tentang X" | Scout | Gather data, cite sources |
| "tulis artikel tentang X" | Scribe | Create content from research |
| "post ke YouTube" | Reach | Post via Repliz API |
| "bikin website" | Dev | Build and deploy |
| "bikin landing page" | Dev | Build and deploy |
| "kirim ke Telegram" | Reach | Use send_message |
| "kompilasi job" | Scout | Research + pass to Scribe |

## Key Soul Rules (No Cross-Contaminate)

1. **Scout NEVER reads Scribe's memory** — only research data
2. **Scribe NEVER reads Reach's memory** — only content needs
3. **Reach NEVER reads Dev's memory** — only deployment status
4. **Dev NEVER reads Scout's research** — use Scribe's content
5. **All agents ONLY read their own SOUL.md and MEMORY.md**

## How to Dispatch a Task

### Step 1: Identify the Agent
Read the request, determine which specialist handles it.

### Step 2: Load Agent Soul
```
Read ~/.hermes/agents/[agent]/SOUL.md
→ Know their identity, role, boundaries
```

### Step 3: Execute via Skill
Load relevant skill for the agent:
- Scout: research, web search, data analysis
- Scribe: writing, content creation
- Reach: social media, Repliz API
- Dev: website building, deployment

### Step 4: Log to Agent Memory
```
Update ~/.hermes/agents/[agent]/MEMORY.md
→ Task completed, timestamp, notes
```

### Step 5: Report to Orchestrator
```
"Scout completed research on [topic]. 
Findings passed to Scribe for content creation."
```

## Orchestrator's Role

The orchestrator:
- Tracks all agent status
- Routes tasks to right specialist
- Ensures no cross-contaminate (Dev can't read Scout memory)
- Reports to Erik in Bahasa Indonesia
- Enforces role boundaries

## Activation

When Erik asks to "research X" or "build Y" or "post Z":
1. Identify agent from cheat sheet
2. Load agent SOUL.md
3. Execute via relevant skill
4. Log result to agent MEMORY.md
5. Report completion to Erik

## Test Flow

1. "Scout, research AI marketing trends Indonesia"
→ Scout reads SOUL.md, does research, logs to MEMORY.md

2. "Scribe, write article from Scout's research"
→ Scribe reads SOUL.md, gets data from Scout memory, writes

3. "Reach, post to YouTube"
→ Reach reads SOUL.md, uses Repliz API, logs to MEMORY.md

4. "Dev, build landing page"
→ Dev reads SOUL.md, builds with relevant skills, deploys

---

Created: 2026-05-31
Based on Kiro AI multi-agent YouTube tutorial
Adapted for Hermes + Clipper Company workflow