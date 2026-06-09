---
name: clipper-video-processing
title: Clipper Video Processing Pipeline
description: End-to-end pipeline for processing long YouTube videos into social media clips — download, face-detect crop, subtitle burn-in (Indonesian only), encode, and serve for review. For Clipper Company operations.
trigger: "video clipping, clip processing, social media video preparation, face-cut video, subtitle burn-in"
---

# Clipper Video Processing Pipeline

Processing long YouTube videos (30-60 min) into 20 clips (~2 min each) for YouTube/TikTok/Threads posting via Repliz.

## Workflow

### Phase 1: Download
```bash
# Best method: yt-dlp with cookies from browser
yt-dlp --cookies-from-browser chrome \
  -f "bestvideo[height<=1080][ext=webm]+bestaudio[ext=webm]/best[height<=1080][ext=webm]" \
  -o "/root/clipper-company/downloads/%(id)s.%(ext)s" \
  "https://youtube.com/watch?v=VIDEO_ID"

# Fallback: cookies file (refresh regularly — YouTube rotates cookies)
yt-dlp --cookies /root/clipper-company/cookies_youtube_v2.txt \
  -f "bestvideo[height<=1080]+bestaudio/best" \
  -o "/root/clipper-company/downloads/%(id)s.%(ext)s" \
  "VIDEO_URL"
```

**Download location:** `/root/clipper-company/downloads/`
**Subtitle:** `--write-subs --write-auto-subs --sub-lang en,id`

### Phase 2: Review Sample (ONE FIRST)
Before batch processing, extract and serve ONE clip for Erik's approval:

```bash
# Extract clip_001 (0-120sec) for review
ffmpeg -y -ss 0 -t 120 \
  -i /root/clipper-company/downloads/VIDEO_ID.webm \
  -vf "crop=1920:1080:0:0" \
  -c:v libsvtav1 -crf 30 \
  -c:a aac -b:a 128k \
  -movflags +faststart \
  /root/clipper-company/clips/VIDEO_ID/processed/clip_001.mp4

# Serve on port 9091
cd /root/clipper-company/clips/VIDEO_ID/processed && python3 -m http.server 9091
```

**Review URL:** `http://43.134.83.2:9091/clip_001.mp4`

**Wait for Erik's OK before batch processing.** He wants to see one sample first every time.

### Phase 3: Batch Process

```python
import cv2, subprocess, os
from pathlib import Path

def get_face_bbox(video_path, timestamp):
    """Detect face at timestamp. Returns (cx, cy, frame_w, frame_h) or None."""
    cap = cv2.VideoCapture(video_path)
    cap.set(cv2.CAP_PROP_POS_MSEC, timestamp * 1000)
    ret, frame = cap.read(); cap.release()
    if not ret: return None
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
    faces = cascade.detectMultiScale(gray, 1.3, 5)
    if len(faces) > 0:
        x,y,w,h = max(faces, key=lambda f: f[2]*f[3])
        return (x+w//2, y+h//2, frame.shape[1], frame.shape[0])
    return None

def process_clip(video_in, sub_in, output, clip_id, start_time, duration):
    """Single clip: face-detect crop + Indonesian subtitle (or skip if unavailable)."""
    
    # Dynamic face-cut crop
    face = get_face_bbox(video_in, start_time)
    if face:
        cx, cy, fw, fh = face
        cw, ch = 1920, 1080
        cx = max(cw//2, min(fw - cw//2, cx))
        cy = max(ch//2, min(fh - ch//2, cy))
        crop = f"crop={cw}:{ch}:{max(0,cx-cw//2)}:{max(0,cy-ch//2)}"
    else:
        crop = "crop=1920:1080:0:0"
    
    # Indonesian subtitle: burn in ONLY if Indonesian subtitle exists
    # If no Indonesian available → skip subtitle entirely (NOT English)
    # Subtitle format: force_style='FontName=DejaVu Sans,FontSize=15,...'
    # sub_filter = f"subtitles='{sub_in}':force_style='FontName=DejaVu Sans,FontSize=15,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1'"
    
    cmd = [
        'ffmpeg', '-y',
        '-ss', str(start_time), '-t', str(duration),
        '-i', video_in,
        '-vf', crop,  # + "," + sub_filter if Indonesian available
        '-c:v', 'libsvtav1', '-crf', '30',  # NOT libx264 — this VPS doesn't have it
        '-c:a', 'aac', '-b:a', '128k',
        '-movflags', '+faststart',
        output
    ]
    
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode == 0:
        return True, os.path.getsize(output) / 1024 / 1024
    return False, 0
```

