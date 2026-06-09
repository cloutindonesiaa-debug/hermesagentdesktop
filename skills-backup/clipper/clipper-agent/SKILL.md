---
name: clipper-agent
description: "Clipper worker agent for video clipping tasks — receives YouTube link, extracts best viral moments, creates 20 short clips, and reports status to dashboard."
version: 1.0.0
author: Clipper Company
tags: [clipper, video, youtube, tiktok]
created_by: agent
---

# Clipper Agent

Worker agent yang menangani video clipping task. Each clipper gets assigned one YouTube video and must deliver 20 short clips (best viral moments).

## Workflow

### 1. Receive Task
When assigned a task, the agent receives:
- YouTube video URL
- Target: 20 clips
- Platform: TikTok (vertical 9:16, 60-90 seconds each)

### 2. Analysis Phase
```
- Download video using yt-dlp
- Analyze frames to identify viral-worthy moments
- Identify: high energy, emotional peaks, comedic timing, surprising moments
- Extract timestamps for 20 best moments
```

### 3. Clipping Phase
```
- Cut each segment (60-90 seconds)
- Add trending transitions
- Add subtitle/caption overlay
- Optimize for TikTok format (9:16, first 3 seconds hook)
```

### 4. Quality Check
```
- Review each clip for quality
- Ensure no black frames or glitches
- Verify hook strength
- Check audio sync
```

### 5. Delivery
```
- Save clips to designated folder
- Name format: {video_id}_clip_{number}_{timestamp}.mp4
- Report completion with links
```

## Tools Available

- `terminal` - run yt-dlp, ffmpeg, and other CLI tools
- `file` - read/write/organize clips
- `browser` - preview TikTok trends, research hooks
- `vision` - analyze video frames for viral moments

## Output Format

When task is complete, post comment to kanban task:
```
CLIP COMPLETE: 20 clips created
- Video: {youtube_url}
- Folder: /root/clipper-output/{task_id}/
- Clips: clip_001.mp4 through clip_020.mp4
```

## Status Updates

Send heartbeat every 5 minutes during work:
```
UPDATE: Analyzing video... (frame 450/1200)
UPDATE: Cutting clips... (5/20 done)
UPDATE: Finalizing... (18/20 done)
```

## Environment

Working directory: `/home/admin/clipper-company/clips/{video_id}/processed/`
Model: MiniMax-M2.7 (provider: minimax)

**IMPORTANT**: Base directory is `/home/admin/clipper-company`, NOT `/root/clipper-company`.

## VPS Environment Notes (OpenCloudOS)

This VPS has specific constraints:
- `libx264` is NOT available — use `libsvtav1` instead (AV1 software encoder)
  ```python
  # Correct encoder:
  cmd = ['ffmpeg', '-c:v', 'libsvtav1', '-crf', '30', ...]
  
  # Wrong (will fail with "Unknown encoder 'libx264'"):
  cmd = ['ffmpeg', '-c:v', 'libx264', ...]
  ```
- No hardware AV1 decoding — software fallback works, ignore "platform doesn't support hardware accelerated AV1 decoding" warnings
**Python cv2 path**: cv2 is at `/home/admin/.local/share/uv/tools/browser-act-cli/bin/python3`. When calling `python3` from terminal, default is Hermes venv Python which does NOT have cv2. Use the full path or use `clipper.sh` launcher.

## Face-Cut Dynamic Cropping

For social media clips, use OpenCV face detection to center crop on speaker:

```python
import cv2

def get_face_center(video_path, timestamp):
    cap = cv2.VideoCapture(video_path)
    cap.set(cv2.CAP_PROP_POS_MSEC, timestamp * 1000)
    ret, frame = cap.read()
    cap.release()
    if not ret:
        return None
    
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    cascade = cv2.CascadeClassifier(
        cv2.data.haarcascades + 'haarcascade_frontalface_default.xml'
    )
    faces = cascade.detectMultiScale(gray, 1.3, 5)
    
    if len(faces) > 0:
        x, y, w, h = max(faces, key=lambda f: f[2] * f[3])
        return (x + w//2, y + h//2, frame.shape[1], frame.shape[0])
    return None

def build_crop_str(face_info, target_w=1920, target_h=1080):
    """Build ffmpeg crop filter string from face position"""
    if face_info is None:
        return "crop=1920:1080:0:0"  # Center crop fallback
    
    cx, cy, fw, fh = face_info
    cx = max(target_w//2, min(fw - target_w//2, cx))
    cy = max(target_h//2, min(fh - target_h//2, cy))
    x1 = max(0, cx - target_w//2)
    y1 = max(0, cy - target_h//2)
    return f"crop={target_w}:{target_h}:{x1}:{y1}"
```

## Clip Timeline Strategy

For a 48-minute video targeting 20 clips:
- Clip duration: 120 seconds (2 min each)
- Overlap: 24 seconds (ensures continuity between clips)
- Step: clip_duration - overlap = 96 seconds per clip
- Formula: `current_time += 96` per clip
- Last clip: `end_time = min(current_time + 120, total_duration)`

