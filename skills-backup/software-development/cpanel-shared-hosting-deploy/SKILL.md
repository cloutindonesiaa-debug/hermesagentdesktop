---
name: cpanel-shared-hosting-deploy
description: "Deploy a zipped website (static HTML or PHP) to a cPanel/shared-hosting account via FTPS. Covers zip extraction, selective upload, PHP version compatibility fixes, and live verification. Use when the user says 'upload this zip to my hosting', 'deploy to podsindonesia.com', 'FTP this to my server', or gives cPanel/FTPS credentials."
version: 1.1.0
author: Hermes Agent
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [deploy, cpanel, ftps, shared-hosting, php, website, static-site, hosting]
    related_skills: [hermes-windows-shell-quirks, team-orchestrator]
---

# cPanel / Shared-Hosting Deploy via FTPS

End-to-end recipe for taking a zipped website (static HTML or PHP) on the user's local machine and pushing it live to a cPanel-style shared-hosting account over FTPS. Built from real session 2026-06-05 (podsindonesia.com /erp/ deploy).

## When to load

Trigger phrases:
- "upload this zip to my hosting", "deploy zip ke hosting", "FTP ini ke server"
- "deploy to [domain].com", "bikin live di [domain].com"
- "FTPS creds: user X, server Y, password Z" — implies a deploy task
- "kok website lama gak ke-ganti", "upload versi baru" + zip attached
- "kasih subdomain/folder [nama]" + zip
- "coba login ke FTP [host], saya mau upload file untuk domain [X]"

Do NOT load for:
- Git-based deploys (Vercel/Netlify/Fly/Railway) — different toolchain
- VPS with SSH (rsync, scp) — use direct shell
- WordPress sites installed via Softaculous (use cPanel UI instead)
- DNS/email/SSL setup — out of scope, point user to hosting support

Also applies (with adapted steps) when the host is **DirectAdmin Evolution** instead of cPanel — see "DirectAdmin Evolution detection & fallback" section below. The skill's pitfall format and diagnostic style still apply, just the login surface and upload transport differ.

## Core Workflow (5 phases)

### Phase 1 — Pre-flight (before any bytes move)

1. **Verify zip exists locally.** Use `execute_code` with `os.path.exists` (Windows-native path, NOT `/mnt/c/` WSL path — the host runs native Windows). The Hermes `read_file` tool can probe binary existence but won't return content.
2. **List zips matching the topic** in `~/Downloads/` to find the latest version. Files with `(1)`, `(2)` suffixes are usually revisions — pick the newest by mtime.
3. **Extract to staging** with `zipfile` in `execute_code` (more reliable than shelling out to `unzip` which often missing on minimal images). Verify integrity: `with zipfile.ZipFile(p) as z: bad = z.testzip()`.
4. **Inventory the bundle**: file count, total bytes, entry points (`index.html`, `index.php`). Note any `.bak` files (skip), `.db` files (defer to runtime), `node_modules` / `dist` (huge, ask before uploading).
5. **Pre-flight question to user — ALWAYS before destructive upload.** Use `clarify` with the question framed around what the bundle will overwrite. If `public_html/index.html` already exists on server, that's a destructive operation. Show the plan and ask permission.
6. **Pick a target subfolder name up front** — the user often says "taro di folder" without naming one. Suggest 2-3 short, code-derived options (e.g. for a "Pods Center ERP" bundle: `/erp/`, `/podscenter/`, `/erp-v2/`). Short code-names beat full English words for URLs. Always prefer a subfolder over root overwrite unless the user explicitly says "replace the whole site." (See Pitfall 5.)
7. **Scan the bundle for hardcoded URLs and paths BEFORE uploading** — both cross-domain API endpoints (e.g. `digitalnusa.com/pods-api.php`) and intra-bundle paths (e.g. `window.location.href = '/pods-indonesia/absen/'`). A `re.findall(r'https?://[a-zA-Z0-9.-]+/[^\s"\'<>)\]]*', src)` sweep over every text file catches the URLs; a `window.location.href` / `href="/<word>"` sweep catches the path references. Plan the rewrites as part of Phase 1, not as a fire-drill after the user clicks a 404. See Pitfalls 9 and 10.

### Phase 2 — Inspect server state

Connect via `ftplib.FTP_TLS` with `ssl._create_unverified_context()` (most shared-hosting certs have hostname mismatches — see pitfalls).

```python
import ftplib, ssl
ctx = ssl._create_unverified_context()
ftp = ftplib.FTP_TLS(HOST, user=USER, passwd=PASS, context=ctx)
ftp.prot_p()  # encrypt data channel
```

- `cwd("/public_html")` is the convention for cPanel (home dir of account, contains the live site).
- `retrlines("LIST")` to see what exists. Look for: `index.html`/`index.php` at root, `public_ftp/`, `.cpanel/`, `mail/`, `ssl/`, `tmp/`, symlink `www -> public_html`. **Lots of other files = existing live site. Don't blow them up.**
- For each candidate upload target, check for name clashes. Report clashes to user with the question "replace existing X? (will overwrite)".
- Detect existing subfolders via `cwd` + try/except on `ftplib.error_perm` (550 = no such dir).

### Phase 3 — Selective upload

**Always pick a target subfolder** unless user explicitly says "replace the root site". A clean subfolder deploy (`domain.com/erp/`, `domain.com/landing/`) is non-destructive; root overwrite is a single point of failure.

Upload order:
1. `mkd` the target folder (catch `550` if it exists, not fatal).
2. For each file, `STOR` from local path:
   ```python
   with open(local, "rb") as fh:
       ftp.storbinary(f"STOR {remote_name}", fh)
   ```
3. After upload, verify the remote size matches local (`retrlines("LIST")` and parse size column).
4. Skip files that are obviously not runtime: `*.bak`, `*.bak-*`, `*.disabled-*`, `~*` (Office temp), local zips already uploaded for transfer, `Thumbs.db`, `.DS_Store`, source control (`.git/`, `.svn/`).
5. **Database files (`.db`, `.sqlite`, `.sql`)** — usually SKIP. The app's PHP code typically initializes schema on first hit; pre-seeding a stale DB is more dangerous than not.

### Phase 4 — PHP version compatibility (cPanel-specific)