**Timeline:** 20 clips, 2 min each, 24 sec overlap from 48-min video.
**Output:** `/root/clipper-company/clips/{video_id}/processed/clip_{NNN}.mp4`

### Phase 4: Serve for Distribution
```bash
cd /root/clipper-company/clips/{video_id}/processed
python3 -m http.server 9091
# URL: http://43.134.83.2:9091/clip_NNN.mp4
```

## Encoder Notes

**This VPS (43.134.83.2):**
- ✅ `libsvtav1` — AV1 encoder (use this)
- ✅ `libaom-av1` — AV1 decoder
- ✅ `libvpx-vp9` — VP9 encoder
- ❌ `libx264` — NOT available
- ❌ `libopenh264` — NOT available

**AV1 decode warning:** `[av1 @ xxx] Your platform doesn't support hardware accelerated AV1 decoding` — this is IGNORABLE. Software decode works fine, just slower (~20fps instead of faster). Does not affect output quality.

## Process Management

**Long encoding runs (10+ min):** Always use `background=true` + `notify_on_complete=true`:
```bash
python3 process_clips.py > /root/clipper-company/clip_progress.log 2>&1 &
# Or via terminal tool:
terminal(background=true, command="cd /root/clipper-company && python3 -c '...'", notify_on_complete=True)
```

**Monitor progress:** `grep -E "clip_[0-9]+.*MB|clip_[0-9]+.*FAILED" /root/clipper-company/clip_progress.log`

**Resume from failure:** The script already handles clip 1-4 done by checking existing files. To manually resume:
```python
start_clip = 5  # adjust based on what's done
cur = (start_clip - 1) * (clip_dur - overlap)  # timeline position
for cid in range(start_clip, 21):
    ...
```

## System Health Check

Use this before starting batch encoding to make sure resources are available:

```bash
# Quick health check
ps aux --sort=-%cpu | head -5
free -h
```

**Watch out for:** OpenClaw (Node.js gateway on port 18789) sometimes runs IDLE and eats 1 full CPU core (128%+ on single thread) with zero active connections. If CPU is saturated and encoding is slow, check:

```bash
ps aux | grep openclaw | grep -v grep
# If OpenClaw is using 100%+ CPU with no connections → kill it:
kill $(ps aux | grep 'openclaw.*gateway' | grep -v grep | awk '{print $2}')
```

**Who actually handles Telegram:**
- Hermes Gateway (PID 3521) → connected to Telegram servers ✅
- Hermes Agent (PID 1579) → also connected to Telegram ✅
- OpenClaw → **NOT connected to anything** (idle wastage)

OpenClaw is NOT a required component for Clipper Company's Telegram operations.

## HTTP Serve for Review

**First clip (port 9090):** Quick test server, can be killed after use
```bash
cd /root/clipper-company/clips/y4lLLx8_gOw/processed && python3 -m http.server 9090
```

**Subsequent clips (port 9091):** Dedicated server, kill old ones first
```bash
# Kill old server
pkill -f "http.server 9090"

# Start fresh
cd /root/clipper-company/clips/y4lLLx8_gOw/processed && python3 -m http.server 9091
```

**URL pattern:** `http://43.134.83.2:{port}/clip_{NNN}.mp4`

**Verify:** `curl -s --connect-timeout 3 http://43.134.83.2:9091/clip_001.mp4 -o /dev/null -w "%{http_code}"` should return `200`

## Posting to Repliz — Requirements

**Repliz requires public HTTPS URL for video media.** Local clips (`/root/clipper-company/clips/*.mp4`) cannot be posted directly.

Options to get clips accessible to Repliz:
1. **Serve via local VPS HTTP** — if Repliz can reach `http://43.134.83.2:9091/clip.mp4` (not always reliable)
2. **Upload to cloud storage** — GCS, Cloudflare R2, S3, etc. (need credentials)
3. **Direct upload via Repliz dashboard** — manually upload via app.repliz.com
4. **ngrok/cloudflared tunnel** — expose local HTTP as public HTTPS

**Verify Repliz can reach local server:**
```bash
# Start HTTP server on VPS
cd /root/clipper-company/clips && python3 -m http.server 9092

# From another terminal, test if externally reachable
curl -s --connect-timeout 5 https://api.repliz.com/public/health 2>/dev/null || echo "Repliz cannot reach local VPS"
```

