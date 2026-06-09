---
name: php-helper-for-limited-hosting-panels
description: When a shared hosting panel's file manager API is incomplete (no delete, no overwrite, no mkdir), or uploaded files get wrapped in a multipart envelope that breaks PHP parsing, work around it by uploading a one-shot self-destructing PHP helper to a unique filename and asking the user to open the URL in their browser. Also covers the flat-rename pattern for uploading many files without subdir support, and using user manual delete via File Manager UI as the canonical overwrite path when PHP-FPM is jammed. Triggered by 409 ALREADY_EXISTS, "no such endpoint", or parse errors caused by trailing `------Hxxx--` junk.
---

# PHP one-shot helper for limited shared-hosting panels

## When to use

- DirectAdmin Evolution / cPanel / custom panel: file manager API has **no delete endpoint** and 409s on overwrite
- You need to **delete a file** (e.g. a broken `.htaccess`), **overwrite a file** (e.g. with stripped content), or **create a directory** that the API can't
- Uploaded files come back with **multipart envelope prepended/appended** (you'll see `------Hxxx\nContent-Disposition:...` at the start of `file_get_contents` output) and PHP files without trailing `?>` get parse errors on the trailing `--`
- User has web access to the same host (so they can open a URL in a browser)

## The pattern

1. **Write a one-shot PHP helper locally** that:
   - Does the actual fix (read file, transform, write back, mkdir, etc.)
   - Prints a clear status line (e.g. `ok=1 size=4800`)
   - **Optionally self-destructs** at the end (`@unlink(__FILE__);`)
   - **Always ends with `?>\n`** to be robust against trailing multipart boundary junk

2. **Upload it to a unique filename** via whatever upload API exists — use a UUID/timestamp suffix to avoid 409 conflicts:
   ```
   fix_abc123.php   (not fix.php)
   ```

3. **Tell the user to open the URL in their browser**:
   > "Buka `https://example.com/fix_abc123.php` di browser lu, copy output-nya kesini"

4. **Verify the result** via the same API (re-list files, re-fetch the modified file's contents, etc.)

5. **Don't bother removing the helper** — small orphan `.php` files are harmless. Or have it self-destruct if you remember.

## Helper template (safe against multipart envelope)

```php
<?php
// 1. read source
$src = file_get_contents(__DIR__ . '/api.php');
// 2. strip multipart preamble (find first <?php)
$pos = strpos($src, '<?php');
$clean = $pos !== false ? substr($src, $pos) : $src;
// 3. ensure trailing ?> to avoid parse errors from trailing -- junk
if (substr($clean, -2) !== '?>') {
    if (substr($clean, -1) !== "\n") $clean .= "\n";
    $clean .= "?" . ">\n";
}
// 4. write back
$ok = file_put_contents(__DIR__ . '/api.php', $clean);
echo "ok=" . (int)($ok !== false) . " size=" . filesize(__DIR__ . '/api.php');
// 5. optional self-destruct
@unlink(__FILE__);
?>
```

Note: **never write `?>` directly in the helper source** — use string concat (`"?" . ">"`) or `chr(62)` to avoid prematurely closing the PHP block during helper execution. Same rule applies to `<?php` (the open tag) in the Python bytes literal that becomes the helper body: if you write `b"""<?php ... ?>"""` directly in Python source, the `<?php` may be stripped by the upload pipeline (the panel's multipart parser or the framing layer is doing something to it — `<?php` in source got dropped in Session 8 for no obvious reason). Build with `b'<' + b'?' + b'php'` to be safe. Same effect, no strip.

## "Megafix" pattern — fix N files in one helper round-trip

When you need to fix MORE than one file (e.g. 5 files all wrapped in multipart envelope, or 10 files need a small content tweak), don't upload 10 separate helpers. Bundle all clean content as base64 into ONE helper, upload once, ask user to open it once. See `references/case-playbie-php-migration.md` (Session 2) for the full pattern + Python builder.

## Subdirectory creation

```php
<?php
@mkdir(__DIR__ . '/assets', 0755, true);
// then move/copy files in
$ok = @rename(__DIR__ . '/upload_foo.png', __DIR__ . '/assets/foo.png');
if (!$ok) { $ok = @copy(...); @unlink(...); }
echo "moved=" . (int)$ok;
@unlink(__FILE__);
?>
```

Upload files to root with `upload_` prefix, then helper moves them to the new subdir.

## Pitfalls

- **Trailing `?>` in helper source** is a footgun: the helper's own `?>` would close PHP mode before the rest of the helper runs. Use `"?" . ">"` or `chr(62)` to write literal `?>` to disk.
- **Helper without trailing `?>` in file content** will parse fine when the multipart envelope wraps it, but the trailing `------Hxxx--` after the helper's last line gets interpreted as PHP. End helpers with `?>\n` (in the source, via string concat) so any post-helper junk is harmless text.
- **Don't put `?>` in strings in the helper** without escaping. Use `chr(62)` for `>` if your helper needs to detect/write literal `?>`.
- **Upload API rate limits** (we saw 10053/10054 aborts on 3 consecutive PNG uploads). Add `time.sleep(2)` between uploads, re-login on each retry, reduce parallel workers.
- **After upload**, the file on disk is the multipart envelope, NOT your inner content. PHP files still execute their `<?php ?>` blocks (preamble is echoed as raw text), but JSON/CSV/text files will be broken for `json_decode`/text parsers.
- **User can undo your work at any time** — when a user has DA panel / cPanel / FTP access, they can manually re-upload, unzip, or delete files outside your automation. After they touch the host, RE-VERIFY (re-list files, hit a few key endpoints) before assuming your deploy is still live. Best practice: timestamp a backup zip before any user interaction, and tell them to download that backup before re-uploading.
- **409 ALREADY_EXISTS** on upload = file already exists. Use unique filenames OR upload a helper PHP that does `file_put_contents` to overwrite. **If PHP-FPM is also jammed** (see session-6 reference), neither pattern works — fall back to **user manual delete via File Manager UI** as the canonical overwrite path. The DA `rm` API endpoint either 405s or closes the connection with no effect; the `cmd` API's `rm` command also doesn't work. Time cost of the user-manual approach: ~30 seconds, vs 30+ minutes trying to make DA API delete work (it never does). User prompt: "Login ke `https://<domain>:2222`, buka File Manager → `domains/<domain>/public_html/`, cari file `<name>` (X bytes), klik kanan → Delete. Konfirmasi, terus reply **sudah**."

- **JS files break silently when envelope is appended, not prepended.** Session 9's pattern ("JS is fine, browser ignores preamble") was wrong for the swap-then-swap case: the upload API appends a `----------Hxxx--` boundary to the end of every uploaded file, and `app.js` ending with `----------Hxxx--` is a hard JS parse error → whole script fails → `initCatalogAndBackend` never runs → catalog stays at hardcoded STATIC_PRODUCTS. **Detection**: `if '----------H' in content[-300:]: print('envelope in tail')`. **Fix**: regex-based tail cleaner (see `references/session-10-appended-envelope-swap-pitfall.md`). Verify the live file's last 300 bytes for `----------H` after every upload+swap. **This is the silent-failure pitfall to watch for** — no console error, no 500, just "site loads but acts weird."

- **`strrpos($c, "*/")` is wrong as a JS end-anchor.** It only works if the JS file has MULTIPLE block comments — for the common case of a single `/* ===== file header ===== */` at the top, `strrpos` returns the header comment's `*/` (since it's the LAST and ONLY one), and the cleaner writes a 370-byte stub of just the header, silently nuking the rest of the code. **Use `strrpos($c, "}")` as the end-anchor for JS, JSON, CSS, and HTML** — the closing brace is always present in valid code and the regex won't get confused by header comments. Add a sanity check before writing back: `if (strlen($clean) < $orig * 0.5) { echo "STRIPPED TOO MUCH, REFUSING\n"; continue; }` — that's the canary that says "you sliced wrong, do not save". See `references/session-12-js-first-block-comment-pitfall-and-reseed-order.md` for the full bug report and the all-in-one delete+swap+clean helper.

- **Partial envelope header leaking into file: `/octet-stream\r\n` at the start of CSS/JS/HTML files.** Session 14 hit a subtler variant: the multipart boundary's `Content-Type: application/octet-stream` header value leaked into the start of a CSS file as literal text (`/octet-stream\r\n\r\n/* ============`), so the CSS file was technically there and the right size but the browser silently dropped the whole stylesheet because the rule syntax was invalid. **Same root cause as the full envelope pitfall** (DA Evolution FM API stores the raw upload stream, not just the file body), but only the `Content-Type` value leaked (no `Content-Disposition` line). The existing `Content-Disposition` grep misses this case. **Detection**: fetch first 50 bytes, look for `/octet-stream` OR `Content-Disposition` OR any `------H`. **Fix**: add `/octet-stream` to the regex `'/^(Content-Disposition|Content-Type|------H|multipart|\/octet-stream)/'` for the leading-line strip pass — the existing 9-pattern envelope stripper misses this because the leading line is `/octet-stream\r\n` (the value of the Content-Type header, not the header itself). After clean, the file is normal CSS. **Lesson**: any junk text before the first valid content marker is suspect, even if it doesn't look like a multipart boundary.

- **CSS variables defined at `body.theme-pastel` instead of `:root` are fragile.** The "current color" is visible in `getComputedStyle(element).getPropertyValue('--color-primary')` on a child element (cascade resolves correctly), but `getComputedStyle(document.documentElement).getPropertyValue('--color-primary')` returns empty (because `:root` has no rule defining the variable). This bites when debugging CSS via DevTools or programmatic checks — the variable "looks missing" from the root inspection, and you waste time hunting for why. **Fix when uploading CSS that defines theme variables**: always inject a `:root { --color-primary: <default>; ... }` block alongside `body.theme-X` blocks, so the variables are available at root scope as fallback. This also future-proofs against the body class not being applied yet (FOUC — flash of unstyled content) or the class being stripped by some downstream script.

- **Logo structure pattern: `<a class="logo"><span class="logo-accent">play</span>bie</a>`.** When the user wants the logo color changed, a generic `.logo { color: pink !important; }` override won't color the "play" word differently from "bie" — the accent is on the child span. To get the two-tone effect, target `.logo-accent` specifically: `body.theme-X .logo-accent { color: var(--color-primary); }`. **Diagnostic**: when a generic class override doesn't apply, `document.querySelectorAll('header a')` and inspect the actual className of each link — the class names that "should" exist often don't. Print all class names and the actual text content.

- **Injecting inline JS for sliders / interactive features that aren't in app.js.** When the user asks for a feature (auto-rotate carousel, scroll-to-top button, smooth-scroll for hash links) and the bundled `app.js` doesn't implement it, the fast path is **injecting an inline `<script>` block before `</body>`** rather than patching `app.js` (which would require a full re-upload of the bigger file). The pattern: read live `index.html`, append the script as a string, upload as `<name>.<batch>.html`, run swap helper. Verify with a browser console check: `setTimeout(() => { /* check state */ }, 7000)` to wait for the auto-rotate interval to fire. The injected script's variable scope is global on the page, so it coexists with `app.js` variables without conflict (as long as names don't collide).

- **JS `switchHeroSlide(0)` / `switchHeroSlide(1)` referenced in onclick handlers may not exist in app.js.** Grep `app.js` for `function switchHeroSlide` BEFORE adding inline auto-rotate — if the function doesn't exist, your injected script needs to define it. Session 14 was lucky: the function did exist in app.js, so the inline script's `clearInterval(timer); setInterval(next, 6000)` worked. If the function doesn't exist, add it to the injected script.

- **`getComputedStyle(element).backgroundColor = rgba(0,0,0,0)` doesn't mean no background — check `.background` and `.backgroundImage` separately.** When a CSS rule uses `background:` shorthand with a `linear-gradient(...)`, `getComputedStyle().backgroundColor` returns the transparent base, but `.backgroundImage` and `.background` (shorthand) return the gradient. This fooled Session 14's diagnostic check into thinking the announcement bar had no background when it actually had a working pink gradient. **Always check both `.backgroundColor` and `.backgroundImage` / `.background` shorthand** when diagnosing "no background" symptoms on a styled element.

- **Always create 3-location backup BEFORE modifying important files.** The user's explicit request was "sblm dirubah tolong buatkan backup yah biar ga ilang dan bisa di restore kalau ada eror" — this is a stable preference, not a one-off. For any non-trivial file edit (CSS variable change, JS logic rewrite, API endpoint patch, color initialization change), back up to 3 places BEFORE touching the file: (1) server-side `<name>.bak` (uploaded via DA Evolution FM API, lives on the server as a recovery point), (2) local `C:\tmp\<name>_backup\<name>_LIVE_<YYYYMMDD>.bak` (curl snapshot of the live file with timestamp), (3) local `C:\tmp\<name>_backup\<name>_FROM_ZIP.bak` (extracted from the original zip the user provided — pre-patches). Each location has different failure modes: server-side dies if hosting is wiped, local LIVE dies if the working directory is purged between sessions, local SOURCE reflects the original ground truth before any agent patches. See `references/session-15-...md` for the full recipe and Python snippets. Restore from any of the 3 if the change goes wrong.

- **Multi-occurrence config blocks: `this.colors = { ... }`, `const CONFIG = { ... }`, `module.exports = { ... }` can appear multiple times in a single file.** When the codebase has theme systems (e.g. `setTheme('pastel')` + `setTheme('nordic')` + initial constructor) or feature flags, the same config block is defined in 2-3 places with different values. A naive `code.find(marker) + replace` only hits the FIRST occurrence. **Before patching, run `code.count(marker)` to detect multi-occurrence.** If > 1, write a loop function that finds and replaces all occurrences (track brace depth to find the matching `}`). The Playbie `viewer3d.js` had 3 separate `this.colors = { ... }` blocks; replacing just the first left the other 2 untouched and the patch appeared to "succeed" but only 1/3 of the colors actually changed. **Verification**: after replacement, `re.findall(r"'#[0-9A-Fa-f]{6}'", new_code)` and confirm only the new color remains. Full function template in `references/session-15-...md`.

- **Three.js `MeshStandardMaterial` array for BoxGeometry uses 6-material face order `+X, -X, +Y, -Y, +Z, -Z`.** When `new THREE.Mesh(boxGeo, [matA, matB, matC, matD, matE, matF])` is passed an array, each face gets its own material in this fixed order. For a Playbie-style "inner/outer" wall (different colors on the side facing the bed vs the side facing out), the index assignment depends on which side the wall is on (left/right walls have +X as inner; front/back walls have -Z or +Z as inner). When changing all faces to a single color, you can technically simplify to a single material (not array) but **don't restructure** if a customizer depends on per-face coloring — just set all the color values in the existing array to the new color. This preserves the customizer's per-face logic.

- **"Neutral default + working customizer" is the right pattern for "dummy" requests.** When user wants a "dummy" / "neutral" / "plain" initial state for a customizer (3D viewer, 2D form preview, color picker) — the right fix is to change the **initialization values** (e.g. `this.colors = { ... }` defaults), not the customizer logic. Don't strip out the color picker, don't simplify the material array, don't change the function signature. Initialize all defaults to the neutral color, leave the rest of the pipeline alone. The customizer still works — user can still pick colors, the picker still sends them to the update function, the mesh still rebuilds with the new color. Verification: read `window.<viewerInstance>.<state>` in browser console after the change (e.g. `window.playbie3D.colors`), confirm all defaults are neutral, then click a swatch and re-read to confirm customizer still wires through.

- **For IIFE+class pattern viewers, the runtime instance is exposed at `window.<name>`.** The Playbie 3D viewer is `window.playbie3D`. Vanilla JS with `var app = new MyApp()` at the bottom of the IIFE: `window.app`. jQuery plugin: `$.data($el, 'plugin_name')`. React: DevTools → Components tab. Vue: DevTools → Vue tab → `$data`. This is the canonical way to inspect runtime state (current colors, active product, scene children) without reloading the page or re-running the entire pipeline. Faster than curl/grep against the source file because it reflects the post-init state.

- **Re-seed order matters: clean seed file FIRST, then delete DB, then trigger init.** If you delete `playbie.db` while the seed file (e.g. `database.json`) still has its multipart envelope, `init_schema` runs, calls `json_decode` on the envelope, gets `null`, skips the seed loop, and commits empty tables. The next call still shows 0 products. Always: (1) strip envelope from seed file, verify with head/tail, (2) delete the SQLite file, (3) hit `?path=health` to trigger init, (4) verify with `?path=products`. See session-8 reference for the recipe and session-12 reference for the order gotcha.

- **Python f-string `\$` warning when embedding a PHP regex.** If the helper content uses an f-string with a regex containing `\$` (e.g. `/^abc\$/`), Python 3.12 emits a `SyntaxWarning` and 3.14+ raises a `SyntaxError`. Three fixes, in order of preference: (1) use PHP's `\z` instead of `$` in the regex (absolute end-of-string, no backslash needed), (2) write the helper body to a `.php` file via `write_file` first, then read it in Python and upload (no f-string at all), (3) use `chr(36)` for the `$` character: `'/^abc' + chr(36) + '/'`. See `references/session-12-...md` for the exact reproduction.

- **Status `204`** = success, no body. Status `409` = conflict, body explains. Status `200` = ok, body has data.
- **DA Evolution FM API endpoints discovered** (from `/evo/index.*.js`):
  - `POST /api/filemanager/upload?path=<full_target_path>` — only mutation available
  - `GET /api/filemanager/list?path=<dir>` — list
  - `GET /api/filemanager/download?path=<file>` — download
  - `GET /api/filemanager/tree?path=/` — recursive
  - `GET /api/filemanager/metadata?path=<file>` — single file meta
  - `GET /api/filemanager/disk-usage` — quota
  - No `mkdir`, no `delete`, no `rename`, no `move`, no `extract`
- **Plural `file-manager` is a SPA route, not a JSON API endpoint.** If you see `GET /api/file-manager/...` or `/CMD_SHOW_FILE` returning HTTP 200 with `<html class="vue-app">` in the body, the URL is a frontend route, not a backend API. The real Evolution API uses **singular noun** path segments: `filemanager`, `login`, `execute`, `terminal`. The plural `file-manager` is what the JS bundle happens to use for SPA routing. To find the real API, either grep the JS bundle (`curl -s https://<host>:2222/evo/ | grep -oE '/api/[a-z-]+'`) or just try the singular form (`filemanager` not `file-manager`) — Evolution's API is fairly RESTful. Don't waste time debugging auth/headers on the plural form; the response is always the SPA shell.

- **`declare(strict_types=1) must be the very first statement` error = multipart envelope in the PHP file.** When the wrapped PHP has `declare(strict_types=1);` near the top, the envelope preamble before `<?php` counts as "output already sent" — PHP 7.0+ requires `declare(strict_types=1);` to be the very first statement after `<?php`, with nothing before it. The error message itself names the symptom ("strict_types declaration must be the very first statement") and the line of `declare(...)`. **Diagnosis: fetch the file's first 200 bytes, look for `Content-Disposition: form-data` in them.** This is the **uniquely identifiable** multipart-envelope symptom — if you see that error and grep finds envelope markers, you don't need to debug the code, you just need the clean-and-overwrite helper. Other envelope symptoms (HTML, JSON, CSS files) don't have such a clean error to grep for; this one is the gift that tells you the problem directly. Full recipe in the existing "Multipart-envelope stripping" section below.

- **Re-seed a SQLite DB by deleting the .db file then calling the API.** When the API reads from a JSON file on first request and seeds SQLite from it (the common "config-as-source-of-truth" pattern), the SQLite file is sticky — once it's created with empty tables (because the JSON was broken at that moment), subsequent calls won't re-seed. **Recipe** (order matters — see session-12 reference):
  1. Strip the envelope from the seed file (e.g. `database.json`) using the helper pattern
  2. Delete the SQLite file via a one-shot PHP: `<?php @unlink(__DIR__.'/playbie.db'); echo file_exists(__DIR__.'/playbie.db') ? 'STILL_THERE' : 'GONE'; ?>`
  3. Call any API endpoint that triggers init (`?path=health` is the typical one) — the API sees the missing DB, runs `CREATE TABLE IF NOT EXISTS ...`, then reads the (now clean) seed JSON and inserts rows
  4. Verify with `?path=products` — should show the seeded count
  Time: ~30s once you have the helper. Don't try to `UPDATE` rows in place; the cleaner wipe-and-reseed is faster and safer.

### The "upload-as-new-then-PHP-rename" pattern for overwriting text files

When the upload API 409s on an existing file (the canonical no-overwrite pitfall) and you need to overwrite a **text file** that's not PHP — JS, CSS, HTML, or any frontend asset — the same "upload then run a swap helper" pattern that works for PHP/JSON works for these too. **Recipe**:

1. **Read the live file from the server** (curl/script). Make any edits you need (URL rewrites, path patches, etc.) and save locally as `<name>_v2.js` (or similar).
2. **Upload the new version** as a fresh filename (e.g. `app_new2.js`). Since the name is different, the upload API returns 204 instead of 409. The file on disk is the multipart envelope — but for JS files loaded by `<script src>`, the browser ignores the preamble text and only parses lines starting with `//` / `function` / `const` etc.
3. **Upload a tiny PHP swapper** that does `rename($app, $bak); rename($new, $app);` and call it via URL. One-shot, no user action needed.
4. **Verify** the live file: `curl https://site/<name>.js | grep <expected_change>`.

**The swapper template**:
```php
<?php
$base = "/home/<user>/domains/<domain>/public_html/";
foreach (["app.js", "lookbook.js", "product.js"] as $name) {
  $app = $base . $name;
  $new = $base . str_replace(".js", "_v2.js", $name);
  $bak = $base . $name . ".bak";
  // SAFETY: refuse to swap if the new file doesn't exist, otherwise we
  // nuke the original and have to restore from .bak. Always upload _v2.js
  // (or whatever new name) BEFORE running this helper.
  if (file_exists($app) && !file_exists($new)) {
    echo "$name: REFUSING SWAP — $new doesn't exist, keeping $app\n";
    continue;
  }
  if (file_exists($bak)) unlink($bak);
  if (file_exists($app)) rename($app, $bak);
  if (file_exists($new)) rename($new, $app);
  echo $name . ": " . (file_exists($app) ? filesize($app) : 0) . "\n";
}
?>
```

**When to use this vs user-manual-delete-then-upload**:
- **Use upload+swap when** the change is small (URL rewrite, a string replacement) AND you have a clean local copy of the file. The swap is atomic from the browser's view: there's a brief moment where the live file is the new version, no half-state.
- **Use manual delete when** the change is the entire file structure, when the file is large (>200KB), or when you've lost the original (you have nothing to base the new version on, so you'd be patching blindly).