cPanel shared hosting often runs PHP 7.4 (Rumahweb, Niagahoster, Hostinger default zones — verify with probe). Modern dev machines write PHP 8.0+ code with `match()`, `enum`, named args, `readonly` props, `true`/`false`/`null` as standalone types, `mixed` type. Common 7.4-vs-8.0 killers seen in session:

| Construct | PHP version | Fix to 7.4 |
|---|---|---|
| `match($x) { 'a' => 1, default => 2 }` | 8.0+ | `if/elseif/else` chain returning the same value |
| `enum Status: string { case Active = 'active'; }` | 8.1+ | Class with `const` |
| `$fn = fn($x) => $x * 2` (arrow functions) | 7.4+ | OK, but named args (`foo(name: $v)`) are 8.0+ |
| `#[Attribute]` (PHP attributes) | 8.0+ | Doc-comment annotations |
| `readonly` property | 8.1+ | Remove keyword, accept the mutation risk |
| `true`/`false`/`null` as type | 8.0+ union types | `bool`/`null` |
| `str_contains`, `str_starts_with`, `str_ends_with` | 8.0+ | `strpos(...) === 0`, etc. |
| `Stringable` interface | 8.0+ | Remove from `implements` |

**Probe PHP version before pushing:**
```python
# Upload _phpver.php that echoes PHP_VERSION, hit it, delete
probe = b"<?php echo PHP_VERSION; ?>"
ftp.storbinary("STOR /public_html/<target>/_phpver.php", io.BytesIO(probe))
# then urllib.request.urlopen(...)
# then ftp.delete(...)
```

**If 500 with empty body** after first push — `display_errors=off` is cPanel default. Read `<target>/error_log` (cPanel writes one per folder). Typical entries:
- `PHP Parse error: ... unexpected '=>' (T_DOUBLE_ARROW) in ... line N` → 8.0+ `match()` usage
- `Call to a member function prepare() on null` → missing `$db` global (partial-template called directly, see below)
- `Call to undefined function requireAuth()` → same: sub-template called outside its parent
- `database is locked` → SQLite, expected; will resolve on retry

**Fix the bug, re-upload only the changed file.** Don't re-upload the whole bundle. Use `patch()` to edit the local staging file, then `storbinary` to overwrite the remote. Always clear the local `error_log` after fixing to get a clean verification.

### Phase 5 — Live verification

```python
urls = [f"https://{DOMAIN}/<target>/", f"https://{DOMAIN}/<target>/index.html", ...]
for u in urls:
    r = urllib.request.urlopen(u, context=ssl._create_unverified_context(), timeout=15)
    # status 200 + body[:200] decoded
```

**Test the right URLs.** For PHP apps where sub-files are partial-templates, hitting `dashboard.php` directly will 500. Hit `index.php?page=dashboard` instead (the entry point that injects `$db` and `requireAuth()`).

**Things to verify:**
- Entry point returns 200 with expected HTML.
- `.db` file is auto-created by PHP on first hit (check via FTP after the HTTP probe).
- A static asset (logo, favicon) returns 200 with non-empty body.
- Sub-page flow (e.g. `index.php?page=X`) returns 200.
- `error_log` is clean (or only contains the legitimate 500s you already diagnosed and fixed).

## Pitfalls (read these — most failures cluster here)

### Pitfall 1 — Wrong filesystem view

The user's Windows filesystem is accessible from:
- `execute_code` / `read_file` / `write_file` → **native Windows paths** (`C:\Users\...\Downloads\foo.zip`). Works.
- `terminal()` running bash/WSL → `/mnt/c/Users/.../Downloads/foo.zip`. Works, but the auto-injected `cd C:\Users\Clout Indonesia` prefix breaks because the path has spaces (see `hermes-windows-shell-quirks`).

**Rule:** use `execute_code` for any zip/extract operation. Use `terminal` only for network calls (curl, ping) where the workdir doesn't matter, with `workdir="/tmp"` to avoid the `cd` prefix bug.

### Pitfall 2 — SSL cert hostname mismatch (server-side, not credentials)

`ftp.podsindonesia.com` returns a cert for `kelud.iixcp.rumahweb.net`. This is the **shared hosting infrastructure's** cert, not a credentials or account issue. Don't tell the user "credentials are wrong" — they're not.

**Fix:** use `ssl._create_unverified_context()` and document that this is a known cPanel infrastructure quirk. Real fix is on the hosting provider (they'd issue a per-domain cert or SAN entry), out of scope for a one-off deploy.

### Pitfall 3 — `display_errors=off` makes 500s silent

cPanel default. HTTP 500 with empty body looks like a network bug but is just a hidden PHP error. **Always read `<folder>/error_log`** before guessing at the fix. The error message inside is usually enough to pinpoint the line and the syntax issue.

### Pitfall 4 — Partial-templates vs standalone PHP

A zip that contains `index.php`, `dashboard.php`, `settings.php`, `home.php` — where 4 of them call `requireAuth()` and reference `$db` directly — is **one app with sub-templates**, not 5 separate pages. The standalone URL will 500. Always identify the true entry point (the file that has `session_start`, DB connect, function defs) and treat the rest as components.

### Pitfall 5 — Don't upload a Node.js/Express bundle to a shared host

If the zip contains `server.js`, `package.json` with `"express"` as a
dependency, a `node_modules/` folder, or any `require('express')` /
`app.listen(...)` calls, the backend **will not run** on standard shared
hosting (cPanel, DirectAdmin Evolution on Contabo SG, Rumahweb, etc.).
Shared hosts expose PHP + static files only — no `node` interpreter, no
process manager, no port allocation for a long-running backend.

The frontend (HTML/CSS/JS) usually still works because of a hard-coded
`STATIC_PRODUCTS` / `STATIC_*` fallback in the JS bundle, but admin auth,
order processing, CMS editing, and any `fetch('/api/...')` calls will
404 or hang. Don't waste bandwidth uploading `node_modules/` (often
15-50MB) — strip it and the `server.js` first.

**Detection (Phase 1 inspection):**
```bash
# From a terminal pointed at the extracted staging:
ls package.json server.js app.js 2>/dev/null
grep -lE "require\(['\"]express['\"]\)|app\.listen\(" *.js 2>/dev/null
ls -d node_modules 2>/dev/null
```

**Triage before uploading — ask the user to choose:**
1. **Static-only deploy**: upload `index.html`, `style.css`, `app.js`,
   `assets/`, and any other client-side assets. Skip `server.js`,
   `package.json`, `package-lock.json`, `node_modules/`. The site
   renders, cart/checkout are non-functional, admin is non-functional.