Example timeline for 48-min video:
```
clip_001: 00:00 - 02:00
clip_002: 02:24 - 04:24
clip_003: 04:48 - 06:48
...
clip_020: 45:33 - 47:33
```

## Subtitle Handling

User preference: Indonesian subtitle only. If no Indonesian subtitle available, skip subtitle entirely (do NOT burn English subtitle).

When Indonesian IS available, burn with:
- Font: DejaVu Sans (available on VPS)
- Font size: 15
- Position: bottom center
- Style: white text, black outline

```bash
# Subtitle burn-in filter (Indonesian)
sub_filter="subtitles='{path_to_sub}':force_style='FontName=DejaVu Sans,FontSize=15,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1'"
```

## YouTube Download: Cookies & Challenge Bypass

YouTube uses a JavaScript-based challenge (EBahn) that CLI tools like yt-dlp cannot solve — even with valid cookies. The browser can execute JavaScript to pass the challenge; CLI cannot. This means:
- Browser-exported cookies work in a real browser session
- Same cookies in netscape format for yt-dlp may still fail if the video triggers the challenge
- If yt-dlp returns `"challenge solving failed"` or `"Only images are available for download"`, the video is challenge-blocked in CLI

**Cookie extraction workflow (when user provides browser cookie export):**
```bash
# 1. Extract YouTube cookies from browser export (e.g. cookies_3.txt)
grep -E "youtube\.com|googlevideo\.com" /root/clipper-company/cookies_3.txt \
  > /root/clipper-company/cookies_youtube.txt

# 2. Verify it's netscape format (has DOMAIN, HTTPOnly, etc. headers)
head -5 /root/clipper-company/cookies_youtube.txt

# 3. Use with yt-dlp
yt-dlp --cookies /root/clipper-company/cookies_youtube.txt "{YOUTUBE_URL}"

# 4. If still fails with "challenge solving", the video is CLI-blocked
#    -> Fallback: user must download manually and upload to VPS
```

**Fallback when cookies don't work:**
- Ask user to download the video manually via browser
- User uploads to VPS at `/root/clipper-company/downloads/`
- Continue with clipping phase using local file

## Pitfalls

- Do NOT assume browser cookies will work in yt-dlp — test first
- Do NOT spend time retrying the same cookie+yt-dlp combo if challenge error persists — escalate to manual download fallback
- YouTube may return only storyboard images (not video streams) for blocked videos — check with `yt-dlp --list-formats` first
- **NEVER use `libx264` on this VPS** — it is not installed. Always use `libsvtav1` with `-crf 30`
- **libsvtav1 does not support `-preset` flag** — it will error with "Unable to parse option value 'fast'". Omit the preset entirely
- AV1 decoding warnings are harmless — ffmpeg falls back to software decoding automatically
- Long-running clip processing (>5 min) must be run in background with `notify_on_complete=true`

## Cookie Completeness Check (MUST DO before downloading)

Before attempting yt-dlp, verify cookies have required auth fields:
```bash
grep -E "SID|SSID|LOGIN_INFO|APISID|SAPISID" /root/clipper-company/cookies_youtube.txt
```

**Minimum required**: `SID` + `SSID` OR `LOGIN_INFO` (with `GN` prefix)

If only `VISITOR_INFO1_LIVE`, `YSC`, `PREF` — cookies are insufficient. Go directly to fallback (manual download/upload) without retrying yt-dlp.

## Related Skills

- `youtube-clipper` — detailed workflow for Chinese/English bilingual clipping with subtitle burn-in
- Use youtube-clipper scripts (download_video.py, clip_video.py, etc.) for implementation
- `scripts/process_clips.py` — face-cut + libsvtav1 clip processor for this VPS environment
- `veronica-social-media` — social media posting via Repliz (has account IDs + API reference)

## Repliz Posting Integration

**Production script:** `scripts/repliz-auto-poster.py` — handles VPS upload + Repliz POST for both platforms in one round. Use this instead of manual API calls.

**Credentials:** `/root/clipper-company/social-automation/.env` + VPS password from chat.

**⚠️ The old `repliz-agent.py` `post_clip()` uses WRONG field names and will return 401.** Use `scripts/repliz-auto-poster.py` or the correct API format below.

**Correct Repliz POST format:**
```python
import base64, requests
from datetime import datetime, timezone

creds = f"6730837506:{FULL_SECRET_KEY}"
encoded = base64.b64encode(creds.encode()).decode()
headers = {'Authorization': f'Basic {encoded}', 'Content-Type': 'application/json'}

schedule_at = datetime.now(timezone.utc).isoformat().replace('+00:00', '000Z')
payload = {
    "accountId": "6a119ad84492e5a8f82fe4",  # TikTok @sosokbicaraclip
    "description": "Caption text with #hashtags",  # NOT title/caption
    "type": "video",
    "medias": [{"url": "https://public.url/clip.mp4", "type": "video"}],
    "scheduleAt": schedule_at
}
r = requests.post('https://api.repliz.com/public/schedule',
                 headers=headers, json=payload, timeout=15)
# Success: 201 {"scheduleId": "..."}
```

