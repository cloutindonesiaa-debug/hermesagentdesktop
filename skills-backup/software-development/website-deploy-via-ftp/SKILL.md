---
name: website-deploy-via-ftp
description: Deploy a static HTML + PHP website (zip/folder) to a cPanel/Rumahweb-style FTPS host end-to-end. Covers extract → upload → runtime bug-patch → live verify. Use when a non-technical user shares a local zip and wants it live on their domain via FTP, with login-gated admin pages if PHP is involved.
---

# Deploy a Website via FTPS (cPanel / shared hosting)

## When this skill applies

- User hands you a local `*.zip` (or folder) and says "upload this to my server" / "make it live"
- They have an FTPS-capable cPanel host (Rumahweb, Niagahoster, Hostinger, etc.)
- The source is plain HTML + maybe PHP — no build step, no Node
- They want it served on their existing domain (not a fresh host)

If the user wants a NEW domain, hosting setup, DNS, or a static-only site on Netlify/Vercel, this skill is **not** the right fit.

## Workflow

### 1. Receive the source & decide the target
- Get the absolute local path of the zip/folder.
- **Ask one question**: subfolder (`/erp/`, `/v2/`, etc.) or domain root? **Default to subfolder** — clobbering `podsindonesia.com/index.html` is usually destructive. Even if root is the goal, ask once.

### 2. Extract locally
- **Prefer Python `zipfile`** over `unzip` CLI — the CLI is not always present.
- `execute_code` runs in **Windows native** context, so use `C:\Users\...` paths there. `terminal` is WSL/bash, so use `/mnt/c/Users/...` there. Mixing the two silently fails.
- If `terminal` chokes on the cwd (path with spaces, etc.), set `workdir=/tmp` and pass absolute paths — the shell-wrapper `cd` prefix is brittle.

### 3. Inspect the bundle
- List every entry point: `index.html`, `index.php`, partials, `*.db`.
- Identify **partial-template files** (e.g. `dashboard.php` that starts with `<?php requireAuth('dashboard'); ?>`). These give 500 if hit directly — verify them via their parent router, not standalone.
- Note any `.db` / `.sqlite` files. **Skip uploading them** unless the user explicitly says otherwise — the server's first schema-init will create a fresh one. Uploading a bundled DB often clobbers production data.

### 4. Detect the host type and pick the right path

**Before any FTPS work, identify what kind of host this is.** The same domain can sit on vastly different panels.

| Signal | Panel | Upload path |
|---|---|---|
| `https://<host>:2083` (cPanel SSL), `theme: cpanel`, `paper_lantern` | cPanel | FTPS on port 21 (next section) |
| `https://<host>:2222/evo/` with Evolution skin (Vue SPA), hostname like `dsa1.jktweb.my.id` / `dsX.rumahweb.net` / `srvX.niagahoster.net` | **DirectAdmin Evolution** | REST API (Section 4b) — FTP usually closed |
| `https://<host>:8443` (Plesk), "Plesk Obsidian" branding | Plesk | FTPS usually works, panel also has API |
| `https://<host>/cpanel` or default cPanel theme | cPanel | FTPS |

**Why this matters:** on DirectAdmin Evolution, port 21 is **actively refused** by design on most modern installs, and the user-level account has **no shell** and **no `rm`**. The only path is the Evolution REST API. Trying FTPS first wastes 5-10 minutes on connection-refused loops.

### 4a. Connect to FTPS (cPanel path)
- **Before you connect, probe port 21.** Use `scripts/probe_ftp_reachability.py` (in the sister `cpanel-shared-hosting-deploy` skill). A `ConnectionRefusedError` is NOT a credential problem — the server is telling you the port is deliberately closed. The cpanel skill's "When port 21 is actively refused" section has the full diagnosis tree.
- Expect a **TLS cert hostname mismatch** on shared hosting (e.g. cert is `kelud.iixcp.rumahweb.net`, host is `ftp.podsindonesia.com`). This is a server-config issue, not your problem.
- Use an unverified TLS context:
  ```python
  import ssl, ftplib
  ctx = ssl._create_unverified_context()
  ftp = ftplib.FTP_TLS(host, user=user, passwd=pw, context=ctx)
  ftp.prot_p()  # encrypt the data channel
  ```
