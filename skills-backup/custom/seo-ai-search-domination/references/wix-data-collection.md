# Wix Site SEO Data Collection — Reference

## browser_navigate Fails on Wix

**Problem:** `agent-browser` binary may be missing.
**Workaround:** Use `curl` with full Chrome User-Agent. Wix blocks simple curl agents.

```bash
# SUCCESSFUL pattern for Wix sites
curl -s "https://TARGET-SITE" \
  -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" \
  -L --max-time 15
```

## Wix Page Content: H1/H2 Not in Plain HTML

Wix injects content via JS after load. Plain `grep h1|h2` on raw HTML returns empty.

**For H1/H2 extraction**, grep for content inside JSON blobs:

```bash
# Look for page content in JSON blobs (wix-warmup-data or viewerModel)
curl -s "https://TARGET-SITE/PAGE" -A "Mozilla/5.0..." -L --max-time 15 \
  | grep -o '"name":"[^"]*"' | head -20

# Extract text node patterns
curl -s "https://TARGET-SITE/PAGE" -A "Mozilla/5.0..." -L --max-time 15 \
  | grep -o 'viewerModel[^"]*' | head -3

# For title + meta — these ARE in raw HTML (unlike body content)
curl -s "https://TARGET-SITE/PAGE" -A "Mozilla/5.0..." -L --max-time 15 \
  | grep -E '<title>|<meta name="description"' | head -3
```

**For full content audit of a Wix page**, use `browser_console` with `document.body.innerText` after `browser_navigate` — JS-rendered text is accessible via the browser DOM.

## Common Wix SEO Issues

| Issue | How to Detect | Fix |
|-------|--------------|-----|
| Template meta description never replaced | `grep` raw HTML for placeholder text patterns like `[Company Name]`, `your company`, template variables | Republish with filled-in fields in Wix SEO Hub |
| Duplicate meta descriptions | Compare output of all page `grep` commands | Write unique 155-char descriptions per page |
| Missing hreflang | `grep` raw HTML for `hreflang` | Add via Wix URL Languages panel |
| Schema.org absent | `grep` for `application/ld+json` | Add via Wix Structured Data panel |
| Canonical pointing to 404 | Check sitemap + compare with actual URLs | Wix handles this automatically if URL structure unchanged |
| "Coming Soon" pages indexed | Browser navigate + check for overlay | Unpublish pages not ready |

## Wix SEO Panel Locations

- **Meta title + description:** Site Settings → SEO Basics (per page)
- **hreflang:** Site Settings → URL Languages
- **Schema.org:** Site Settings → SEO Tools → Structured Data
- **Sitemap:** Wix auto-generates `/sitemap.xml` — verify in Google Search Console
- ** robots.txt:** Wix auto-generates — limited customizability

## Content Strategy Implication

Wix makes thin content risky — page shells (empty H1, no body text) are common. **Always verify actual rendered content** before recommending content as "existing." A page with a hero image and no body text is not content.
