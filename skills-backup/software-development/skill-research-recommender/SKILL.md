---
name: skill-research-recommender
description: "Use when the user asks 'cariin skill X dong', 'ada skill bagus gak untuk Y', 'recommend skills for Z', or 'what Hermes Agent skills exist for [topic]'. Workflow: enumerate official + community candidates, dedup against currently installed, verify each (real SKILL.md, maintained, not toy demo), return opinionated install/skip buckets with one-line value-prop per skill. Optimized for non-technical users who want a scannable shortlist, not raw research output."
version: 1.0.0
author: Hermes Agent
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [skills, research, discovery, recommendations, github, curation, dedup]
    related_skills: [hermes-agent-skill-authoring, hermes-agent, hermes-windows-shell-quirks]
---

# Hermes Agent Skill Recommender

Research and curate third-party Hermes Agent skills from GitHub (official Nous Research + community) and present them as a scannable, opinionated shortlist. The user has typically 50-100+ skills already installed; the value is in the **dedup-aware, opinionated, verified** pick, not the long list.

## When to Use

- User asks "ada skill bagus gak untuk [domain]?"
- "Cariin skill X dong" / "research skill Y di GitHub"
- "What Hermes skills should I install for [use case]?"
- "Skill komunitas apa yang lagi populer?"
- User has installed many skills and is doing a periodic audit / expansion

## When NOT to Use

- User asks "how do I install this one skill" — that's `hermes-agent-skill-authoring` (third-party install section) or `hermes-agent` skill's `hermes skills install` command.
- User asks "how do I write my own skill" — that's `hermes-agent-skill-authoring` (authoring section).
- User wants a single specific skill they already named — just fetch and report, no research needed.

## Workflow

### Step 1 — Get the user's current skill inventory

```python
# Use hermes_tools' skills_list
from hermes_tools import terminal
# Or just call skills_list tool directly
```

Note category names AND skill names. This is the dedup set. Categories to recognize: `autonomous-ai-agents, creative, data-science, devops, dogfood, email, github, media, mlops, note-taking, productivity, red-teaming, research, smart-home, social-media, software-development, team-roles`.

### Step 2 — Find candidates

**Always start with the official source**: `https://api.github.com/repos/NousResearch/hermes-agent/contents/skills`. The official repo ships 70+ skills in 19 categories. Drill into each category folder to enumerate skills you don't already have.

Then survey community via GitHub search API:

```python
import urllib.request, json
url = "https://api.github.com/search/repositories?q=hermes-agent+skill&sort=stars&order=desc&per_page=20"
with urllib.request.urlopen(url) as r:
    results = json.loads(r.read())
# Filter: stargazers > 100, pushed within 12 months, has SKILL.md or skills/ folder
```

### Step 3 — Verify each candidate (DO NOT skip)

For each candidate skill, **before recommending**:

1. **Fetch the actual SKILL.md** from `https://raw.githubusercontent.com/{owner}/{repo}/{branch}/<path>/SKILL.md`
2. **Confirm it has real content** — frontmatter with `name` + `description` + body > 1KB
3. **Check `pushed_at`** — repo shouldn't be abandoned (> 12 months since last push = red flag)
4. **Check `stargazers_count`** — < 50 stars = probably toy/undiscovered (note as "experimental")
5. **Read the description** — does it match what the user asked for, or is it a misleading match?

If you cannot verify (rate-limited, 404, no SKILL.md, frontmatter broken), **DO NOT include it in the recommendation list**. Better to return 8 verified skills than 20 made-up ones.

### Step 4 — Dedup

Compare each verified candidate against the user's installed set. A candidate is a duplicate if:
- Same name AND same category, OR
- Same underlying tool (e.g. two skills that both wrap the `gh` CLI for repo management)
- First 30 chars of description overlap heavily

Mark each candidate as:
- ⭐ **MUST-HAVE** — high impact, no overlap, well-maintained
- 👍 **NICE-TO-HAVE** — useful, applies to specific use case
- 💡 **OPTIONAL** — niche, mention briefly

### Step 5 — Write the report

**Format that works** (user tested 2026-06-05, 5 skills accepted for install):