- `LIST` the root first to see what's there. If the host is cPanel-style, the web root is `/public_html/` (sometimes symlinked as `www`).
- **On DirectAdmin (jktweb, dewaweb, and other Indonesian resellers)**, the FTP account is **separate from the email account**. If the user gave you `something@domain.com` creds, those may only be email/panel creds — FTP needs its own account under `Account Manager → FTP Accounts` in the panel. **If port 21 is closed too, skip to Section 4b** — Evolution API is the path.

### 4b. DirectAdmin Evolution REST API (when port 21 is closed)

If you see `Connection refused` on `:21` AND `:2222/evo/` loads a Vue login page, you are on **DirectAdmin Evolution** (common on jktweb.my.id, dewaweb, Contabo-based resellers). The whole upload goes through a JSON REST API. Full reference: `references/directadmin-evolution-api.md`. Working starter code: `scripts/da_evo_upload.py`. Live-tested against `dsa1.jktweb.my.id`.

**Login** (returns a session cookie):
```python
import urllib.request, json, ssl, http.cookiejar
CTX = ssl._create_unverified_context()
jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(
    urllib.request.HTTPCookieProcessor(jar),
    urllib.request.HTTPSHandler(context=CTX),
)
base = "https://HOSTNAME:2222"
data = json.dumps({"username": "USER", "password": "PASS"}).encode()
opener.open(urllib.request.Request(f"{base}/api/login", data=data, method="POST",
    headers={"Content-Type": "application/json"}), timeout=15).read()
# jar now holds: session=XXXXXXXX; Path=/; HttpOnly; Secure; SameSite=Lax
```

