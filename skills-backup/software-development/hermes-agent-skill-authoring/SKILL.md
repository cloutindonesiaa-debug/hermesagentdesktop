---
name: hermes-agent-skill-authoring
description: "Author in-repo SKILL.md: frontmatter, validator, structure."
version: 1.0.0
author: Hermes Agent
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [skills, authoring, hermes-agent, conventions, skill-md]
    related_skills: [plan, requesting-code-review]
---

# Authoring Hermes-Agent Skills (in-repo)

## Overview

There are two places a SKILL.md can live:

1. **User-local:** `~/.hermes/skills/<maybe-category>/<name>/SKILL.md` — personal, not shared. Created via `skill_manage(action='create')`.
2. **In-repo (this skill is about this case):** `/home/bb/hermes-agent/skills/<category>/<name>/SKILL.md` — committed, shipped with the package. Use `write_file` + `git add`. `skill_manage(action='create')` does NOT target this tree.

## When to Use

- User asks you to add a skill "in this branch / repo / commit"
- You're committing a reusable workflow that should ship with hermes-agent
- You're editing an existing skill under `/home/bb/hermes-agent/skills/` (use `patch` for small edits, `write_file` for rewrites; `skill_manage` still works for patch on in-repo skills, but not for `create`)

## Required Frontmatter

Source of truth: `tools/skill_manager_tool.py::_validate_frontmatter`. Hard requirements:

- Starts with `---` as the first bytes (no leading blank line).
- Closes with `\n---\n` before the body.
- Parses as a YAML mapping.
- `name` field present.
- `description` field present, ≤ **1024 chars** (`MAX_DESCRIPTION_LENGTH`).
- Non-empty body after the closing `---`.

Peer-matched shape used by every skill under `skills/software-development/`:

```yaml
---
name: my-skill-name               # lowercase, hyphens, ≤64 chars (MAX_NAME_LENGTH)
description: Use when <trigger>. <one-line behavior>.
version: 1.0.0
author: Hermes Agent
license: MIT
metadata:
  hermes:
    tags: [short, descriptive, tags]
    related_skills: [other-skill, another-skill]
---
```

`version` / `author` / `license` / `metadata` are NOT enforced by the validator, but every peer has them — omit and your skill sticks out.

## Size Limits

- Description: ≤ 1024 chars (enforced).
- Full SKILL.md: ≤ 100,000 chars (enforced as `MAX_SKILL_CONTENT_CHARS`, ~36k tokens).
- Peer skills in `software-development/` sit at **8-14k chars**. Aim for that range. If you're pushing past 20k, split into `references/*.md` and reference them from SKILL.md.

## Peer-Matched Structure

Every in-repo skill follows roughly:

```
# <Title>

## Overview
One or two paragraphs: what and why.

## When to Use
- Bulleted triggers
- "Don't use for:" counter-triggers

## <Topic sections specific to the skill>
- Quick-reference tables are common
- Code blocks with exact commands
- Hermes-specific recipes (tests via scripts/run_tests.sh, ui-tui paths, etc.)

## Common Pitfalls
Numbered list of mistakes and their fixes.

## Verification Checklist
- [ ] Checkbox list of post-action verifications

## One-Shot Recipes (optional)
Named scenarios → concrete command sequences.
```

Not every section is mandatory, but `Overview` + `When to Use` + actionable body + pitfalls are the minimum for the skill to feel like a peer.

## Directory Placement

```
skills/<category>/<skill-name>/SKILL.md
```

Categories currently in repo (confirm with `ls skills/`): `autonomous-ai-agents`, `creative`, `data-science`, `devops`, `dogfood`, `email`, `gaming`, `github`, `leisure`, `mcp`, `media`, `mlops/*`, `note-taking`, `productivity`, `red-teaming`, `research`, `smart-home`, `social-media`, `software-development`.

Pick the closest existing category. Don't invent new top-level categories casually.

## Workflow

1. **Survey peers** in the target category:
   ```
   ls skills/<category>/
   ```
   Read 2-3 peer SKILL.md files to match tone and structure.
2. **Check validator constraints** in `tools/skill_manager_tool.py` if unsure.
3. **Draft** with `write_file` to `skills/<category>/<name>/SKILL.md`.
4. **Validate locally**:
   ```python
   import yaml, re, pathlib
   content = pathlib.Path("skills/<category>/<name>/SKILL.md").read_text()
   assert content.startswith("---")
   m = re.search(r'\n---\s*\n', content[3:])
   fm = yaml.safe_load(content[3:m.start()+3])
   assert "name" in fm and "description" in fm
   assert len(fm["description"]) <= 1024
   assert len(content) <= 100_000
   ```