If Repliz requires true public HTTPS (not self-signed), option 3 (manual upload) or cloud storage (option 2) are the reliable paths.

## Repliz Integration

The `repliz-agent.py` script is at `/root/clipper-company/social-automation/repliz-agent.py`.

**Auth:** Basic Auth with `base64(access_key:secret_key)`.

**Verify credentials:**
```bash
python3 /root/clipper-company/social-automation/repliz-agent.py status
```
Should show 6 connected accounts, not `401 unauthorized`.

**Post a clip (requires public HTTPS media URL):**
```python
import base64, requests
from datetime import datetime, timezone

creds = f"6730837506:{FULL_SECRET_KEY}"
encoded = base64.b64encode(creds.encode()).decode()
headers = {'Authorization': f'Basic {encoded}', 'Content-Type': 'application/json'}

schedule_at = datetime.now(timezone.utc).isoformat().replace('+00:00', '000Z')
payload = {
    "accountId": "6a119ad84492e5a8f82fe4",  # TikTok
    "description": "Caption with #hashtags",
    "type": "video",
    "medias": [{"url": "https://public.url/clip.mp4", "type": "video"}],
    "scheduleAt": schedule_at
}
r = requests.post('https://api.repliz.com/public/schedule',
                 headers=headers, json=payload, timeout=15)
# Success: 201 {"scheduleId": "..."}
```

**⚠️ The `repliz-agent.py post_clip()` function uses WRONG field names and will return 401.** Always use the direct API call above.

Full API reference: `references/repliz-api.md` in veronica-social-media skill.

## Subtitle Policy

**Indonesian only.** If no Indonesian subtitle track exists:
- Do NOT fall back to English subtitle
- Skip subtitle burn-in entirely
- Burn English only if Erik explicitly requests it

**Font:** DejaVu Sans, size 15. (Noto Sans not installed on this VPS.)
**Position:** `align:start position:0%` (top-left, like hardcoded subs)

## Output Specs

- **Container:** MP4
- **Video:** AV1 (libsvtav1), 1920x1080, CRF 30
- **Audio:** AAC 128k stereo
- **Flags:** `+faststart` for web streaming
- **Target size:** ~20-30MB per 2-min clip

## Erik's Preferences

- **Bahasa Indonesia** for all communication
- **Short, direct responses** — no verbose explanations
- **One sample first** → wait for approval → batch process
- **Subtitle:** Indonesian only, font size 15. No Indonesian = no subtitle
- **Action-oriented:** just execute, minimal planning

## Repliz Target Accounts

- YouTube: @sosokberbicara (id: 6a123e004492e5f5a8f83ded)
- TikTok: @sosokbicaraclip (id: 6a119ad84492e5f5a8f82fe4)
- Threads: @eric_ai_traderfx (id: 69fd8b28877ca2e454040e50)

## Directory Structure

```
/root/clipper-company/
  downloads/          # Raw video + subtitle downloads
  clips/
    {video_id}/
      processed/      # Final encoded clips
  social-automation/
    repliz-agent.py  # Repliz API wrapper (see references/repliz-api.md)
  state.json         # Business state
```

## API Integration Status

✅ Video processing: fully operational
✅ Repliz posting: API credentials resolved — POST /public/schedule returns 201
⏳ Media hosting: Clips are local — Repliz requires public HTTPS URL for video media. Upload clip to cloud hosting or VPS serve first before posting.

**Verify Repliz auth:**
```bash
python3 /root/clipper-company/social-automation/repliz-agent.py status
# Should show 6 connected accounts
```

**Post a clip (requires public media URL first):**
```python
import base64, requests
from datetime import datetime, timezone

creds = f"6730837506:{FULL_SECRET_KEY}"
encoded = base64.b64encode(creds.encode()).decode()
headers = {'Authorization': f'Basic {encoded}', 'Content-Type': 'application/json'}

schedule_at = datetime.now(timezone.utc).isoformat().replace('+00:00', '000Z')
payload = {
    "accountId": "6a119ad84492e5a8f82fe4",  # TikTok
    "description": "Caption with #hashtags",
    "type": "video",
    "medias": [{"url": "https://public.url/clip.mp4", "type": "video"}],
    "scheduleAt": schedule_at
}
r = requests.post('https://api.repliz.com/public/schedule',
                 headers=headers, json=payload, timeout=15)
# Success: 201 {"scheduleId": "..."}
```

Full API reference: `references/repliz-api.md` in veronica-social-media skill.