**Special case: the new file is also multipart-envelope-wrapped** (because you just uploaded it via the same API). For HTML the browser usually auto-recovers from the preamble. For CSS, same. **For JS files**, the original Session 9 reasoning ("browser ignores preamble") was WRONG: a stray boundary line is a hard parse error, the whole script fails silently, and the user sees a half-broken page. **Every file type uploaded via DA Evolution FM API needs envelope stripping after upload**, not just PHP/JSON. See `references/session-10-appended-envelope-swap-pitfall.md` for the universal regex-based cleaner and the "what to grep for after every upload" checklist. **For PHP** you'd also need the envelope-strip helper first; this pattern is specifically for non-PHP text.

**The "patch the URL" use case** (the specific case that prompted this technique): when the user re-uploaded the original SPA frontend and the JS calls `/api/products` (the old Node.js path), but the PHP backend only responds to `/api.php?path=products`, the fix is to read the live JS, do a `re.sub` to rewrite all `/api/X` → `/api.php?path=X` patterns, upload the patched version, swap. **Without this pattern, the site loads but the SPA never sees backend data** — frontend falls back to hardcoded `STATIC_PRODUCTS` array. This is one of the most common "site loads but acts weird" symptoms and it's invisible without reading the JS.

**Edge case: template-literal URLs with `${...}`** — the regex `s#/api/([a-z]+)#/api.php?path=$1#` misses template strings like `\`/api/products/${id}\``. Use a specific list of common patterns. **Session 13 expansion** of this list — use the full 9-pattern set for any Node-to-PHP SPA migration:
```python
patches = [
    # /api/auth (login + verify)
    ("'/api/auth/login'",     "'/api.php?path=auth/login'"),
    ("'/api/auth/verify'",    "'/api.php?path=auth/verify'"),
    ('`/api/auth/login`',     '`/api.php?path=auth/login`'),
    ('`/api/auth/verify`',    '`/api.php?path=auth/verify`'),
    # /api/content, /api/upload, /api/orders, /api/products (with all quote variants)
    ("'/api/content'",        "'/api.php?path=content'"),
    ("'/api/upload'",         "'/api.php?path=upload'"),
    ("'/api/orders'",         "'/api.php?path=orders'"),
    ("'/api/products'",       "'/api.php?path=products'"),
    ('`/api/content`',        '`/api.php?path=content`'),
    ('`/api/upload`',         '`/api.php?path=upload`'),
    ('`/api/orders`',         '`/api.php?path=orders`'),
    ('`/api/products`',       '`/api.php?path=products`'),
    # Template literals with ${id} params
    ('`/api/orders/${orderId}/status`', '`/api.php?path=orders/${orderId}/status`'),
    ('`/api/orders/${orderId}`',         '`/api.php?path=orders/${orderId}`'),
    ('`/api/orders/${id}/status`',      '`/api.php?path=orders/${id}/status`'),
    ('`/api/orders/${id}`',              '`/api.php?path=orders/${id}`'),
    ('`/api/products/${productId}`',     '`/api.php?path=products/${productId}`'),
    ('`/api/products/${prodId}`',        '`/api.php?path=products/${prodId}`'),
    ('`/api/products/${id}`',            '`/api.php?path=products/${id}`'),
    # Node-only endpoints (Session 13's discovery)
    # /api/proxy-image is the customizer motif endpoint; if you don't have a real
    # PHP stub, patch it to /api.php?path=proxy-image and add the stub in api.php
    # (see session-13 reference). Alternatively, just delete the swatch line.
    ('`/api/proxy-image`',               '`/api.php?path=proxy-image`'),
]
# Quote variants (double-quote) get the same treatment:
#   '"/api/products"' → '"/api.php?path=products"', etc.
# Add them for SPAs that use double-quoted strings.

# Don't forget: any `/api/X` pattern you grep'd but didn't add to this list.
# After applying, verify with:
#   curl -s https://site/app.js | grep -oE "/api/[a-zA-Z_/?=&]+" | sort -u
# Should be empty (or only the intentional ones).
```
Apply all, save, upload as `<name>_v2.js`, swap. Verify by grepping the live file for `/api/products` count (should be 0) and `/api.php?path=` count (should be N).