**Upload one file** (this API does NOT overwrite — see Pitfall #1):
```python
import uuid
def upload(opener, base, target_path, content, ct="application/octet-stream"):
    boundary = "----H" + uuid.uuid4().hex
    fname = target_path.rsplit("/", 1)[-1]
    body = []
    body.append(f"--{boundary}".encode())
    body.append(f'Content-Disposition: form-data; name="file"; filename="{fname}"'.encode())
    body.append(f"Content-Type: {ct}".encode())
    body.append(b"")
    body.append(content)
    body.append(f"--{boundary}--".encode())
    body.append(b"")
    data = b"\r\n".join(body)
    url = f"{base}/api/filemanager/upload?path=" + urllib.parse.quote(target_path)
    req = urllib.request.Request(url, data=data, method="POST",
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    return opener.open(req, timeout=120).status  # 204 on success, 409 on conflict
```

**List, download, tree:**
- `GET /api/filemanager/list?path=/domains/<domain>/public_html` → JSON of files
- `GET /api/filemanager/download?path=...` → raw bytes
- `GET /api/filemanager/tree?path=/` → directory tree (shape is object, not array — `["dirs"]`)

**Endpoints that exist but are restricted:**
- `/api/terminal` — WebSocket-only (use raw socket + base64 Sec-WebSocket-Key + manual frame encoding). 101 Switching Protocols on connect. Most user-level accounts have access; the panel renders an interactive shell.
- `/api/execute` — 403 ACCESS_DENIED for regular users. Only reseller/admin can use.
- No delete/rename/overwrite/extract API exists. **This is the central constraint** (see Pitfall #1).

**Login panel via browser if API fights you:** navigate to `https://<host>:2222/evo/login`, type the panel-level user (often a short username like `asientoplaybie`, NOT an email), use browser_console to call `/api/login` and verify with `/api/filemanager/list`.

### 5. Plan the upload
- `LIST` the target folder. **List every file that will be overwritten** to the user before uploading — be explicit: "this will replace `podsindonesia.com/erp/index.html`."
- Create subfolders with `MKD`. If a folder already exists, expect `550 ... File exists` and treat it as success.
- Decide the skip-list: backups (`*.bak.*`), bundled DBs, hidden `index.bak.html`, `node_modules/`, `dist.zip`, anything not in the user's deploy intent.

### 6. Upload
- `STOR` in **binary** mode for every file (`ftp.storbinary`).
- For large zips or many small files, do it in batches and `LIST` between batches to catch partial failures.
- Always re-`LIST` the final state and confirm sizes match local.

### 7. Probe the server runtime
Before debugging 500s, check what the server actually has:
```python
# write a probe.php, upload, hit it, then delete
import io
ftp.storbinary("STOR _probe.php", io.BytesIO(b"<?php echo PHP_VERSION; ?>"))
# hit https://.../_probe.php
# then ftp.delete("_probe.php")
```
A shared host often runs **PHP 7.4** by default even if your local is 8.x. `match()`, `?->`, named args, and `readonly` properties will all break.

### 8. Patch runtime issues — the common ones

| Symptom | Cause | Fix |
|---|---|---|
| `Parse error: unexpected '=>'` on a `match()` block | PHP 7.4 server, source uses PHP 8 `match()` | Replace with `if/elseif` chain |
| 500 on a partial like `dashboard.php` | Partial references `requireAuth()` not defined anywhere | Define the function, then **call it from the router BEFORE `include`** the partial (not from inside the partial) |
| Login form renders but CSRF input is empty | Function-scope `include` doesn't see the global `$csrf_token` | In the partial, use `$GLOBALS['csrf_token'] ?? ''`; pass values from the gate via `$GLOBALS['_authMenu']` etc. |
| Page shows login form **and** the protected content | `requireAuth()` is called inside the partial, then the partial's outer HTML still echoes | Restructure: check auth → include partial OR include login form, never both |
| `500` with empty body | `display_errors=off` in cPanel | Read `/public_html/error_log` (and per-folder `error_log`) for the real trace |

### 9. Verify live
- HTTP-probe **every** entry point. Don't trust "the folder uploaded" — actually hit it.
- A 200 with the expected content snippet is the success criterion.
- 200 with an **empty body** is still 200 in HTTP terms — verify content, not just status.
- Re-read `error_log` after verification to catch non-fatal warnings.
- For a fresh server with unknown PHP version, run `scripts/probe-php-version.py` BEFORE pushing PHP code. The probe uploads a 1-line `_phpver.php`, hits it, then deletes it. Saves a round trip when `match()` etc. blow up on a 7.4 host.

### 10. Hand off
- Report each URL with status.
- Surface what was **skipped** (DBs, backups, third-party endpoints that 404).
- If login was added, give the user the **default passwords** explicitly so they can log in.
- Note any 404'd endpoints that are the user's responsibility (third-party hosts, link rot).

### 11. Gating a static SPA behind a login (the `index.html` → `index.php` trick)

When the user wants a static SPA (Vue/Tailwind/etc. — no PHP auth code in the bundle) protected by a password, the smallest viable change is to rename `index.html` → `index.php` and prepend a session check that redirects unauthed visitors to a standalone `login.php`.

**Steps:**
1. Save the contents of `templates/spa-login-gate.php` as the **prefix** of a new `index.php`.
2. Append the **entire original `index.html`** content after the `?>` of the prefix. The SPA still runs as it did, but every request first runs the PHP gate.
3. Upload a companion `login.php` (use `templates/login-page.php`) at the same folder level.
4. **Delete the old `index.html`** — cPanel Apache usually prefers `index.php` in `DirectoryIndex`, but having both is asking for trouble. Always remove the source after conversion.

**When to use this vs. embedding auth into the SPA:**
- Use the gate when: the SPA has no client-side auth, the user wants a single shared password, and modifying the SPA is out of scope.
- Embed in the SPA when: the user wants per-user accounts, role-based access, or the SPA already has login code (just point it at the live API).

**The hard-nav vs. SPA-state problem:** A button in a sub-page that does `window.location.href = '/erp/'` (hard navigation) will cause the SPA to reload and re-boot into its **default view** (usually Dashboard), not the card-menu state the user was on before. There are three fixes; the user has been observed to strongly prefer #1:
1. **Login-gate the SPA entry** (this section). Clicking back from a sub-page → goes to login → authed → SPA boots fresh. Loses SPA state, but the user accepts that as a fair trade for the security.
2. **localStorage handshake** (fragile, breaks across browsers/devices/incognito).
3. **Add a back button inside the SPA itself** (requires SPA code edits, sometimes impossible if the bundle is minified).

**A `Back` link in a PHP sub-page that points at the SPA's directory will be wrong by default** — it triggers a hard reload. Point it at the login page (which then redirects to the SPA) instead of at the SPA directly. This makes the back-navigation feel like "log out and go home" rather than "go back to where I was."

## Pitfalls (this user's project, but the pattern generalizes)

- **Bundled DBs are traps.** A `.db` file in the zip is almost always a developer's local snapshot. Uploading it clobbers the server's schema-initialized DB. Skip by default.
- **Hardcoded paths in HTML/JS.** Apps developed against `localhost/` or `something.com/folder/` ship with hardcoded paths. The first walk is `grep -nE 'localhost|/[a-z-]+/' *.html` on the extracted bundle.
- **Hardcoded third-party endpoints.** Same as above but external — e.g. `const API_BASE = 'https://digitalnusa.com/...'`. Even after URL-replacement, the **target server has no equivalent endpoint**, so requests 404. Either build a stub, or surface the 404 to the user as expected.
- **cPanel `error_log` location.** Always `/public_html/error_log` at the site root, but PHP also writes to per-folder `error_log` files when scripts in subdirs error. `LIST` recursively or check the most likely one.
- **Per-menu login vs global login.** If the user wants 4 different menus (Dashboard / Marketing / HRD / Operasional) with separate passwords, store them in a `passwords` table keyed by `menu`, and gate with `requireAuth($menu)` checking `$_SESSION['auth'][$menu]`. Don't try to share a session across them.
- **CSRF tokens + `include`.** When a function in `index.php` includes a partial, the partial's local variables (including any `$csrf_token` from `index.php`'s scope) are NOT visible. Use `$GLOBALS['key']` in both places.
- **DirectAdmin Evolution: upload stores the raw multipart envelope as the file.** `/api/filemanager/upload` does NOT extract the inner file body. The file on disk is the full multipart message: `------Hxxx\r\nContent-Disposition: form-data; name="file"; filename="X"\r\nContent-Type: ...\r\n\r\n<inner content>\r\n------Hxxx--`. For `.php` files this is **harmless** because PHP ignores everything outside `<?php ... ?>` (preamble is echoed as raw text, which is fine if the consumer uses `readfile()` or ignores the first N lines). For `.html`, `.css`, `.js`, `.json`, image, etc. — also harmless, browsers don't care about leading binary. **But for `.htaccess` it's fatal** — Apache parses `.htaccess` line-by-line, and `------Hxxx` is not a valid directive, so the server returns 500 for the entire document root. **Never upload a `.htaccess` via this API** unless you have a way to delete it first. Workaround: configure Apache behavior through PHP files at web root, not `.htaccess`. See Section 11 and Section 7b for the full workaround.
- **DirectAdmin Evolution: no overwrite, no delete, no rename.** 409 ALREADY_EXISTS is permanent. You cannot fix mistakes, you cannot update a file with a new version, you cannot remove junk. The only way to "replace" a file is to upload it with a new name and have the application route to the new name. **This means: every file you upload must use a unique name on first try, and you must plan index.html-style conflicts in advance.** See Section 7b for the index.html conflict recipe.
- **DirectAdmin Evolution: `private_html` is often a symlink to `public_html`.** Uploads to one show up in the other, and broken `.htaccess` in one breaks the other. Uploading to `private_html` is NOT a way to bypass a broken root `.htaccess`. (Confirmed on Contabo SG / jktweb.my.id installs.)
- **DirectAdmin Evolution: panel-level user vs FTP user vs email user are all different accounts.** A user that can log into `https://host:2222/evo/` may not have an FTP account, and an email account like `hello@domain.com` is *only* an email account, not a panel account. When the user hands you credentials, ask which type they are, or just use the panel creds with `/api/login` and the file manager.
- **Shared hosting may not run Node.js.** If the user hands you a Node/Express app (e.g. `server.js` + `node_modules/`), the only path on most cPanel/DirectAdmin shared hosts is to **port the backend to PHP**. The frontend HTML/CSS/JS uploads fine, but the `/api/*` calls will 404 without a server-side runtime. See Section 7b for the full porting recipe.
- **The `index.html` placeholder in a fresh hosting account conflicts with your SPA's `index.html`.** DirectAdmin ships a 114KB "Account Suspended / hosted by DirectAdmin" placeholder at `public_html/index.html`. You can't delete it (no API) and you can't overwrite it (409). The fix: upload your SPA's HTML under a different name (`playbie_home.html`) and add a small `index.php` wrapper that does `<?php readfile(__DIR__ . '/playbie_home.html'); ?>`. Update cross-links (`href="index.html"` → `href="index.php"`, `index.html#anchor` → `index.php#anchor`, `product.html?id=X` → `product.php?id=X`). Section 11's "Gating a static SPA" pattern extends this naturally if you also need auth.
- **PHP 8 only on DirectAdmin Evolution (no 7.4 fallback like cPanel).** Default PHP is 8.3 with PDO SQLite, SQLite3, GD, JSON all available. Open basedir is restrictive: `/home/<user>/:/tmp/:/var/tmp/:/opt/alt/php83/...`. The `public_html` is writable by PHP scripts running there (confirmed by `is_writable('.')` = YES in a probe).

### 7b. Porting a Node/Express app to PHP + SQLite on shared hosting

When the user hands you a Node/Express bundle (`server.js` + `node_modules/` + frontend HTML/JS), the shared host has no `node` binary and no port allocation. The conversion is mechanical:

1. **Strip Node-only files** from the staging dir: `node_modules/`, `server.js`, `package.json`, `package-lock.json`, any `*.zip` of deps. Keep all HTML, CSS, JS, image assets, and any `database.json` seed file.
2. **Inventory the Express endpoints.** `grep -nE "app\.(get|post|put|delete)\(" server.js` gives you the full list. Also `grep -nE "fetch\\(['\"\`]\\/api" *.js` to find every frontend call. List the path → method → handler shape (URL params, body fields, response shape).
3. **Write a single-file `api.php` router** that dispatches on `?path=...` to per-endpoint handlers. Use a flat dispatcher (not a router library). For each Express handler, port the body. Templates:
   - `templates/api-router.php` — starter router skeleton with CORS, OPTIONS preflight, error helpers, JSON body parsing, JWT-or-session auth, and a couple of example handlers
   - `templates/api-handler-snippets.php` — copy-paste ports of the most common Express → PDO patterns (login + JWT, list/insert/update/delete CRUD, base64 image upload to a folder, file-based content CMS)
4. **Initialize the schema on first hit.** Detect `!file_exists(DB_FILE)` and run `init_schema($pdo)` from a seed JSON file. Use transactions for the seed insert. **WAL mode + foreign_keys=ON** for SQLite durability. Pattern is in `templates/api-router.php`.
5. **Patch frontend JS to hit `/api.php?path=...` instead of `/api/...`.** One-liner:
   ```bash
   for f in app.js lookbook.js product.js; do
     perl -i -pe "s|fetch\(\s*'/api/([^']+)'|fetch('/api.php?path=\1'|g" "$f"
   done
   python -c "
   import re
   for fn in ['app.js', 'lookbook.js', 'product.js']:
     s = open(fn).read()
     s = re.sub(r'fetch\(\s*\`/api/([a-zA-Z0-9_/]+)', r'fetch(\`/api.php?path=\1', s)
     open(fn, 'w').write(s)"
   ```
   Both single-quoted and template-literal fetches are covered. Test that no `/api/` strings remain in fetch calls (`grep -nE "fetch\\(['\"\`]\\/api\\/" *.js` should be empty).
6. **Cross-link rewrites in HTML.** If the SPA's `index.html` will be renamed to bypass the placeholder conflict (next section), update all internal links: `index.html` → `index.php`, `index.html#anchor` → `index.php#anchor`, `lookbook.html` → `lookbook.php`, `product.html?id=X` → `product.php?id=X`. Run a final `grep -E '\.html(\?|#|$)' *.html` to confirm nothing was missed.
7. **Verify** the API before uploading assets: download a local PHP 8.3 sandbox, hit `api.php?path=health`, then run through auth/login/list/create/update/delete. The SQLite file is created on first hit, so run the smoke tests against a real instance, not a mock.

### 11b. The `index.html` placeholder conflict (when port-21 hosts have a default landing page)

Both cPanel and DirectAdmin ship a default `index.html` in a fresh `public_html/`. The cPanel one is usually the "Default Website Page" (~5KB), the DirectAdmin one is the "Account Suspended / hosted by DirectAdmin" placeholder (~115KB). You can't delete or overwrite either when using the API. Three workaround patterns, in order of preference:

**(a) Upload your SPA's HTML under a different name, route through a tiny PHP wrapper.** This is the cleanest and works on both cPanel and DirectAdmin:
1. Rename `index.html` → `app_home.html` (or any name that doesn't conflict).
2. Create `index.php` containing exactly: `<?php readfile(__DIR__ . '/app_home.html'); ?>`
3. Update cross-links: `href="index.html"` → `href="index.php"`, `href="lookbook.html"` → `href="lookbook.php"`, etc. Add `lookbook.php` and `product.php` as one-liner wrappers the same way.
4. Apache's `DirectoryIndex` is `index.html index.php` by default. With both `index.html` (placeholder) and `index.php` (your wrapper) in the dir, **`index.html` wins** in some Apache configs. If that happens, set `DirectoryIndex index.php index.html` via a different mechanism — on DirectAdmin Evolution, this means uploading a `.htaccess` via a *different* file path that won't break Apache. There is no such path on DA Evo (only `.htaccess` works), so this approach has a known limitation: see the `.htaccess` workaround below.
5. If step 4 fails (placeholder still wins), fall through to approach (b).

**(b) Move everything into a subfolder.** Upload the entire SPA to `public_html/playbie/`. No conflict with the placeholder at root. User accesses the site at `domain.com/playbie/`. The user may want a redirect from `/` — but you can't add a `.htaccess` redirect either, for the same reason. If they need a root-level entry, add `index.php` at root that does `header('Location: /playbie/'); exit;` (one-liner). **This approach has zero conflict risk** and is the safest default for DirectAdmin Evolution.

**(c) Live with the placeholder, point users at the sub-URL.** Skip both (a) and (b), just tell the user to visit `domain.com/playbie/`. Honest, no fighting the host.

**The `.htaccess` workaround for DA Evolution** (advanced, last-resort): upload a working PHP script at root that **replaces** `.htaccess` via `file_put_contents` and `unlink` (PHP runs as the same user). Steps: (1) upload the rest of the app first, (2) upload a one-time `fix_htaccess.php` that does `@unlink('.htaccess')` then `file_put_contents('.htaccess', 'DirectoryIndex index.php index.html')`, (3) visit `/fix_htaccess.php` in browser, (4) the file on disk is now valid (no multipart preamble this time, because PHP wrote it via `file_put_contents`). This works because the `public_html` is writable by PHP scripts running there (`is_writable('.')` = YES, confirmed).

## User preferences (this user, captured from observed behavior)

- **Non-technical.** Prefers minimum-friction solutions that "just work." Does not want to perform manual config steps (file edits, copy-paste) when avoidable.
- **Indonesian casual-professional** tone, mixing English tech terms freely. Do not over-explain.
- **Trusts the agent** to make technical decisions and pick reasonable defaults without over-asking.
- **Prefers self-hosted endpoints over third-party APIs** (avoids CORS surprises, dependency risk, and "why is the site calling some other domain" confusion).
- **Login-gated admin/menu pages, password per menu** is the default for sensitive sections. Public pages (attendance, forms) stay open.
- **Deploy to a subfolder by default** (e.g. `domain.com/erp/`), never clobber the domain root.
- **Security > UX continuity.** When choosing between "preserve SPA state on back-nav" (localStorage handshake, fragile) and "log out on back-nav" (login gate, robust), strongly prefers the gate. The user explicitly chose this after seeing both options.
- **Default passwords are acceptable for personal/team sites** — no demand for hashing, password reset flows, or MFA unless asked. Plaintext in `passwords` SQLite table is fine.
- **Zero-side-effect deploys + mandatory backup.** Stated verbatim: "jangan ada yang dirubah sistem yang ada baik yg udh berjalan, kalau mau ada backup dulu sebelum dirubah2 biar bisa di restore." Translated: do not touch the running system, and **always snapshot to a restorable archive before any change** — even small add-a-card jobs. The user wants to know the rollback path exists *before* bytes move. Order: backup → show plan → ask if needed → execute. See `cpanel-shared-hosting-deploy`'s "Mandatory pre-deploy backup pattern" section for the code.

## Reference

- `references/ftps-connection.md` — working FTPS connection snippet, the TLS hostname-mismatch trick, the Windows-native vs WSL context separation, and how to read cPanel `error_log`.
- `references/php-auth-gate.md` — full router + partials + login.php pattern, the two CSRF-scope pitfalls and how to avoid them.
- `references/directadmin-evolution-api.md` — JSON REST API for DirectAdmin Evolution (jktweb.my.id, dewaweb, Contabo-based resellers). Login, file manager endpoints, the **CRITICAL upload pitfall** (multipart envelope stored as file content — fatal for `.htaccess`), the no-overwrite / no-delete constraint, and how to detect Evolution vs cPanel from outside.
- `scripts/live_verify.py` — drop-in HTTP probe: smoke tests all entry points, exercises the login flow, asserts auth isolation and logout.
- `scripts/probe-php-version.py` — upload a one-line `_phpver.php`, hit it, delete it. Run BEFORE pushing PHP to a host whose version you don't know.
- `scripts/da_evo_upload.py` — batch uploader for DirectAdmin Evolution. Walks a local folder, logs in via `/api/login`, POSTs every file to `/api/filemanager/upload`, prints a status table. Handles 409 conflicts and **refuses to upload `.htaccess`**. Use this when port 21 is closed.
- `templates/auth-gated-router.php` — copy-paste `index.php` starting point with per-menu password protection (customize `$MENUS` and `$DEFAULT_PASSWORDS`).
- `templates/login-partial.php` — copy-paste `login.php` partial. **Uses `$GLOBALS`, not locals** — see the reference for why.
- `templates/login-page.php` — copy-paste **standalone** login page (not a partial). Used to gate a static SPA — see Section 11.
- `templates/spa-login-gate.php` — copy-paste PHP prefix to wrap an `index.html` SPA behind a session check. Prepend to the SPA's `<!DOCTYPE html>`, then rename the file to `index.php`.
- `templates/spa-index-wrapper.php` — copy-paste `index.php` that just `readfile()`s a renamed HTML file. Used when the host ships a default `index.html` you can't delete (DirectAdmin Evolution). See Section 11b approach (a).
- `templates/stub-api.php` — minimal PHP API endpoint that returns a dashboard-shaped JSON payload, with CORS headers and a request log.
- `templates/api-router.php` — single-file PHP router skeleton for porting a Node/Express backend to shared hosting. Includes CORS, JWT, SQLite init + seed, base64 upload, and the most common CRUD patterns. See Section 7b.
