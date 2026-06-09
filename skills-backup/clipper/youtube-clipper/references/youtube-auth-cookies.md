# YouTube Auth & Cookie Handling

## Problem: YouTube Bot Protection

YouTube frequently blocks automated downloads via yt-dlp/streamlink when:
- No valid auth cookies are provided
- Cookies are expired or rotated
- Video is region-locked or age-restricted

## Signals that Auth Cookies are Needed

```
ERROR: Sign in to confirm your age
ERROR: This video is available only to logged-in users
HTTP Error 403: Forbidden
```

## Solutions (in priority order)

### 1. Export Browser Cookies (Recommended)

In Chrome/Edge/Firefox:
1. Install "EditThisCookie" extension or use DevTools
2. Go to youtube.com, ensure logged in
3. Export cookies as JSON or Netscape format
4. Convert to Netscape format if needed (JSON → Netscape via script)

**Format for yt-dlp:**
```bash
# Netscape cookies format (email, domain, cookie_name, value, path, expires)
youtube.com	FALSE	/	TRUE	1735689600	VISITOR_INFO1_LIVE	xxxxx
```

**Usage:**
```bash
yt-dlp --cookies=/path/to/cookies.txt <youtube_url>
```

### 2. Refresh Expired Cookies

YouTube rotates cookies regularly. If existing cookies fail:
1. Open youtube.com in browser (logged in)
2. Open DevTools → Application → Cookies
3. Copy fresh values for:
   - `VISITOR_INFO1_LIVE`
   - `SID`
   - `HSID`
   - `SSID`
   - `APISID`
   - `SAPISID`
   - `LOGIN_INFO`

### 3. Alternative: Manual Download + Upload

If cookies keep failing:
1. User downloads manually in their browser
2. Uploads to VPS: `/root/clipper-company/downloads/`
3. Agent processes from local file (no auth needed)

### 4. Invidious Instances (Unreliable)

Public Invidious instances often go down. Check status before relying on them.

## Key Files in This Project

- `/root/clipper-company/downloads/` - Video storage
- `/root/clipper-company/cookies_youtube_v2.txt` - Current cookie file (may be expired)
- `/root/clipper-company/youtube_download.py` - Multi-method download script with ROBUST fallback

## ROBUST Download Method (Primary - Tested May 2026)

The following combination is verified working on VPS (Singapore IP 43.134.83.2):

```bash
yt-dlp --cookies=/root/clipper-company/cookies_youtube_v2.txt \
  --user-agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36" \
  --extractor-args "youtube:player_client=web" \
  -f "best[height<=720]/best" \
  --retries 3 \
  -o "/root/clipper-company/downloads/%(title)s.%(ext)s" \
  "YOUTUBE_URL"
```

**Key flags:**
- `--extractor-args "youtube:player_client=web"` — CRITICAL, bypasses bot detection
- `--user-agent` with Chrome 125 — avoids IP-level blocking
- `--cookies` — handles age-restricted videos
- `-f "best[height<=720]/best"` — 720p max to avoid quality issues
- `--retries 3` — automatic retry on transient failures

**Why alternatives failed (May 2026):**
- Invidious instances: All tested instances down (yewtu.be, inv.nadeko.net, invidious.kavin.rocks, etc.)
- youtube-dl: Outdated, signature extraction broken
- gallery-dl: No YouTube video support, only images/galleries

**Automated download via script:**
```bash
python3 /root/clipper-company/youtube_download.py <video_id>
```
The script auto-sequences: ROBUST → NodeJS → Invidious → Alternatives → RemoteEJS → YouTubeAPI

## Verification

Test cookie validity:
```bash
curl -s -b /path/to/cookies.txt \
  -H "User-Agent: Mozilla/5.0" \
  "https://www.youtube.com/api/sharebox/转发的链接" \
  | head -c 500
```

Look for `"playerResponse"` in response — valid cookie.
Look for `"error"` or auth prompts — cookie expired/invalid.