**All-in-one helper for non-PHP overwrite (delete + swap + clean in one round-trip)** — see `references/session-12-js-first-block-comment-pitfall-and-reseed-order.md` section 4. Combines the delete, swap, and multipass cleaner into one helper so non-PHP files don't accumulate envelope across multiple swap rounds.

### 3-file parallel probe — "is it me or the server?" quick check

When bulk uploads (or any PHP request) start failing, **before** debugging your script, probe the server with 3 parallel requests:

```python
import urllib.request, ssl, time
ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
for url, label in [
    ('https://site/',            'static HTML'),         # root doc
    ('https://site/index.php',   'main PHP file'),       # any PHP on the site
    ('https://site/<your_helper>', 'your custom helper'),  # the endpoint you're using
]:
    t = time.time()
    try:
        r = urllib.request.urlopen(url, timeout=5, context=ctx)
        print(f'{label:30s} {r.status}  {time.time()-t:.1f}s  body={len(r.read())}b')
    except Exception as e:
        print(f'{label:30s} TIMEOUT/ERR {time.time()-t:.1f}s  {e}')
```

**Pattern → diagnosis**:
- All 3 respond fast (200, body bytes) → your script is the problem
- Static `/` 200 fast + both PHP files hang → **PHP-FPM broken server-side**, full stop. Don't keep retrying uploads with different formats, content types, or auth — they all need PHP working. Stop the loop and report to user.
- All 3 hang → network/firewall/DNS issue, escalate to port scan
- Static 200, index.php 200, custom helper 404/500 → your helper upload was the problem (file not on disk, parse error, etc.)