2. **Refactor to PHP+SQLite**: convert the Express routes to PHP, the
   JSON file DB to SQLite, the JWT admin auth to PHP sessions. Best
   for shared hosting but takes 30-60 minutes of code work first.
3. **Move to a Node-capable host** (Render, Railway, VPS). Different
   deployment story — out of scope for this skill.

The user almost always picks #1 first (live-now, fix-later). Just make
the trade-off visible so they don't think the deploy failed when admin
login returns 404.

### Pitfall 6 — Don't upload `.db` / `.sqlite` / `.sql` from the zip

Apps that use SQLite typically auto-create the DB on first request via `new PDO('sqlite:...')` + `CREATE TABLE IF NOT EXISTS`. Pre-seeding with a stale DB from a different machine can:
- Use a different schema (column mismatch → 500s on every request)
- Be locked (SQLite exclusive lock from another process → "database is locked")
- Contain test data the user doesn't want on production

Skip the DB file. The app will build its own. Verify by checking FTP after the first HTTP hit — the file should appear with a sane size (often 12-32KB for a fresh schema).

### Pitfall 8 — Subfolder name conflicts

`podsindonesia.com/erp/` — fine if it doesn't exist. If the user already has files there, the new files merge in (or overwrite matching names). **Always `LIST` the target folder first** to see if it's empty, populated, or a name clash.

### Pitfall 9 — Upload size and time

- 1-2 MB static sites: instant.
- 10-50 MB PHP apps with assets: 1-2 min over FTPS.
- 100MB+ zip with images/videos: don't expand and re-upload. Either upload the zip and `unzip` server-side (cPanel File Manager has this), or use `lftp mirror` for resumable batch.

For this skill, the working assumption is: small-to-medium site (zip ≤ ~20MB), expand locally, upload file-by-file. For larger, suggest a different approach.

### Pitfall 10 — Cross-domain API endpoints baked into the bundle

The bundle was developed against a different backend (`digitalnusa.com`, a staging server, a CDN, etc.) and the URLs are hardcoded into HTML/JS. After upload, the dashboard renders fine but every `fetch(API_BASE)` returns a CORS error or 404 because that domain isn't (and shouldn't be) reachable from the new live URL.

**Pattern seen:** `const API_BASE = 'https://digitalnusa.com/pods-api.php';` plus `fetch(...)` calls plus an `<iframe src="https://digitalnusa.com/some-page/?v=embedded">` for an embedded widget.