5. **Git add + commit** on the active branch.
6. **Note:** the CURRENT session's skill loader is cached — `skill_view` / `skills_list` will not see the new skill until a new session. This is expected, not a bug.

## Cross-Referencing Other Skills

`metadata.hermes.related_skills` unions both trees (`skills/` in-repo and `~/.hermes/skills/`) at load time. You CAN reference a user-local skill from an in-repo skill, but it won't resolve for other users who clone the repo fresh. Prefer referencing only in-repo skills from in-repo skills. If a frequently-referenced skill lives only in `~/.hermes/skills/`, consider promoting it to the repo.

## Editing Existing In-Repo Skills

- **Small fix (typo, added pitfall, tightened trigger):** `skill_manage(action='patch', name=..., old_string=..., new_string=...)` works fine on in-repo skills.
- **Major rewrite:** `write_file` the whole SKILL.md. `skill_manage(action='edit')` also works but requires supplying the full new content.
- **Adding supporting files:** `write_file` to `skills/<category>/<name>/references/<file>.md`, `templates/<file>`, or `scripts/<file>`. `skill_manage(action='write_file')` also works and enforces the references/templates/scripts/assets subdir allowlist.
- **Always commit** the edit — in-repo skills are source, not runtime state.

## Common Pitfalls

1. **Using `skill_manage(action='create')` for an in-repo skill.** It writes to `~/.hermes/skills/`, not the repo tree. Use `write_file` for in-repo creation.

2. **Leading whitespace before `---`.** The validator checks `content.startswith("---")`; any leading blank line or BOM fails validation.

3. **Description too generic.** Peer descriptions start with "Use when ..." and describe the *trigger class*, not the one task. "Use when debugging X" > "Debug X".

4. **Forgetting the author/license/metadata block.** Not validator-enforced, but every peer has it; omitting makes the skill look half-finished.

5. **Writing a skill that duplicates a peer.** Before creating, `ls skills/<category>/` and open 2-3 peers. Prefer extending an existing skill to creating a narrow sibling.

6. **Expecting the current session to see the new skill.** It won't. The skill loader is initialized at session start. Verify in a fresh session or via `skill_view` using the exact path.

7. **Linking to skills that don't exist in-repo.** `related_skills: [some-user-local-skill]` works for you but breaks for other clones. Prefer only in-repo links.

## Verification Checklist

- [ ] File is at `skills/<category>/<name>/SKILL.md` (not in `~/.hermes/skills/`)
- [ ] Frontmatter starts at byte 0 with `---`, closes with `\n---\n`
- [ ] `name`, `description`, `version`, `author`, `license`, `metadata.hermes.{tags, related_skills}` all present
- [ ] Name ≤ 64 chars, lowercase + hyphens
- [ ] Description ≤ 1024 chars and starts with "Use when ..."
- [ ] Total file ≤ 100,000 chars (aim for 8-15k)
- [ ] Structure: `# Title` → `## Overview` → `## When to Use` → body → `## Common Pitfalls` → `## Verification Checklist`
- [ ] `related_skills` references resolve in-repo (or are explicitly OK to be user-local)
- [ ] `git add skills/<category>/<name>/ && git commit` completed on the intended branch

---

## Installing Third-Party Skills from GitHub (User-Local)

**This section covers the OTHER case: installing a skill published externally into `~/.hermes/skills/`.** A user can `skill_manage(action='create')` from scratch, but the common pattern is "I found a good skill on GitHub — pull it in." Two installation paths exist; pick by repo size.

### Path A: `hermes skills install <id-or-url>` (preferred when available)

The `hermes skills` CLI handles discovery, install location, and frontmatter validation:

```bash
# By hub identifier
hermes skills install planning-with-files

# By direct SKILL.md URL
hermes skills install https://raw.githubusercontent.com/OthmanAdi/planning-with-files/master/skills/planning-with-files/SKILL.md
```

Use this whenever the skill is in a known hub or you have a direct `SKILL.md` URL. See `hermes-agent` skill's Tools & Skills section for the full command list.

### Path B: Manual install from a GitHub repo (sparse-checkout + tarball)

Use this when the skill lives in a repo alongside many others (e.g. `NousResearch/hermes-agent` ships 70+ skills in one tree), or when there's no SKILL.md at the root. Two techniques:

**Tarball method** (for small repos, up to ~50MB):