**More severe than the "kill left a worker stuck" pitfall above**: that one is a temporary 30s jam that self-clears. The "all PHP hangs" pattern here is PHP-FPM crashed, OOM-killed, or hung at the pool level — the user (or hosting support) needs to restart it. You'll see this if the static `/` (served by Apache directly) responds but every `*.php` request times out.

After confirming server-side PHP is down: tell the user clearly "PHP is broken at the server, restart PHP-FPM via your panel (or contact support)." Do NOT burn more time reformatting uploads. Optionally offer to patch your script in parallel so re-run is fast once PHP is back.

## Worked example (this session)

Problem: uploaded `api.php` via Evolution FM API, file on disk became multipart envelope, `api.php` returned HTTP 500 because PHP parsed the trailing `------Hxxx--` boundary as decrement operator.

Fix:
1. Wrote a fix4-style helper that base64-decodes a clean `api.php` and `file_put_contents` overwrites
2. Uploaded as `fix5_*.php` (unique name)
3. Asked user to open `https://asientoplaybie.com/fix5_*.php` in browser
4. Helper ran, output `ok=1 size=21691 sha=...`
5. `api.php?path=health` then returned 200 OK

Result: 5-min fix vs 30+ min exploring WebSocket terminal or giving up.

## Flat-rename pattern: bypass subdir creation, bulk upload without PHP