**CRITICAL field names:** `accountId`, `scheduleAt`, `description`, `medias[]` — wrong names cause 401.

**Media requirement:** Repliz requires PUBLIC accessible URL. Local files cannot be posted directly — use VPS HTTP server workflow (see VPS Upload + Public URL Workflow above).

**Account IDs:**
- YouTube: `6a123e004492e5f5a8f83ded` (@sosokberbicara)
- TikTok: `6a119ad84492e5a8f82fe4` (@sosokbicaraclip)
- Threads: `69fd8b28877ca2e454040e50` (@eric_ai_traderfx)

**Repliz Auth Debugging:**
- GET /public/account with Basic Auth → works (200) if credentials valid
- POST /public/schedule with truncated/partial secret key → 401 even if GET works
- **ALWAYS use the COMPLETE secret key** — partial keys (`YTf0Gq...fD6T`) cause POST 401 while GET still succeeds
- Success response: HTTP 201 with `{"scheduleId": "..."}`
- Validation error: HTTP 400 with specific field error message

**Posting schedule (Erik's preference):**
- 3 posts per day per platform, 5-hour gap between posts
- Jeda 5 jam = next post at `scheduleAt + 5 hours`
- Use `scripts/repliz-auto-poster.py post` to trigger one posting round

Full API reference: `references/repliz-api.md` in veronica-social-media skill.

## VPS Upload + Public URL Workflow

Repliz needs a PUBLIC HTTPS URL for each clip. Since clips live locally on this VPS, the workflow is:

1. **SCP clip to 43.134.83.2** (VPS public server):
   ```bash
   sshpass -p 'VPS_PASSWORD' scp -o StrictHostKeyChecking=no \
     /root/clipper-company/clips/clip_01.mp4 \
     root@43.134.83.2:/var/www/clipper-dashboard/clips/
   ```

2. **Serve via VPS HTTP** — use port **9090** (8080 was not running):
   ```bash
   sshpass -p 'VPS_PASSWORD' ssh -o StrictHostKeyChecking=no root@43.134.83.2 \
     "nohup python3 -m http.server 9090 > /dev/null 2>&1 &"
   # Verify:
   curl -s -o /dev/null -w '%{http_code}' http://43.134.83.2:9090/clip_01.mp4
   ```

3. **Construct public URL** — use VPS public IP with port 9090:
   ```
   http://43.134.83.2:9090/clip_01.mp4
   ```

4. **Post to Repliz** with that URL in the `medias` array.

**⚠️ SSH access to VPS must be set up first** (see below). If `/var/www/clipper-dashboard/` doesn't exist on VPS, create it or adjust path.

### SSH Key Setup for VPS Access

VPS (43.134.83.2) requires public key authentication. To set up:

1. Generate a key pair (if not exists):
   ```bash
   ssh-keygen -t ed25519 -f /tmp/vps_key -N "" -C "hermes-clipper"
   ```

2. User must add the **public key** to VPS (`~/.ssh/authorized_keys` on 43.134.83.2):
   ```
   ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDAnrZJVoRewvEnl+Pztj1EXoPqxjvHdNQ5680P/aA3a hermes-clipper
   ```

3. Verify access:
   ```bash
   ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no -i /tmp/vps_key root@43.134.83.2 "echo OK"
   ```

4. Confirm HTTP serving works — VPS port 8080 must be reachable:
   ```bash
   curl -I http://43.134.83.2:8080/ --max-time 5
   ```

### VPS HTTP Server

**⚠️ Port 8080 was NOT serving on 43.134.83.2** — the dashboard at `/var/www/clipper-dashboard/` existed but `python3 -m http.server 8080` was not running. Use port **9090** instead:

```bash
# Start HTTP server on VPS (port 9090, serves /var/www/clipper-dashboard/)
sshpass -p 'VPS_PASSWORD' ssh -o StrictHostKeyChecking=no root@43.134.83.2 \
  "nohup python3 -m http.server 9090 > /dev/null 2>&1 &"

# Verify accessible
curl -s -o /dev/null -w '%{http_code}' http://43.134.83.2:9090/clip_01.mp4
# Expected: 200
```

Video public URL format: `http://43.134.83.2:9090/{filename}`

### SSH Access to VPS

**VPS credentials (43.134.83.2):**
- IP: `43.134.83.2`
- User: `root`
- Auth: SSH password (user-provided via chat)
- Tool needed: `sshpass` — install with `yum install -y sshpass` if not present

**Quick test:**
```bash
yum install -y sshpass  # install if needed
sshpass -p 'VPS_PASSWORD' ssh -o StrictHostKeyChecking=no root@43.134.83.2 "echo OK"
```

**SCP upload:**
```bash
sshpass -p 'VPS_PASSWORD' scp -o StrictHostKeyChecking=no \
  /root/clipper-company/clips/clip_01.mp4 \
  root@43.134.83.2:/var/www/clipper-dashboard/clips/
```

**Erik's preference:** VPS SSH credentials are provided by user via chat when needed — search `/root/.hermes/.env`, `/root/.ssh/`, and `/root/clipper-company/` for stored credentials before generating new keys. Only generate a new key if no stored credentials work.