```python
import urllib.request, tarfile, tempfile, shutil
from pathlib import Path

dest = Path("C:/Users/<user>/AppData/Local/hermes/skills/<category>/<name>")
url = f"https://codeload.github.com/{owner}/{repo}/tar.gz/refs/heads/{branch}"
with tempfile.NamedTemporaryFile(suffix=".tar.gz", delete=False) as tmp:
    urllib.request.urlretrieve(url, tmp.name)
    with tarfile.open(tmp.name, "r:gz") as tar:
        for member in tar.getmembers():
            if member.name.startswith(f"{repo}-{branch}/{src_subpath}/"):
                rel = member.name[len(f"{repo}-{branch}/{src_subpath}/"):]
                target = dest / rel
                target.parent.mkdir(parents=True, exist_ok=True)
                f = tar.extractfile(member)
                if f:
                    target.write_bytes(f.read())
                    if member.mode & 0o111:
                        target.chmod(target.stat().st_mode | 0o111)
```

**Sparse-checkout method** (for huge repos, need only one subfolder):

```python
import subprocess, tempfile, shutil, os
from pathlib import Path

work = Path(tempfile.mkdtemp())
for cmd in [
    ["git", "init", "-q"],
    ["git", "remote", "add", "origin", f"https://github.com/{owner}/{repo}.git"],
    ["git", "config", "core.sparseCheckout", "true"],
]:
    subprocess.run(cmd, cwd=work)
(work / ".git" / "info" / "sparse-checkout").write_text(f"{src_subpath}/*\n")
subprocess.run(
    ["git", "pull", "--depth=1", "origin", branch, "-q"],
    cwd=work, capture_output=True, timeout=120
)
# Copy from work/src_subpath to dest
for root, dirs, files in os.walk(work / src_subpath):
    for f in files:
        s = Path(root) / f
        d = dest / Path(root).relative_to(work / src_subpath) / f
        d.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(s, d)
shutil.rmtree(work)
```

This is the only way to install e.g. one skill from `NousResearch/hermes-agent` (50MB repo) without downloading the whole thing.

### Skill Collections (Multi-Skill Repos)

Some repos are **collections of skills** (e.g. `Cranot/super-hermes` ships 5 separate SKILL.md files in `skills/<sub-skill>/`). The repo has NO root SKILL.md. For these:

1. **Don't install the parent folder** — Hermes only sees one skill per `SKILL.md` in a folder, and the parent has none.
2. **Install each sub-skill individually** as a sibling under a category. Convention: `<category>/<repo-name>/<sub-skill>/SKILL.md`. This keeps the relationship visible in the directory tree.
3. **Always inspect the repo's actual structure** before installing — `gh_list` or `git ls-tree` on the root, not assumptions. A repo named "super-hermes" might still be a single-skill repo; you only know by listing.

### Pitfalls for Third-Party Install

1. **Permission denied on cleanup of `.git/` after sparse-checkout.** On Windows, sparse-checkout leaves read-only git objects that `shutil.rmtree` cannot delete. Workaround:
   ```python
   subprocess.run(["cmd", "/c", "rd", "/s", "/q", str(work)], capture_output=True)
   ```
   Or first do `git clean -fdx && git reset --hard HEAD` in the work dir.

2. **Skill not visible after install.** The skill index (`~/.hermes/skills/index-cache/` or `.usage.json`) is built at session start. Newly installed skills don't appear in `skills_list` until a new session. The filesystem install IS the truth — verify with `ls` and a fresh `skills_list` after `/reset`.

3. **Frontmatter validation fails silently for some sub-skills.** A skill-collection repo may have one or two sub-skills with broken/missing `name` fields. After install, list the new skills and `read_file` each SKILL.md to confirm frontmatter is valid. If one fails, install the rest and skip the broken one.

4. **Executable bit lost on Windows.** Scripts copied from a tarball lose their `+x` mode on NTFS. If the skill's hooks or scripts depend on `+x`, explicitly `chmod` after copy:
   ```python
   if (src.stat().st_mode & 0o111):
       dest.chmod(dest.stat().st_mode | 0o111)
   ```
   Hermes' skill loader doesn't require executable bits, but the user's shell does when invoking those scripts manually.

5. **Anonymous GitHub API rate limit (HTTP 403).** If you use `api.github.com/repos/.../contents/...` in a loop, expect to be rate-limited after ~10 calls. See `hermes-windows-shell-quirks` → "Anonymous GitHub API Rate Limit" for the codeload-tarball and `gh api` fixes.