**Fix sequence:**
1. Sweep the extracted staging for every `https?://...` URL. Triage into: (a) public CDNs/libs (jsdelivr, unpkg, fonts.googleapis) — leave alone; (b) cross-domain API endpoints — rewrite to point at the live domain; (c) cross-domain pages (links/iframes to other people's sites) — ask the user if they actually need them.
2. For each API endpoint the user wants to keep, **either** upload the corresponding PHP/handler from the bundle (if it exists) **or** create a stub that returns the JSON shape the JS expects. The JS almost always reads `json.success`, `json.data.vueState`, etc. — grep the JS for `json\.\w+` and `json\.data\.\w+` to discover the expected shape, then mirror it in the stub.
3. For endpoints the user says are "not important," leave the URL pointing to the original domain — better a 404 in console than a wrong rewrite that silently breaks something. But do flag it in the deploy summary so the user can decide later.

**Stub template:** see `templates/api-stub.php` — a minimal GET/POST/OPTIONS handler with CORS headers, JSON shape mirroring what `loadFromServer`/`saveToFirestore` expect, and an optional append-only log file for debugging.

### Pitfall 11 — Hardcoded paths to the OLD bundle structure

When the source zip had its own internal layout (e.g. `pods-indonesia/absen/`, `pods-indonesia/index.html`) and the JS in the bundle navigates with hardcoded paths (`window.location.href = '/pods-indonesia/absen/'`), deploying to a different subfolder (`/erp/absen/`) leaves the navigation broken. The page renders fine but clicking the "Absen" tile 404s.

**Symptom:** user clicks a menu, gets `Not Found — The requested URL was not found on this server`. Page-level render is fine. Only the click action breaks.

**Detection (post-deploy verification):**
```python
import urllib.request, re, ssl
ctx = ssl._create_unverified_context()
req = urllib.request.Request("https://domain.com/erp/", headers={"User-Agent":"Hermes/1"})
body = urllib.request.urlopen(req, context=ctx, timeout=10).read().decode("utf-8", "replace")
# all window.location.href targets
for m in re.finditer(r"window\.location\.href\s*=\s*['\"]([^'\"]+)['\"]", body):
    print(m.group(1))
```

**Fix:** patch the JS to point at the actual deploy path. Usually a 1-line `replace` in the local staging HTML, then re-upload just that one file. Verify by re-fetching the page and re-running the regex sweep — should show zero references to the old path.

## Deliverables checklist (post-deploy summary)

Tell the user:
1. The exact live URL(s) verified.
2. What was uploaded (file count, total size).
3. What was skipped and why.
4. What was patched (PHP version compat, URL/path rewrites) and what the source bug was.
5. What to monitor (e.g. "sub-template URLs will 500 if hit directly — always go through `index.php?page=X`").
6. Any open follow-ups (e.g. "you'll want a real `absen.db` backup strategy; right now it's auto-recreated fresh"; or "the `jd-socialmedia-kol/` link is still pointed at the original domain — let me know if you want it disabled or hosted here").
7. **Explicitly list every cross-domain URL/path rewrite** so the user can audit that nothing was missed. Format: "Rewrote `digitalnusa.com/pods-api.php` → `podsindonesia.com/pods-api.php` (3 occurrences in index.html). Stub PHP at root returns the JSON shape the dashboard expects."

## Reference files

- `references/cpanel-pitfalls.md` — error transcripts, gotchas, real failure modes with fixes.
- `references/directadmin-fallback.md` — what to do when port 21 is actively refused on a DirectAdmin Evolution host: panel URLs, login form, Evolution skin quirks, the **`/api/filemanager/upload` scripted upload path** (verified 2026-06-05), the `/evo/index.<hash>.js` bundle as an API discovery source, and how to spot an email-account-not-ftp-account gotcha.
- `scripts/ftps_deploy.py` — copy-paste starter for the upload loop.
- `scripts/probe_ftp_reachability.py` — quick port 21/22/990/2222/2083 reachability + banner probe. Run before assuming "credentials are wrong" — distinguishes active refuse (RST) from filtered (timeout) so the next step is correct.
- `scripts/directadmin_evo_upload.py` — **use this when FTPS is dead on a DirectAdmin Evolution host**. Login + list + multipart upload via the panel's own JSON REST API (`/api/login`, `/api/filemanager/list`, `/api/filemanager/upload`). Refuses to clobber `index.html`/`.htaccess` without `--force`.
- `scripts/evo_fix_wrapped_files.py` — companion to the above. Evolution's upload API stores the raw multipart envelope as the file content, breaking `.htaccess`, PHP-without-`?>`, and JSON. This script uploads a one-shot PHP helper per target file (helper ends with `?>\n` so it executes even when wrapped) that uses `file_put_contents()` to overwrite the file with a base64-decoded clean copy. Use it for any file that needs the envelope stripped.
- `scripts/megafix_evo_wrapped_files.py` — **batch version of the above**. Builds a single PHP helper that overwrites many files at once via a base64-encoded JSON manifest. One round-trip upload, one URL click. Use after `directadmin_evo_upload.py` has confirmed the envelope issue and you need to clean 5+ files. Faster than running `evo_fix_wrapped_files.py` in a loop.
- `templates/api-stub.php` — minimal GET/POST/OPTIONS handler for the cross-domain API rewrite case (Pitfall 9).

## Related skills

- `hermes-windows-shell-quirks` — for the workdir/quote bugs that hit every Windows deploy.
- `team-orchestrator` — if the deploy is part of a larger "build + deploy + announce" chain, route the deploy step to the Kode sub-agent.

## When port 21 is actively refused (not filtered, not credentials)

The user hands you "FTPS creds" and the obvious move is `ftplib.FTP_TLS(host, user, passwd)`. **Before declaring a credential mismatch**, run the reachability probe. The error shape tells you which world you're in:

| Error on port 21 | What it means | Next step |
|---|---|---|
| `ConnectionRefusedError` / `[WinError 10061] No connection could be made... actively refused` | Firewall replied with RST — port 21 is **deliberately closed** on this server (often by CSF/iptables), or the FTP service isn't running | Don't retry. Don't blame creds. The path forward is the hosting panel's web upload, not FTP. |
| `socket.timeout` / `timed out` (Python) / curl "Operation timed out" | Port is **filtered/dropped** — firewall silently swallowed the SYN | Could be a network problem on either end, or port 21 isn't open in the provider's edge firewall. Less common on shared hosting; more common if you're behind a corporate egress filter. |
| TLS handshake works, then `530 Login authentication failed` | Port is open, server replied, but the username/password is wrong | Re-check the username (might need `user@domain.com` form, see DirectAdmin note below) and password. |
| TLS handshake works, banner is non-FTP ("HTTP/1.0 400 Bad Request") | Wrong port — you hit a web panel, not FTP | Try the panel URL in a browser (often `:2222` on DirectAdmin, `:2083` on cPanel). |

**Reachability probe** (Python; safe to run from Windows native or WSL):

```python
import socket, ssl, urllib.request

host = "ftp.example.com"
ip = socket.gethostbyname(host)
print("ip:", ip)

# 1) Reachability sweep — known FTP/panel ports
for p in (21, 22, 80, 443, 990, 2082, 2083, 2086, 2087, 2095, 2096, 2222, 2221, 8443):
    s = socket.socket(); s.settimeout(3)
    try:
        s.connect((ip, p))
        print(f"  :{p} OPEN")
    except ConnectionRefusedError:
        print(f"  :{p} refused")
    except (socket.timeout, OSError):
        print(f"  :{p} filtered/timeout")
    finally:
        s.close()

# 2) TLS handshake on :21 — sometimes the port is open but only speaks TLS
ctx = ssl.create_default_context()
ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
s = socket.socket(); s.settimeout(6)
try:
    s.connect((ip, 21))
    try:
        print("plain banner:", s.recv(256))
    except socket.timeout:
        print("no plain banner (port may be TLS-only)")
    try:
        ss = ctx.wrap_socket(s, server_hostname=host)
        print("TLS OK")
    except Exception as e:
        print("TLS fail:", e)
except ConnectionRefusedError:
    print(":21 actively refused — FTP not exposed. Use panel upload.")
```

The script `scripts/probe_ftp_reachability.py` wraps this and is runnable as `python scripts/probe_ftp_reachability.py` from the skill directory.

**The trap to avoid:** when you see `Connection refused` your brain says "wrong creds" or "try a different password." Resist that. The server literally told you the port is closed. The fix is to find another path in, not to retry the same path harder.

## DirectAdmin Evolution detection & fallback

Observed on `jktweb.my.id` / `dsa1.jktweb.my.id` (Contabo Asia, SG node) — 2026-06-05. Many smaller Indonesian resellers run DirectAdmin instead of cPanel, and the modern **Evolution** skin (Vue.js SPA on top of DA core) differs from both classic DA and cPanel in three ways you must know:

1. **Login URL is `:2222/evo/login`, not `:2222/`** and not `:2083/`. Visiting `:2222/` gives a 302 to `/evo/`. Visiting `:2222/CMD_FILE_MANAGER` (DA classic) gives a 302 to `/evo/login?return-to=%2FCMD_FILE_MANAGER`. Direct API/curl against the classic DA command tree is **not** how Evolution works.

2. **Email account credentials are NOT FTP account credentials** by default. If the user gives you `something@domain.com` + password, that is almost certainly the **email account** (used for both mail login and DA panel login). FTP needs a separate account created under **Account Manager → FTP Accounts** in the Evolution UI. The cPanel habit of "username@domain.com is also the FTP login" does not hold here.

3. **FTP service may be disabled entirely.** Many Evolution installs run with the FTP daemon stopped (port 21 actively refused) and expect users to upload through the browser-based **File Manager** in the Evolution UI. This is a deliberate hardening choice, not a misconfiguration. Don't open a hosting support ticket about it.

**Diagnostic recipe (do this in order):**

```python
# 1) Does :21 actively refuse? (see "When port 21 is actively refused")
# 2) Does :2222 redirect to /evo/? (curl -sk -o /dev/null -w "%{redirect_url}\n")
#    If yes → DirectAdmin Evolution.
# 3) Can you reach the login form at https://<host>:2222/evo/login ?
#    GET that URL, check for <title>Evolution | DirectAdmin</title>.
# 4) Try logging in with the user-given creds at /evo/login. The Evolution
#    login form posts JSON to /api/login and returns a sessionID +
#    Set-Cookie: session=...; Path=/; HttpOnly; Secure; SameSite=Lax.
#    That cookie drives all subsequent API calls.
```

### The undocumented scripted upload path (added 2026-06-05)

Earlier notes said the Evolution File Manager is "per-session XSRF-token
and JS-driven" with no public REST. **That's outdated.** The Evolution
Vue.js bundle is a public asset at `https://<host>:2222/evo/index.<hash>.js`
(no auth required to download), and it embeds every API path as a string
literal. Grep the bundle for `/api/...` to find them. Verified endpoints
on asientoplaybie.com / dsa1.jktweb.my.id (2026-06-05):

| Method | Path | Body | Returns |
|---|---|---|---|
| `POST` | `/api/login` | JSON `{username, password}` | `{sessionID, loginURL}` + `Set-Cookie: session=...` |
| `GET`  | `/api/filemanager/list?path=<DIR>` | — | `{canonicalPath, files:[...], filesTotal, filesLimit}` |
| `GET`  | `/api/filemanager/tree?path=/` | — | `{dirs:[{name, dirs:[...]}, ...]}` |
| `GET`  | `/api/filemanager/disk-usage` | — | usage object |
| `GET`  | `/api/filemanager/download?path=<FILE>` | — | file bytes |
| `POST` | `/api/filemanager/upload?path=<FULL_FILE_PATH>` | multipart, single `file` field | **204 No Content** on success |
| `GET`  | `/api/info` | — | `{hostname, license:{active}, ...}` |
| `POST` | `/api/logout` | — | (uses same session cookie) |

**Critical gotcha — `path` for upload is the FULL target file path, not
the directory.** A request to `/api/filemanager/upload?path=/domains/example.com/public_html`
(i.e. directory, no filename) returns `409 Conflict {"type":"ALREADY_EXISTS"}`
even on a brand-new upload. Pass `/domains/example.com/public_html/index.html`
and you get a clean 204.

**Drop-in script:** `scripts/directadmin_evo_upload.py` — handles login,
list-before-upload, multipart upload of a local file or directory tree,
and refuses to silently clobber `index.html` / `index.php` / `.htaccess`
at the web root without `--force`. It does NOT expose a delete endpoint
because Evolution's JS bundle doesn't include one — for pre-deploy cleanup
of stale files, the user has to do it through the File Manager UI.

```bash
python scripts/directadmin_evo_upload.py \
    --panel-url https://dsa1.jktweb.my.id:2222 \
    --username asientoplaybie \
    --password '...' \
    --local ./build/ \
    --remote /domains/asientoplaybie.com/public_html \
    --dry-run        # remove this to actually upload
```

**If the user wants scripted FTP-style upload** and the panel has no exposed REST file-upload API, the realistic options are:

| Option | Effort | When to use |
|---|---|---|
| User uploads via Evolution File Manager in their browser | Zero agent work | One-off upload, ≤ ~50 files, ≤ ~100MB total. Tell the user to drag-drop into the panel. |
| **Agent scripts the upload via `/api/filemanager/upload` (this script)** | Low | Works for any size; no human in the loop. Default for any agent-driven deploy. |
| Open a hosting support ticket asking to enable FTP service | Asynchronous | Only if the user really needs FTPS automation. Many providers will refuse — they've decided FTP is deprecated. |
| Switch to a host that exposes FTPS | Heavy | Last resort. Not what the user asked for. |

- **Promising the upload will work before verifying the path.** "Oke, upload bentar ya" → fails → loses trust. Better: "Coba dulu, port 21-nya keliatan tutup, kita pindah jalur."

## Pitfalls unique to the Evolution `/api/filemanager/upload` path (added 2026-06-05, asientoplaybie.com)

The upload API works, but it has **two weird behaviors** that are easy to miss and will silently corrupt the deploy if you don't watch for them.

### Pitfall A — uploaded files contain the **raw multipart envelope**, not the inner content

The panel does not parse the multipart/form-data body. The file written to disk is the full `------Hxxx\r\nContent-Disposition: ...\r\n\r\n<actual content>\r\n------Hxxx--\r\n` body verbatim. Consequences:

- **`.htaccess`**: Apache tries to parse `------Hxxx` as a directive → 500 Internal Server Error on every request to that directory. The site is fully bricked until the user manually deletes the file in the File Manager UI. **Test with `curl -sI https://domain/.htaccess`** to detect this.
- **PHP files without a closing `?>`**: the trailing `\r\n------Hxxx--\r\n` after the last `<?php ... exit; ?>` line gets parsed as PHP. The `--` is the decrement operator; `--H` looks like `--$H` to the parser and triggers `syntax error, unexpected token "--"` at end of file → 500. **Always add a trailing `?>\n`** to any PHP file you're going to upload via the multipart API.
- **JSON files** (e.g. seed data): `json_decode()` of the envelope returns `null` because the body starts with `------Hxxx` not `{`. The seed never loads and the app's `init_schema()` creates empty tables.
- **Plain text files, HTML, CSS, JS**: mostly tolerable, since browsers and parsers see the envelope as text — the HTML renders with the envelope echoed as plain text at the top of the page, the CSS/JS may break because of leading junk.

**Detection after upload** (works for any file type):

```python
import urllib.request
r = urllib.request.urlopen(f"{PANEL}/api/filemanager/download?path={REMOTE_PATH}", timeout=10)
content = r.read()
# If the file starts with a multipart boundary, it was wrapped.
assert not content.startswith(b"------"), f"File {REMOTE_PATH} contains multipart envelope"
```

**The fix for any file that ends up wrapped**: upload a small PHP helper that uses `file_put_contents()` to overwrite the file with the **clean** content (delivered as a base64 string in the helper, then `base64_decode()`'d and written). The helper file itself is wrapped, but its PHP code runs because the helper ends with `?>\n` (so the trailing `------H...--` is echoed as text, not parsed as PHP). See the working pattern below.

**The fix for `.htaccess` is different**: the upload envelope IS the problem, so you can't write a clean `.htaccess` via the same path. Ask the user to delete the file in the File Manager UI, or use the WebSocket `/api/terminal` endpoint (admin/reseller only — not user-level) to `rm` it. There is no other programmatic delete.

### Pitfall B — no delete, no rename, no mkdir, no overwrite

The Evolution filemanager API exposes only six endpoints (login, list, tree, disk-usage, download, upload). The bundle is grep-able for `filemanager/...` strings and there's nothing else. Practical consequences:

- **Cannot overwrite existing files.** A second upload to the same path returns `409 ALREADY_EXISTS`. So:
  - The host's default `index.html` (114KB placeholder) blocks uploading your `index.html` at root.
  - You can't fix a broken `.htaccess` by re-uploading a good one.
  - You can't `sed`-update a JS file in place.
- **Cannot create directories.** `assets/` doesn't exist on a fresh host, so uploading to `assets/foo.png` fails with `404 NOT_FOUND` (the upload path's parent dir must already exist).
- **Cannot delete or rename files** (same reason — no endpoint).
- **No batch upload.** Each file is one POST request; a 19-file upload is 19 round-trips. Tolerable at <1s per file for small files; will hit connection-abort errors on large parallel batches. Use `ThreadPoolExecutor(max_workers=3-4)` not 10+.

**Workarounds** (all verified 2026-06-05):

1. **For files that exist and need replacing** (e.g. `api.php` with a trailing `?>` added): upload a one-shot PHP helper that reads the file, strips the multipart preamble (find first `<?php`, take from there), and writes the clean content back. The helper ends with `?>\n` so it executes correctly even though it's also wrapped. Template:

   ```python
   import urllib.request, base64, uuid
   clean = open(r"C:\staging\api.php", "rb").read()
   b64 = base64.b64encode(clean).decode()
   helper = (
       b'<?php $b=base64_decode("' + b64.encode() + b'");'
       b'$p=__DIR__."/api.php";'
       b'$r=file_put_contents($p,$b);'
       b'echo "ok=".($r!==false?"1":"0")." size=".filesize($p);'
       b' ?>' + b'\n'
   )
   # ... upload helper to /domains/<dom>/public_html/fix_<rand>.php,
   # ... then curl https://<dom>/fix_<rand>.php to execute it.
   ```

2. **For files at the web root that conflict with a host default** (e.g. placeholder `index.html`): use a different filename and route to it from a PHP wrapper. Pattern: upload `playbie_home.html` (no conflict), upload `index.php` (no conflict) containing `<?php readfile(__DIR__ . '/playbie_home.html'); ?>`. The PHP wrapper executes (the wrapped envelope preamble becomes harmless HTML garbage at the top of the page — or fix it the same way as #1 above for a clean render).

3. **For files into a subdirectory that doesn't exist** (e.g. `assets/`): upload a one-shot PHP helper that does `@mkdir(__DIR__ . '/assets', 0755, true);` and then `rename`s from temp paths. Upload the helper, then upload the files to the **root** with names like `upload_foo.png`, then run the helper via curl. The helper moves them into the now-existing `assets/` and cleans up the temp files. Downside: every moved file is on disk **twice** during the transfer (root + `assets/`) so the disk-space math is briefly inflated.

4. **For pre-existing files that must be deleted** (e.g. the broken `.htaccess` from Pitfall A): ask the user to delete via the Evolution File Manager UI. This is a 30-second task for the user and not scriptable from the agent side. **Frame it as a 1-line ask**: "Bisa lu buka File Manager → klik kanan `.htaccess` → Delete? Setelah itu gua langsung lanjut upload sisanya." Don't try to do this from the agent and burn tool calls on WebSocket plumbing.

### Pitfall C — file content type matters for browser rendering

The multipart `Content-Type` of each part gets stored alongside the content. The Evolution server uses it for `Content-Type` when serving the file back. Default to:

| File | Use this Content-Type |
|---|---|
| `.html` | `text/html` |
| `.css` | `text/css` |
| `.js` | `application/javascript` |
| `.json` | `application/json` |
| `.php` | `application/x-php` |
| `.png` | `image/png` |
| `.jpg` | `image/jpeg` |
| `.svg` | `image/svg+xml` |
| `.txt` | `text/plain` |

A `.html` uploaded with `application/octet-stream` will download instead of render. The drop-in script `scripts/directadmin_evo_upload.py` sets these by extension — extend its `mime_map` dict if you need exotic types.

### Pitfall D — PHP files uploaded via the API **must end with `?>\n`**

When PHP parses the wrapped file, it sees:

```
------Hxxx\n                         (echoed as text)
Content-Disposition: form-data; ... (echoed as text)
\n                                    (echoed as text)
<?php                                (enter PHP mode)
... your code ...
                                      (still in PHP mode — no closing ?>)
------Hxxx--                          (parsed as PHP — `--$H` is decrement of $H)
```

The PSR-12 "files with only PHP code should not have a closing tag" rule does not survive the multipart wrapper. Add a `?>\n` to every PHP file just before upload, or use the `file_put_contents` helper trick to overwrite with a clean version. Verified line 513 of a wrapped file produced `syntax error, unexpected token "--"`; appending `?>\n` resolved it.

### Pitfall E — connection aborts on parallel uploads

`ThreadPoolExecutor(max_workers=10)` against this API triggers `[Errno 10053] An established connection was aborted` after 3-5 successful uploads. The server appears to rate-limit or kill idle connections. Workarounds: cap workers at 3-4, add `time.sleep(0.5-1.0)` between submissions, and re-login (clear cookie jar, POST to `/api/login` again) before retrying failed uploads. Files that failed to upload show no error on the server side — they just weren't created. Re-run the list and diff to confirm coverage.

### Pitfall F — `private_html/` is usually a symlink to `public_html/`

Seen on asientoplaybie.com: `private_html/` is a symlink pointing to `public_html/`. Every file uploaded to `public_html/` ALSO appears in `private_html/` listings. This is **not a bug** — DirectAdmin uses the symlink so the same `public_html/` content is served over both HTTP (80/443 from `public_html/`) and HTTPS-without-SNI (from `private_html/`). Implication: `private_html/` has its own `.htaccess` (the same one), and a "fix .htaccess" needs to be done once — both views resolve to the same inode. Don't waste time looking for a separate `private_html/` file tree.

### Pitfall F2 — `index.html` priority beats `index.php` on DirectAdmin Evolution (added 2026-06-05, asientoplaybie.com second session)

If the user has the default DirectAdmin placeholder `index.html` (the 115KB "Account Suspended / hosted by DirectAdmin" page) sitting in `public_html/`, and you ALSO upload a wrapper `index.php` that does `readfile('playbie_home.html')`, **the placeholder wins**. Apache's `DirectoryIndex` on this host is `index.html index.htm index.shtml index.php index.php5 ...` and `index.html` is checked first. Your `index.php` wrapper is never executed — the user only ever sees the placeholder.

**Detection:**
```bash
curl -sI https://<domain>/ | head -3
# Look for the size of the response body — if it matches the placeholder (114972 bytes), the placeholder is being served.
# Or: curl -s https://<domain>/ | head -c 200 — look for "Something amazing will be constructed here" or "hosted by DirectAdmin".
```

**Two real fixes, only one works on this host:**

1. **Delete the placeholder `index.html` via the panel File Manager UI** (the user has to do this — there's no API). 30 seconds. Then `index.php` wrapper kicks in. This is the correct fix and the only one that gives you a clean root URL.

2. **Subfolder approach** — upload everything to `public_html/playbie/` and have the user visit `domain.com/playbie/`. The placeholder at root is harmless. Loses the "site at root" goal but sidesteps the conflict entirely. See Section 11b(b) in `website-deploy-via-ftp`.

**The trap**: you'll be tempted to fight this by trying to upload a clean `.htaccess` with `DirectoryIndex index.php index.html`. **Don't.** Per Pitfall A, uploaded `.htaccess` is wrapped in a multipart envelope that Apache fails to parse → 500 on every request. There's no way to set `DirectoryIndex` cleanly through the upload API. The user MUST delete the placeholder in the panel, OR move to a subfolder.

**Framing for the user** (Indonesian casual-professional, this user's tone):

```
Bro, di public_html/ ada index.html placeholder bawaan hosting (115KB,
isinya "Something amazing will be constructed here"). Apache serve ini
duluan sebelum index.php kita, jadi wrapper index.php kita ke-skip.

Solusi: lu buka File Manager di DA panel -> klik kanan `index.html` 
-> Delete. 30 detik beres. Habis itu refresh, site kita yang muncul.
```

### Pitfall F3 — When renaming files to bypass a host default, ALL cross-links need rewriting (added 2026-06-05, asientoplaybie.com)

When you can't deploy a file at its natural name (because it conflicts with a host default or with another file you can't delete), you rename it and route through a wrapper. Common example: your app's `index.html` becomes `playbie_home.html`, served via an `index.php` wrapper. **Every** cross-reference to the old name has to be updated in **every** file that references it:

- `href="index.html"` → `href="index.php"`
- `href="index.html#anchor"` → `href="index.php#anchor"` (anchors are easy to miss)
- `href="lookbook.html"` → `href="lookbook.php"`
- `href="product.html?id=X"` → `href="product.php?id=X"`
- `src="index.html"` (rare but happens for OG meta redirects)
- `window.location.href = '/playbie/'` in any JS that navigates back to root

**Sweep recipe** (run after renaming, before upload):

```bash
cd /tmp/playbie_deploy
# All cross-references to .html
grep -nE 'href="(index|lookbook|product)\.html|src="(index|lookbook|product)\.html' *.html
# Anchors are usually the miss
grep -nE '(index|lookbook|product)\.html#' *.html
# All window.location references in JS
grep -nE 'window\.location' *.js
```

Then one sed pass per file:
```bash
for f in playbie_*.html; do
  sed -i 's|index\.html|index.php|g; s|lookbook\.html|lookbook.php|g; s|product\.html|product.php|g' "$f"
done
```

Verify with the same greps — should return zero matches. The 5 minutes of sed discipline here saves the 30 minutes of "why is the lookbook 404" debugging later.

### Pitfall F4 — User manual upload via panel can break your deploy (added 2026-06-05, asientoplaybie.com)

After the agent deploys via the scripted `/api/filemanager/upload` path, the user may continue uploading manually via the panel File Manager (drag-drop, "send to FTP", whatever they're used to). Two real failure modes observed:

1. **User re-uploads the original (unpatched) files**, e.g. drops the whole `Playbie/` folder from the source zip into `public_html/`. The unpatched `app.js` has hardcoded `/api/...` URLs (not `/api.php?path=...`), so the API 404s and the catalog renders empty. Symptom: home page looks correct, "Explore Catalog" section is empty, console shows `/api/products 404`.

2. **User uploads `node_modules/`** from a Node.js dev project (16+ MB of junk). Slows the panel, fills disk, and most importantly — the user has now shipped their dev's `server.js`, `package.json`, etc. to the web root. None of it executes (no Node runtime), but the public URLs to `package.json` and `server.js` may leak dev info.

**Detection** (after the user says "I uploaded the rest"):
```python
# Check what's in the public_html root
r = urllib.request.urlopen(f"{PANEL}/api/filemanager/list?path=/domains/<domain>/public_html", context=ctx, timeout=10)
files = json.loads(r.read())['files']
suspicious = ['node_modules', 'Playbie', 'package.json', 'package-lock.json', 'server.js', 'Playbie _1_.zip', '*.zip']
for f in files:
    for s in suspicious:
        if s in f['name'] or f['name'].endswith('.zip'):
            print(f"  WARN: {f['name']} ({f.get('sizeBytes'):,} bytes)")
```

**Pre-emptive framing** (when handing off after a successful scripted deploy, in this user's tone):

```
Bro, kalau nanti lu mau upload/update manual via File Manager, 
INGAT:

1. Jangan upload folder Playbie/ atau node_modules/ ke public_html root.
   Folder-folder itu dari dev project, bukan deployment. Bisa di-skip.
2. Kalo upload file app.js atau *.html manual, PASTIKAN itu versi yang
   udah di-patch (punya /api.php?path=... bukan /api/...).
3. ZIP hasil download dari Playbie yang original = bundle source code.
   Extract, ambil file frontend-nya doang (HTML/CSS/JS/assets), upload
   satu-satu. Jangan upload ZIP-nya langsung.

Kalau udah terlanjur, gampang fix: hapus via panel (select all -> delete)
dan panggil gua biar re-upload clean version-nya.
```

This 30-second conversation saves an hour of "site is broken" debugging later. The user *will* forget and re-upload the source zip — make the warning visible before they do it.

### Pitfall G — Hermes container path mismatch: `write_file` vs `terminal`

When working in this Windows-hermes environment, `write_file(path='/tmp/...')` resolves to `C:\tmp\...` (not what `terminal` sees), while the actual staging directory is `C:\Users\Clout Indonesia\AppData\Local\Temp\playbie_deploy`. `terminal` and `execute_code` are **not** on the same filesystem view as `write_file` for `/tmp/...` paths. To avoid this, build staging in `execute_code` from the start using `os.path.join(tempfile.gettempdir(), ...)` so both tools see the same path.

## Cross-provider cheat sheet (Indonesia + SEA)

The cpanel-shared-hosting-deploy skill is named for cPanel because that's the most common, but the **diagnostic flow** (probe → classify error → pick transport) is provider-agnostic. Observed fingerprints:

| Provider | Panel URL | FTP host format | Notes |
|---|---|---|---|
| Rumahweb | `https://[domain]:2083/` (cPanel) or `https://[server].rumahweb.net:2083/` | `ftp.[domain]` or `[server].rumahweb.net` | Pure-FTPD TLS, SSL cert hostname mismatch is **expected** (cert is for `*.iixcp.rumahweb.net`). The user's main domain. |
| Niagahoster | `https://[domain]:2083/` | `ftp.[domain]` | cPanel under the hood. Same hostname-mismatch quirk. |
| Hostinger | `https://hpanel.hostinger.com/` | `ftp.[domain]` or shared IP | hPanel is custom, not cPanel. File Manager is the recommended upload path. |
| jktweb.my.id (and other Indonesian resellers) | `https://[server].jktweb.my.id:2222/evo/login` (DA Evolution) | Often **disabled by policy** — port 21 actively refused | Use panel File Manager. See DirectAdmin Evolution section. |
| Contabo (direct) | `https://[server]:8443/` (custom) or DA/cPanel addon | Per-account | Hosting is unmanaged/VPS-first; shared-hosting tier is resold by partners. |
| DigitalOcean / Vultr / Linode | N/A — VPS only, SSH/SFTP only | N/A | Use the SSH/SCP path, not this skill. |

The IP-owner lookup (`curl https://ipinfo.io/<ip>/json | jq .org`) often disambiguates when the panel URL isn't obvious. Look at `.hostname` and `.org` fields for the provider name.

## Mandatory pre-deploy backup pattern (added 2026-06-05)

The user stated: "jangan ada yang dirubah sistem yang ada baik yg udh berjalan, kalau mau ada backup dulu sebelum dirubah2 biar bisa di restore." This is a **hard rule**: any change, even small add-a-card edits, gets a pre-deploy backup so the user has a known rollback path.

**For LOCAL staging backups** (cheapest, fastest, what to revert to):

```python
import os, zipfile
from datetime import datetime
from pathlib import Path

src_root = Path(r"C:\Users\Clout Indonesia\AppData\Local\Temp\pods-staging\pods-indonesia")
ts = datetime.now().strftime("%Y%m%d-%H%M%S")
backup_zip = Path(rf"C:\Users\Clout Indonesia\AppData\Local\Temp\erp-staging-backup-{ts}.zip")
with zipfile.ZipFile(backup_zip, 'w', zipfile.ZIP_DEFLATED) as zf:
    for f in src_root.rglob('*'):
        if f.is_file():
            zf.write(f, f.relative_to(src_root.parent))
print(f"Backup: {backup_zip} ({backup_zip.stat().st_size} B)")
```

**For server-state backups** (FTP-side, slower, for catastrophic rollback):

```python
import ftplib
ftp.cwd("/public_html/erp")
# Pull the current live index.html (or whatever you're about to replace)
buf = io.BytesIO()
ftp.retrbinary("RETR index.html", buf.write)
Path(f"server-backup-{ts}.html").write_bytes(buf.getvalue())
```

Order: **backup → show plan → ask if needed → execute.** Never reverse this. The user wants to see "rollback path exists" *before* bytes move, not after.

Even small tasks ("just add a new card to the SPA") need:
1. Timestamp the local staging tree into a zip
2. Tell the user the path + size
3. List exactly what will be created/modified/skipped
4. Then upload

## Adding a new card/link to an existing SPA grid (added 2026-06-05)

Common follow-up: user already has 5 cards deployed, now wants a 6th. The pattern:

- **Insert after the last card's closing tag**, not at the end of the file. Appending past the grid's `</div>` puts the new card outside the grid.
- Match the existing card class set: `rounded-2xl p-5 sm:p-6 min-h-[140px] sm:min-h-0 ... cursor-pointer active:scale-95 hover-lift` so the new card looks native.
- Use a different border color (e.g. `border-amber-200` if the others are slate) so the new card reads as a visual addition.
- Use `<a href="...">` (not `<button onclick="...">`) when the target is a real URL, not a SPA tab switch. Add `no-underline` so Tailwind doesn't apply default link styling.
- Re-run `responsive-css-tuner/diagnose_mobile.py` on the rebuilt HTML before uploading — the new card can shift the grid layout enough to surface a previously-buried issue.

```python
# Find anchor: last existing card's closing tag
m = re.search(r"<!-- Absen \(Unlocked\) -->.*?</button>", src, re.DOTALL)
assert m, "absen card not found — anchor lost, abort"
new_card = '... your new card markup ...'
src = src[:m.end()] + new_card + src[m.end():]
```

## UTF-8 BOM stripping (added 2026-06-05)

Some zipped HTML files start with a UTF-8 byte-order-mark (`\xEF\xBB\xBF`). Mostly invisible, but breaks CSS parsing in some browsers. Add to inspection step:

```python
with open(p, "rb") as f:
    raw = f.read(50)
if raw[:3] == b"\xef\xbb\xbf":
    raw = raw[3:]
    with open(p, "wb") as f:
        f.write(raw)
```

## Orphan internal links (added 2026-06-05)

Different from Pitfall 9 (cross-domain). An *internal* endpoint that exists in the source project (e.g. `/download` from a Flask app) but not in the deployable subset (only the static HTML was deployed, not the backend). The button renders fine, click 404s.

Triage: ask the user, stub it, or remove the button. Don't leave it — silent 404s erode trust.