**When the panel's upload API can't create subdirectories** (DA Evolution returns 404 NOT_FOUND for paths with non-existent intermediate dirs) and you need to put N files in what would naturally be a multi-level folder structure, **flatten the path with a separator into the filename** and put it directly in the target leaf directory.

```python
# BAD — subdir doesn't exist
path = 'assets/150x150PASTEL/PNG/castel_xxx.png'  # returns 404
# GOOD — flatten with __ separator
path = 'assets/150x150PASTEL__PNG__castel_xxx.png'  # single filename in existing assets/ dir
```

Then update the consumer (product JSON, HTML, JS) to reference the flat filename. The browser doesn't care whether the file lives at `assets/sub/file.png` or `assets/sub__file.png`.

**Why this works**:
- DA Evolution's upload endpoint stores at the panel level, bypassing PHP entirely
- No per-file size limit (vs ~800KB base64 threshold for the PHP-helper pattern)
- No subdir creation needed
- Apache serves the static file just as well from any name

**Result in Session 7**: 66 images (some 1.2MB PNGs) uploaded in 11 seconds via pure DA Evolution API. No PHP helper needed. No base64 overhead.

Use this when:
- PHP-FPM is jammed (Session 6/7 case)
- You have many files of varying size to upload
- Subdirs don't exist and you can't create them via API
- You can update the consumer code to point to flat paths

Don't use this when:
- Subdirs already exist (just upload to the real path)
- You need to **overwrite** an existing file (still need user manual delete first — see 409 pitfall above)

Full recipe and session detail in `references/session-7-da-api-bypass-techniques.md`.

## When NOT to use

- User has SSH access — use SSH instead
- The panel has a proper delete/overwrite API — just use it
- The operation is one-line and you can include it in an existing PHP file that's about to run anyway
- File is small enough to fit in a code-side request (e.g. via the file editor API) — use that

## Connection diagnostics (when FTP/SFTP/cPanel port-refused)

When a hosting account's FTP port is **actively refused** (not just timeout), it's almost always that the panel only exposes its own **web-based filemanager UI/API** (DA Evolution, custom panels) — not raw FTP. Don't burn hours on FTP — pivot to the panel's REST API immediately.

**Quick check sequence** (5 mins, determines strategy):
1. `host ftp.<domain>` → resolves (DNS works)
2. `curl -v --connect-timeout 5 ftp://...:21` → `Connection refused` (active, not timeout) = **panel has no FTP service**
3. `curl -v --connect-timeout 5 https://<domain>:2083` / `:2222` / `:8443` → **panel login URL**
4. From the panel HTML/JS bundle, grep for `/api/` endpoints to discover the FM API
5. Check `/api/execute` → 403 ACCESS_DENIED = user is unprivileged (typical for shared accounts); try `/api/terminal` (WebSocket) as last resort

**Working panel URL patterns** (seen in this session class):
| Panel | URL pattern | FM API style |
|---|---|---|
| DirectAdmin Evolution | `https://<domain>:2222/evo/` | `POST /api/login`, `GET/POST /api/filemanager/...` |
| cPanel | `https://<domain>:2083/` | cPanel API2/cpsess tokens (different paradigm) |
| Custom (jktweb.my.id/Contabo) | `https://<server-hostname>:2222/evo/` | Often DA Evolution reskinned |