```markdown
# Hermes Agent Skills — Research Report

## Ringkasan
[2-3 sentences on what you found, where the official source is, ecosystem health]

## ⭐ MUST-HAVE — Worth Install Segera

### N. [Skill Name] ⭐
- **Apa**: [2-3 sentence summary — what problem it solves]
- **Kenapa install**: [1-2 sentences on concrete use case for THIS user]
- **Source**: github.com/.../skills/skill-name/SKILL.md
- **Install**: `command` (or "manual")
- **Caveat**: [any setup gotcha, e.g. "Butuh bash + sha256sum"]

## 👍 NICE-TO-HAVE — Install Kalau Use Case Cocok
[Same format, shorter]

## 💡 OPTIONAL — Skip Kalau Gak Relevan
[One-liner each]

## 🗂️ Yang Udah Lo Punya (Skip Duplicate)
[Categories that overlap with installed skills]

## 📋 Sources yang Gue Cek
- [List of repo URLs you actually visited and verified]
```

**Style rules**:
- Bahasa Indonesia, casual Jaksel, light English for tech terms
- One-line value-prop, not jargon
- Always include install command (curl, git clone, or `hermes skills install`)
- Always flag caveats (macOS-only, requires API key, etc.)
- Honest about quality — if a popular skill has maintenance issues, say so

## Output Best Practices

- **Total target**: 8-20 skills across all buckets. Under 8 = not enough research. Over 20 = user skims past.
- **Always lead with a 1-sentence summary** so user can decide whether to read further
- **Always end with sources** so user can verify or explore further
- **If user has 50+ skills already**: focus on the gap. Most "skill lists" online are novice; user has seen the obvious ones.
- **Group by impact bucket (must/nice/optional)**, not by category. The user cares about "what should I do" not "what exists."

## Common Pitfalls

1. **Returning the long GitHub search results as-is.** User will skim 3 lines and say "ok thanks." Always curate. 8 good picks > 20 noisy ones.

2. **Including a skill without verifying it exists.** Subagents are particularly prone to this — they may fabricate a SKILL.md path that sounds plausible but 404s. Always curl-verify before including.

3. **Skipping dedup.** If the user has `plan`, don't recommend `planning-with-files` without explaining the difference (the new one is Manus-style auto-planning with progress files; old `plan` is single-shot plan mode).

4. **Overwhelming with categories the user has fully covered.** If the user already has 16 `creative/` skills, don't list every creative skill you find — they have that space covered.

5. **Forgetting platform constraints.** Many community skills are macOS-only (Apple notes, iMessage, FindMy). If the user is on Windows, filter them out. Check `platforms: [linux, macos]` in the frontmatter.

6. **Hiding the "why install" rationale.** Just listing skill names is useless. The value is "for your use case of [X], this skill does Y — install because Z." Always lead with concrete benefit.

7. **Recommending skills that need paid APIs or accounts user doesn't have.** If a skill requires `OPENAI_API_KEY` and user hasn't set it, the install is dead on arrival. Check `requires_env` / `prerequisites.commands` in frontmatter.

8. **Subagent delegations that don't include the Windows-shell-quirk context.** On a Windows-with-spaced-paths host, a delegated research subagent will burn 10 minutes on the `cd: ... No such file or directory` bug. Pass Windows-quirk awareness in the `context` parameter — see `hermes-windows-shell-quirks` skill's "Subagent Delegation" section.

## Verification Checklist (post-write)

- [ ] Every skill in MUST-HAVE / NICE-TO-HAVE was actually fetched (200 OK)
- [ ] Every skill has a `Source:` line with a real GitHub URL
- [ ] Every skill has either an `Install:` command or a "manual" note
- [ ] Categories the user already covers are listed in the dedup section
- [ ] Report is in Indonesian, casual tone, scannable
- [ ] Total skills: 8-20 (not less, not way more)
- [ ] Report ends with a "Sources Consulted" list

## Related

- `references/session-example-2026-06-05.md` — worked example: the research session that produced this skill. Shows the target output format, dedup reasoning, and the subagent-timeout failure mode to avoid.
- `references/github-skill-discovery-pattern.md` — tested workflow for discovering and installing community skills from GitHub (official repo, community search, awesome lists). Includes verified install results for 14 skills across 5 categories.
