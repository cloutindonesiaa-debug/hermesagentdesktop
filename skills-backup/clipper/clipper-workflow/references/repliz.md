# Repliz Scheduling Reference

## Verified Working Config

```python
BASE_URL = "https://api.repliz.com"
ACCESS_KEY = "6730837506"
SECRET_KEY = "YTf0GqLHT192VDXz0wMLAH3TrtbjfD6T"

def get_auth():
  import base64
  creds = f"{ACCESS_KEY}:{SECRET_KEY}"
  encoded = base64.b64encode(creds.encode()).decode()
  return {'Authorization': f'Basic {encoded}', 'Content-Type': 'application/json'}

ACCOUNT_IDS = {
  "youtube": "6a123e004492e5f5a8f83ded",  # @sosokberbicara
  "tiktok":  "6a119ad84492e5f5a8f82fe4",  # @sosokbicaraclip
  "threads": "69fd8b28877ca2e454040e50",  # @eric_ai_traderfx
}
```

## VPS Clip URL — CRITICAL PORT MISMATCH

**Actual VPS setup (May 2026):**
- Port 8080 → serves `/var/www/retrodaya/` (NOT clips!)
- Port 8081 → serves `/tmp/` (NOT clips!)
- Clips directory: `/var/www/clipper-dashboard/clips/` — NO HTTP server running!

**Before posting to Repliz, MUST start HTTP server on VPS:**
```bash
ssh root@43.134.83.2 "cd /var/www/clipper-dashboard/clips && nohup python3 -m http.server 9090 --bind 0.0.0.0 > /tmp/http.log 2>&1 &"
```

**Verified working clip URL format:**
```
http://43.134.83.2:9090/clip_001.mp4
http://43.134.83.2:9090/clip_002.mp4
```

**DO NOT use port 8080** — that serves retrodaya website, not clips.

---

## Schedule Endpoint
- **POST** `https://api.repliz.com/public/schedule`
- Auth: Basic {base64(access_key:secret_key)}
- Returns: 201 Created on success, 401 on bad credentials

## Request Body
```json
{
  "accountId": "6a123e004492e5f5a8f83ded",
  "medias": [{"url": "/clips/clip_001.mp4", "type": "video"}],
  "description": "Caption text with #hashtags",
  "scheduleAt": "2026-05-27T02:00:00Z"
}
```

**Fields:**
- `accountId`: from ACCOUNT_IDS
- `medias`: array of {url, type} — URL must be publicly accessible
- `description`: caption + hashtags text
- `scheduleAt`: ISO timestamp UTC. Set to now() for immediate posting.

## Batch Posting (Erik's Pattern)
Erik posts all 20 clips in one session — no time slot spreading:
1. Upload all 20 clips to VPS via rsync
2. Loop all clips, post to both YouTube + TikTok
3. Use `scheduleAt` = now (immediate)

```python
from datetime import datetime, timezone

def post_clip(clip, platform, account_id, video_url, caption):
  data = {
    'accountId': account_id,
    'description': caption,
    'type': 'video',
    'medias': [{'url': video_url, 'type': 'video'}],
    'scheduleAt': datetime.now(timezone.utc).isoformat().replace('+00:00', '000Z')
  }
  r = requests.post(BASE + '/public/schedule', headers=get_auth(), json=data, timeout=20)
  return r.status_code, r.json()
```

## VPS Clip URL
- Base: `/clips/`
- Clip URL: `f"/clips/clip_{clip_num:03d}.mp4"`

## Caption Generation by Topic

```python
TOPICS = {
  "finance": {
    "hashtags": "#rupiah #ekonomi #investasi #trading #viral #indonesia #financial #analisa"
  },
  "gaming": {
    "hashtags": "#gaming #gameplay #viral #moment #indonesia #gamingtiktok"
  },
  "podcast": {
    "hashtags": "#podcast #suarapodcaster #viral #indonesia"
  },
  "comedy": {
    "hashtags": "#comedy #lucu #viral #indonesia"
  },
  "storytelling": {
    "hashtags": "#storytelling #kisahnyata #viral #indonesia"
  },
  "education": {
    "hashtags": "#education #belajar #viral #indonesia"
  },
  "music": {
    "hashtags": "#music #musik #viral #indonesia"
  },
}
```

## API Behavior (Tested 2026-05-31)

### ✅ Video posts: 201 Created
```python
data = {
    "accountId": "6a123e004492e5f5a8f83ded",
    "description": "Caption + #hashtags",
    "type": "video",
    "medias": [{"url": "http://43.134.83.2:9090/clip_001.mp4", "type": "video"}],
    "scheduleAt": datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
}
# POST /public/schedule → 201 {"scheduleId": "..."}
```

### ❌ Text-only posts (no medias): 500 Error
```python
{"accountId": "...", "description": "...", "scheduleAt": "..."}
# → 500 "Cannot read properties of undefined (reading '0')"
```

### ❌ Link posts: 400 Error
```python
{"accountId": "...", "medias": [{"type": "link", "url": "..."}], ...}
# → 400 "meta should not be empty"
```

### ❌ Empty medias array: 400 Error
```python
{"accountId": "...", "medias": [], "description": "...", ...}
# → 400 "medias should not be empty"
```

### ❌ Text type in medias: 400 Error
```python
{"accountId": "...", "medias": [{"type": "text", "text": "..."}], ...}
# → 400 "each value in type must be one of: text, image, video, reel, album, link, story"
```

**Conclusion:** Repliz only accepts video/media posts. For article/text content, use video clip (via Clipper workflow) or direct platform APIs.

## Troubleshooting

**401 Unauthorized:** Secret key may have been truncated in file (shows as `YTf0Gq...fD6T`). Read raw bytes from file with Python regex to get full key:
```python
import re
with open('repliz-auto-poster.py', 'rb') as f:
  m = re.search(b"SECRET_KEY\\s*=\\s*['\\\"]([^'\\\"]+)['\\\"]", f.read())
  if m: print(m.group(1).decode())
```

**Clip posted but no URL:** Repliz returns `scheduleId` not the post URL. Track by `clip_id` + `platform` in state.json.