**jktweb.my.id / Contabo Asia specifically** (user's other account):
- Server hostname like `dsa1.jktweb.my.id` exposed in panel
- `ftp.<domain>` resolves to server IP but **port 21 actively refused** (the bare Contabo server doesn't run Pure-FTPd; the panel sits in front)
- **Workaround**: use DA Evolution API at port 2222. PHP 8.3.14 + PDO SQLite available. PHP 8.0+ syntax OK (no 7.4 patch needed like Rumahweb does).

## Diagnosing "uploaded file is the multipart envelope, not my content"

This bites on every DA Evolution upload. The file on disk becomes:
```
------Hxxxxxxx
Content-Disposition: form-data; name="file"; filename="api.php"
Content-Type: text/plain

<your file content>
------Hxxxxxxx--
```

**Why**: the upload API treats your `file` field as one part of a multipart form, then the *whole* part (with its headers) is what gets stored. Not a bug, it's how the panel's "store raw upload stream" works.

**Symptoms by file type**:
- **PHP files**: still execute (PHP ignores `------Hxxx\n` outside `<?php ?>` tags), but if the file has NO closing `?>` then trailing `--` after `exit` becomes a parse error → HTTP 500
- **JSON files**: completely broken (`json_decode` returns null because preamble is not valid JSON)
- **HTML files**: render with garbage text at top (browsers usually auto-recover, but visibly wrong)
- **JS files**: same as JSON, broken
- **CSS files**: garbage at top, but browsers ignore
- **Binary/PNG**: completely corrupted (you'll see file as a binary blob, not a valid image)

**The fix is to overwrite via a helper PHP**, since the upload API blocks 409 on existing files. Pattern:
1. Helper reads file from disk
2. Finds first `<?php` (or first valid content marker) and substr from there
3. For PHP files specifically: ensure trailing `?>\n` so junk after is harmless
4. `file_put_contents` to overwrite
5. Self-destruct

**Diagnosing without downloading the full file**: fetch first ~200 bytes via the panel's download API and grep for `Content-Disposition`. Saves a roundtrip:
```python
r = opener.open(f'{base}/api/filemanager/download?path=/.../api.php', timeout=15)
content = r.read()
print('envelope?', b'Content-Disposition' in content[:300])
```

**Diagnosing PHP parse errors server-side** (when output is empty/500 and you can't easily reproduce locally): upload a tiny diag helper that runs `token_get_all(file_get_contents($file))` and reports how many tokens / line of last error. PHP's tokenizer runs without executing, so you can see syntax issues without the file crashing:
```php
<?php
$src = file_get_contents(__DIR__ . '/api.php');
$tokens = @token_get_all($src);
echo 'tokens=' . count($tokens) . ' bytes=' . strlen($src);
// @ suppresses warnings; check log file for specific parse error
@unlink(__FILE__);
?>
```
This is a 1-shot way to confirm "PHP parser is choking somewhere" without bringing the site back down.

## Multipart-envelope stripping — the safe pattern for any file type

```php
<?php
$path = __DIR__ . '/database.json';
$raw = file_get_contents($path);

// For JSON/CSV/text: find the empty line that separates headers from body
$lines = explode("\n", $raw);
$body_start = 0;
for ($i = 0; $i < count($lines); $i++) {
    if (trim($lines[$i]) === '' && $i > 0) {
        $body_start = $i + 1;
        break;
    }
}
$body_lines = array_slice($lines, $body_start);
// strip trailing boundary
$body = implode("\n", $body_lines);
$body = preg_replace('/------[A-Za-z0-9]+--\s*$/', '', $body);

$ok = file_put_contents($path, trim($body));
echo 'ok=' . (int)($ok !== false) . ' size=' . filesize($path);
@unlink(__FILE__);
?>
```

For PHP files, use the `?>`-append version (see template above) — that handles the trailing `--` case where the file is a valid script but lacks a closing tag.

## Rate-limit behavior on upload (DA Evolution)

- 3 consecutive parallel uploads of files >500KB → `WinError 10053/10054` (connection abort)
- 2-second sleep between uploads + serial (not parallel) for files >500KB
- Re-login (new cookie jar) per retry; old session may have been killed
- 1MB+ files: split into chunks, or use the multipart-with-base64-encoding trick (write a 1MB PHP helper that does `move_uploaded_file` after a single multipart POST of a smaller file) — only worth it for the initial big uploads
- For Playbie-sized assets (3×750KB PNGs), serial upload + 2s sleep works reliably

## Code review / architecture study (sister workflow)

User often says things like "lihat semua coding-nya", "buat lu pelajari", "ambil style dari link ini" — this is a **class of task** that runs alongside the deploy work, not instead of it. The workflow, pitfalls, and memory-save pattern are documented in `references/code-review-architecture-study.md`. Key points: read everything (chunked, no skimming), output structured architecture summary (endpoints / data model / DOM IDs / theming), save design pattern to memory as "Web Design Pattern — <type>" so future sessions can apply it. **DON'T auto-rebuild** — user said "pelajari" = study, not "fix".

## Bulk image ingest from Google Drive → products (new class)

User said: "coba ini saya ada data di google drive poto sampai variannya kamu atur produknya biar seperti di shopee ada varian foto produk berdasarkan series" — a folder of product images on Drive, with a target product structure inspired by Shopee. **This is a 5-step pipeline** that bridges user-provided image dumps and the PHP/MySQLite backend:

### Step 1 — Get the share link working
User must set Drive folder to **"Anyone with the link"** (not just shared to specific people). `gdown.download_folder` against a restricted-share folder will hang at "Retrieving folder contents" then time out. The cure:
- User right-clicks folder → Share → General access → "Anyone with the link" → Viewer → Copy link
- Verify access by hitting `https://drive.google.com/drive/folders/{ID}?usp=sharing` in browser — should render without sign-in

### Step 2 — Install gdown and download
```bash
pip install gdown  # one-time
python -c "import gdown; gdown.download_folder(url='https://drive.google.com/drive/folders/{ID}?usp=sharing', output='C:/tmp/<staging_dir>', use_cookies=False, quiet=False)"
```
**Pitfalls hit in production:**
- **gdown 6.1 partial download** — lists + starts downloading 10 files then bails with `FileURLRetrievalError: Failed to retrieve file url`. Common cause: `?usp=sharing` not on URL, OR rate-limited, OR file ID extraction glitch on certain Drive folders. The error message links a specific file ID; you can retry JUST that file with direct `urllib.request.urlopen(f"https://drive.google.com/uc?export=download&id={fid}&confirm=t")`.
- **Output path trap** — passing `/c/tmp/foo` (MSYS) gets interpreted as relative `C:\c\tmp\foo`. Use `C:/tmp/foo` (no leading slash) or `C:\\tmp\\foo`. Verify with `os.path.exists(output)` after mkdir.
- **Large files** — Drive throttles if you hammer it. Sleep 0.3-2s between sequential downloads, never parallel.

### Step 3 — Infer product structure from filenames
When the user says "kamu atur produknya biar kayak Shopee" but doesn't tell you the schema, **read the filenames**:
- `Pastel 100 N.jpg` + `Pastel 150 N.jpg` → **2 size variants** of one product
- `playbox buka 100x150 pastel N.png` + `pastel color N (color combo).png` → **renderings** vs **catalog shots**
- `katalog/` subfolder + `lookbook/` → marketing imagery
- `playmat/` subfolder → different product type (not a variant)
- `pastel color 1 pink tango cream.png`, `pastel color 2 lilac pink tango.png` → **named color variants**, the number = SKU color index, the words = visual description

**Output the inference as a small table to the user BEFORE uploading** — show: "I see 2 size variants (100x150, 150x150) and 10 color variants per size. Should I create N products or 1 product with 10 variants?". Don't auto-decide; ask. The user knows their shop.

### Step 4 — Slugify rename locally
Before upload, rename files to web-safe slugs. Pattern:
```python
import re
def slugify(s):
    s = s.lower()
    s = re.sub(r'[^a-z0-9]+', '_', s)
    return s.strip('_')
# castel_100x150_pastel_01.jpg, castel_100x150_pastel_variant_pink_tango_cream.png
```
Two-pass: pass 1 uses `os.walk` + dictionary lookup for files whose semantic name is obvious (e.g. `Pastel 100 1.jpg` → `castel_100x150_pastel_01.jpg`). Pass 2 handles the variant files where you need to match `pastel color 1` with `pink_tango_cream` from a separate color-name list.

### Step 5 — Build products JSON, then push
For each inferred product, build the entry using the Playbie schema (id, name, category, price, imageUrl, imageUrls[], badge, badgeType, description, size, stock, variants[]). For 1 product with N variants, variants[] gets `{name: "Color: pink tango cream", imageIndex: N}` entries pointing to the variant PNGs in `imageUrls[]`.

**Push strategy** (once user confirms the schema):
1. **Images first** — upload all N images to `assets/` via the existing admin `/api/upload` endpoint (base64). Each image is small enough (PNG ~50KB-1MB, JPG ~60KB) to base64-encode and POST in one request. ~1-2s per image including base64 encode + HTTP roundtrip.
2. **Products next** — POST each product to `/api/products` (admin auth via JWT from previous login). One request per product.
3. **Verify** — `curl https://site/api.php?path=products | jq '.products | length'` should show new count.

**Why images first, products second**: if image upload fails, you don't have dangling product entries pointing at non-existent images. If product upload fails, you have orphan images in `assets/` (harmless, can clean later).

### Volume / time estimates (per product, 20 images)
- 20 image uploads via base64 API: ~30-60s total
- 1 product POST: <1s
- Schema validation + verify: ~5s
- **Total: ~1-2 min per product** with 20 images

For 30+ products, plan 30-60 min. Don't try to parallelize uploads — server rate-limits.

### User signal to watch for
- "kamu atur" / "kamu bikin" / "terserah" → user wants you to infer the structure. Show your inference, get a thumbs-up, then push.
- "ambil semua" / "scrape semua" → user wants comprehensive coverage. Use the full file list, don't subset.
- "test 1 dulu" / "1 dulu" → user wants incremental validation. Build 1 product, verify, then scale.
- User picks "D" (custom) in clarify → write out the proposed schema in chat, wait for explicit OK before coding.

Full step-by-step (gdown install, gdown quirks, file ID extraction, direct curl fallback, filename inference patterns, slugify rename, products JSON template, push strategy, user sign-off) is in `references/google-drive-bulk-image-ingest.md`.

### Size threshold for base64 upload (DA Evolution)

When bulk-uploading images via the `castel_uploader.php` helper pattern (base64 → `file_put_contents`), **files whose base64 exceeds ~800KB hit Apache's per-request timeout (~120s on this host)**. Smaller files (<500KB source, ~700KB base64) complete in <1s. The first file that times out is usually a high-res PNG (4001×4001 → 1.2MB source → 1.6MB base64).

**Heuristic for future bulk image pushes**: sort by size descending, check the first >800KB file specifically. If it times out, switch to one of:
- Re-encode the source at lower resolution (800×800 is plenty for product display)
- Compress with `zlib.compress` (limited help on already-compressed PNGs)
- Chunk across multiple requests, concatenate server-side
- Pre-encode the image into a single PHP helper that does `file_put_contents` in one shot (the **megafix pattern** but with binary data)

**Don't keep retrying the same large file** — it won't get faster, and the PHP worker may stay stuck for 30+ seconds after the request fails.

### Kill hazard: orphaned PHP workers after killing upload process

**Symptom**: after `kill` on the Python bulk-upload script, other PHP endpoints on the same site hang with `curl: (28) Operation timed out` and verbose shows `schannel: SSL/TLS connection renegotiated` twice. Static files (HTML, JPG, CSS) still serve fine.

**Likely cause**: Apache mod_php/PHP-FPM child got stuck on the file write the killed script was mid-streaming.

**Mitigation**: after killing any Python upload process that was in the middle of a POST, **wait 30+ seconds** before issuing more PHP requests. If you don't, the next request will hang and you'll waste time debugging network/TLS when it's actually the worker pool.

**Quick post-kill health check**: `curl -sI --connect-timeout 5 https://site/api.php?path=health` — if this returns within 5s, PHP is responsive. If it hangs, the worker pool is jammed; wait or restart Apache if you have access.

- **User re-uploaded manually? Re-verify before resuming**

**Pattern observed**: between sessions, the user manually re-uploaded the project folder (via FTP or File Manager), which **wiped the carefully-built `api.php` and `index.php`** and replaced them with the original versions from the unzipped project.

**Before resuming any pipeline after user intervention, do a 30-second verification**:
```bash
for f in api.php index.php .htaccess database.json; do
  echo "--- $f ---"
  curl -sI --connect-timeout 5 "https://site/$f" | head -1
done
```
If any 404 or wrong-size, re-upload them via the helper pattern before resuming. **Don't assume prior state**. The user's manual upload is additive chaos from your agent's perspective; the only way to recover is to re-list and re-verify.

Strengthens the existing "User can undo your work" pitfall with a concrete recipe.

- **"User says images broken" ≠ image URLs are broken.** This is the most common misdiagnosis in SPA debugging. When a Playbie-style SPA with hardcoded `STATIC_PRODUCTS` fallback gets the wrong JS file (e.g. the user re-uploaded the original `/api/*`-targeted version), the catalog silently falls back to STATIC_PRODUCTS — all 6 fallback entries share the same `assets/pastel_bumper_bed.png` image. User sees "no colors" and reports "images missing" but the actual bug is the JS isn't calling the right API path. **Diagnostic ladder** (do this before assuming CDN/CORS):
  1. `curl -s https://site/api.php?path=products | python -c "import json,sys; print(len(json.load(sys.stdin)))"` — is the API returning the right product count?
  2. `curl -s https://site/app.js | grep -c "/api/products"` — is the JS calling the right path? Should be 0 after migration.
  3. Only if step 2 is clean AND products are still missing: check CDN URL validity, CORS headers, asset file presence. **Don't start with CDN.** The JS path is the single most common cause of "missing images" symptoms in this class of work, because the symptom is visually identical to broken CDN but the root cause is one regex line in app.js. Full diagnostic recipe in `references/session-13-zip-upload-old-endpoints-and-proxy-image.md`.

### Detecting soft-404s (200 with 404 HTML body)

Some shared-hosting panels return **HTTP 200 with a 315-byte "Not Found" HTML page** instead of a real 404. This is invisible to `curl -sI | head -1` (which only prints the status line). Always include the body size to distinguish:

```bash
curl -sI --connect-timeout 5 "https://site/some-file" -w "size: %{size_download}\n" | grep -E "^(HTTP|size)"
# Real 200: HTTP/1.1 200 OK, size: 68499
# Soft 404: HTTP/1.1 200 OK, size: 315  ← suspicious
```

**`size_download` < 1000 on a "200" = treat as 404** until you confirm the file is supposed to be small.

## References / session detail

- `references/jktweb-contabo-asia.md` — specific quirks of jktweb.my.id / Contabo Asia hosting
- `references/evolution-fm-api.md` — full DA Evolution filemanager API catalog from session
- `references/case-playbie-php-migration.md` — worked example: full PHP port of Playbie Node backend, the upload envelope problem, recovery via helpers. Session 2 added: megafix base64-bundle pattern, user-redeploy pitfall, STATIC_PRODUCTS fallback, digitalnusa.com ref visual, code-review-only task pattern. Session 3 added: Shopee scraper attempt findings (bot detection blocks all 3 approaches — browser, direct API v4, direct HTML; `digitalnusa.com/playbie/` confirmed as identical mirror of user's site with zero new images to extract), `token_get_all()` for PHP parse-error diagnosis, "lu yang prep data" pivot expectation when external source is blocked, user signal "ambil image dari link ini" often means "reuse the design language, not literally copy the assets."
- `references/code-review-architecture-study.md` — full pattern for "lihat semua coding, jangan rebuild" tasks: 5-step workflow (recon → read chunked → structured summary → memory save → offer next steps), pitfalls (don't auto-rebuild, don't skim, don't dump code), when to trigger.
- `references/google-drive-bulk-image-ingest.md` — full pipeline for "kamu atur" tasks: gdown install + quirks, per-file curl fallback, filename inference, slugify rename, products JSON template, push strategy (images first, products second), user sign-off pattern.
- `references/session-5-bulk-66-image-upload.md` — Session 5 hard lessons: 1.2MB base64 timeout threshold on DA Evolution, kill-process can leave PHP workers stuck 30s+, Windows bash heredoc `\n` literal keeps breaking (always write_file the script first), DA Evolution 204/409/200 response shape, user manually re-uploaded and wiped api.php (always re-list before resuming), `urllib.parse.quote(path, safe='/')` for filenames with spaces, `curl -w "size: %{size_download}"` to detect soft-404s.
- `references/session-6-php-fpm-down-diagnosis.md` — Session 6: the bulk upload failed 100% and looked like a script bug, but the 3-file parallel probe (root + index.php + custom helper) revealed PHP-FPM is broken server-wide, not the script. Includes the port-scan-then-probe diagnostic sequence, DA Evolution plural-`file-manager` false-friend URL pitfall, and the "stop the loop + report, don't keep reformatting" workflow when server-side is broken.
- `references/session-7-da-api-bypass-techniques.md` — Session 7: when PHP-FPM is jammed AND you need to overwrite files AND you need to put files in subdirs that don't exist, the unlock is the **flat-rename pattern** (replace `/` with `__` in filename, drop the subdir entirely, update references in the consumer JSON/JS) + **user manual delete via File Manager UI** as the canonical overwrite path. 66 images uploaded in 11s via pure DA API, no PHP execution involved. Extends the "no overwrite" pitfall with the PHP-jammed subcase.
- `references/session-8-strict-types-re-seed-and-cleanup.md` — Session 8: PHP-FPM recovered but the previously-uploaded api.php/index.php/database.json all had multipart envelopes, and api.php now throws 500 with `strict_types declaration must be the very first statement` (the uniquely diagnostic envelope error for PHP files with `declare(strict_types=1);`). Sequence to recover: clean api.php (overwrite envelope-stripped) → clean index.php (50 bytes) → clean database.json (strip envelope, fix JSON) → delete playbie.db → hit health → re-seed from clean JSON. New pitfall discovered: `<?php` literal in Python `b"""<?php ... ?>` body gets stripped on upload — use `b'<' + b'?' + b'php'`. Universal cleaner (one helper, list of N target files with file-type-aware strip) is the unlock when 3+ files all need the same fix.
- `references/session-9-js-frontend-url-patch.md` — Session 9: backend fully recovered (9 products live, 66 images on disk) but the SPA frontend still called `/api/products` (old Node convention) instead of `/api.php?path=products` (PHP backend). User saw 6 hardcoded STATIC_PRODUCTS instead of 9 API products. New technique: **upload-as-new-then-PHP-rename for text files** — read live JS, apply URL patches (incl. template-literal `${id}` variants), upload as `app_new2.js` (different name avoids 409), upload a tiny PHP swapper that renames `app.js` → `app.js.bak` and `app_new2.js` → `app.js`. Also covers the "Forbidden on /assets/" false alarm (directory listing 403 is normal, not a bug — never enable `Options +Indexes` to "fix" it), and the `f'C:\\{name}_v2.js'` Windows-path gotcha (missing `tmp\` segment makes Python write to `C:\` root).
- `references/session-10-appended-envelope-swap-pitfall.md` — Session 10: silent JS parse failure from `app.js` ending in `----------Hxxx--`. Detection recipe, "the app loads but acts weird" symptom, single-pass tail-only cleaner pattern.
- `references/session-11-js-multipass-cleaner-and-filename-spaces.md` — Session 11: head+tail multipass cleaner for non-PHP text, space-in-filename browser pitfall (renames server files, updates `database.json`, deletes DB to force re-seed).
- `references/session-12-js-first-block-comment-pitfall-and-reseed-order.md` — Session 12: `strrpos("*/")` slicing JS at the first/only block comment, re-seed order (clean seed FIRST, then delete DB, then trigger init — not the other order), Python f-string `\$` regex warning, all-in-one delete+swap+clean helper for non-PHP overwrite.
- `references/session-13-zip-upload-old-endpoints-and-proxy-image.md` — Session 13/14: user shared a fresh zip (Playbie v2), uploaded 12 production files, but the JS still had `/api/*` (old Node convention) instead of `/api.php?path=*`. User's complaint "warna tidak ada" was actually STATIC_PRODUCTS fallback (catalog never called the API), NOT a CDN issue. Also: discovery of `/api/proxy-image` (Node-only motif proxy for customizer) — fixed by adding a PHP stub that serves `material_texture.png` as default motif. Includes the full 9-pattern endpoint patch list (up from Session 9's 6), the diagnostic ladder for "image tidak muncul" symptoms, the standalone maintenance.html template (no external deps), and the universal "is the JS wired to the backend?" curl test.
- `references/session-14-figma-color-match-and-slider.md` — Session 14 (visual fidelity): partial `/octet-stream\r\n` envelope leak in CSS (only the Content-Type value, not the full envelope — existing 9-pattern stripper missed it), CSS variables defined at `body.theme-pastel` instead of `:root` (fragile — variables resolve in cascade but `:root` query returns empty), logo structure `<a class="logo"><span class="logo-accent">play</span>bie</a>` (need to target child span, not parent), inline `<script>` injection for hero slider auto-rotate (smaller risk than patching 87KB app.js), JSON imageUrl pointing to external CDN (Desty/Shopee/Google) with CORS-OK, and the "warna tidak ada → actually JS is calling /api/products" diagnostic ladder.
- `references/session-15-viewer3d-neutral-default-and-3-location-backup.md` — Session 15: 3-location backup discipline (server `.bak` + local `LIVE_*.bak` + local `FROM_ZIP.bak`) for important file edits, multi-occurrence `this.colors = { ... }` pitfall (3 separate blocks — initial + 2 themes — need a loop to replace all, not just `find + replace`), "neutral default + working customizer" pattern (change the color initialization, not the customizer logic), Three.js `MeshStandardMaterial` 6-face array index order for BoxGeometry, and `window.playbie3D` runtime inspection via browser console for IIFE+class viewer patterns.
