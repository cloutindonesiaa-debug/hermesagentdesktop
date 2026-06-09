---
name: clipper-workflow
description: Workflow Clipper Company untuk Andre打理. YouTube URL masuk, auto-download, 20 clips, upload VPS, schedule Repliz, cleanup old. Executable.
---

# Clipper Workflow Skill

## Deskripsi
Andre kirim YouTube URL via Telegram → auto-download dengan robust youtube_download.py → 20 clips dengan face detection + subtitle → upload VPS → schedule Repliz → cleanup old. Automatic — tanpa tanya.

## Workflow Steps

### 1. Terima Input
Andre kasih YouTube URL via Telegram.

### 2. Download Video
```bash
cd /root/clipper-company
python3 youtube_download.py <VIDEO_ID>
```

**6-method fallback chain dalam script (priority order):**
1. yt-dlp ROBUST (cookies + user-agent + player_client=web) - BEST
2. NodeJS yt-dlp (EJS challenge solver)
3. Invidious instances (yewtu.be, vid.puffyan.us, dll)
4. Alternative extractors (android/ios/mweb)
5. Remote EJS solver (GitHub)
6. YouTube get_video_info API

**Pitfall:** Video ID harus ada di state.json queue dulu. Kalau belum:
```python
import json
with open('state.json') as f: s = json.load(f)
s['videos']['VIDEO_ID'] = {'url': 'https://youtu.be/VIDEO_ID', 'id': 'VIDEO_ID', 'status': 'queued'}
with open('state.json', 'w') as f: json.dump(s, f, indent=2)
```

Output: `/root/clipper-company/downloads/{VIDEO_ID}.mp4`

### 3. Clipper (20 Clips)

**Face Detection (OpenCV Haar Cascade):**
```python
import cv2
face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')

# Sample frame di 3 posisi acak, deteksi face → pakai posisi face pertama
# Fallback: center crop kalau tidak ada face
```

**Encoding settings (confirmed working on this machine):**
- Encoder: libsvtav1 preset 8 (NOT libx264 — libx264 "encoder not found" di lingkungan ini)
- CRF: 30
- Audio: AAC 128k
- Speed: ~2x realtime (encode 120 detik video butuh ~60 detik)
- Resolution: crop ke 1080x1920 centered on face

**Subtitle:** Font size 15. Skip kalau tidak ada Indonesian subtitle. Cek dulu: `yt-dlp --sub-langs en,id --skip-download <url>` — "no subtitles" kalau tidak ada.

**Output:** 20 clips @ `/root/clipper-company/clips/{VIDEO_ID}/processed/clip_001.mp4` — clip_020.mp4

### 4. Analyze Video Topic

Manually detect dari video title + content. Categories: gaming, podcast, comedy, storytelling, education, music, vlog, news, finance.

**Confirmation-tested topics:**
- "Rupiah", "analisis", "keuangan" → finance
- "gaming", "gameplay", "moment" → gaming

```python
TOPICS = {
  "gaming": {"hashtags": "#gaming #gameplay #viral"},
  "finance": {"hashtags": "#finance #investing #rupiah #ekonomi"},
  "podcast": {"hashtags": "#podcast #suarapodcaster"},
  "comedy": {"hashtags": "#comedy #lucu #viral"},
  "storytelling": {"hashtags": "#storytelling #kisahnyata"},
  "education": {"hashtags": "#education #belajar"},
  "music": {"hashtags": "#music #musik"},
  "vlog": {"hashtags": "#vlog #daily"},
  "news": {"hashtags": "#news #berita #viral"},
}
```

### 5. Generate Caption + Hashtags
Berdasarkan topik yang terdeteksi. Caption harus sesuai video content — bukan generic gaming hashtag.

### 6. Upload ke VPS
```bash
# Upload clips via rsync (faster than scp for many files)
sshpass -p 'gDe-pFj-dNm-UHp' rsync -e "ssh -o StrictHostKeyChecking=no" -avz \
 --progress /home/admin/clipper-company/clips/{VIDEO_ID}/processed/*.mp4 \
 root@43.134.83.2:/var/www/clipper-dashboard/clips/

# Verify: should return 20
sshpass -p 'gDe-pFj-dNm-UHp' ssh root@43.134.83.2 \
 "ls /var/www/clipper-dashboard/clips/ | wc -l"
```

VPS Base URL: ``
Clip access: `http://43.134.83.2:9090/clips/clip_XXX.mp4`

### 7. Schedule ke Repliz (Batch Queue)
20 clips di-schedule ke Repliz:
- 3 clips per slot (09:00, 14:00, 19:00 WIB)
- Sisanya di-schedule hari berikutnya

**Repliz Config:**
```python
BASE_URL = "https://api.repliz.com/public"
ACCESS_KEY = "6730837506"
SECRET_KEY = "YTf0GqLHT192VDXz0wMLAH3TrtbjfD6T"
AUTH = base64.b64encode(f"{ACCESS_KEY}:{SECRET_KEY}".encode()).decode()

ACCOUNT_IDS = {
  "youtube": "6a123e004492e5f5a8f83ded",
  "tiktok": "6a119ad84492e5f8f82fe4",
}
```

**POST /public/schedule:**
```json
{
  "accountId": "6a123e004492e5f5a8f83ded",
  "medias": [{"url": "http://43.134.83.2:9090/clip_001.mp4", "type": "video"}],
  "description": "Caption + hashtags",
  "scheduleAt": "2026-05-27T02:00:00Z"
}
```

**POST body fields:**
- accountId: dari ACCOUNT_IDS
- medias: array of {url, type}, url harus public accessible
- description: caption + hashtags
- scheduleAt: ISO timestamp UTC (WIB minus 8 jam)

### 8. Cleanup Old Downloads
```bash
find /root/clipper-company/downloads/ -type f -mtime +1 -delete
find /root/clipper-company/clips/ -type f -name "*.mp4" -mtime +1 -delete
```

---

## Cron Jobs Setup (Existing)
```
09:00 WIB (02:00 UTC) — cron_id: ddee96054b6b
14:00 WIB (07:00 UTC) — cron_id: ee1d830f5cfd
19:00 WIB (12:00 UTC) — cron_id: 6930db075b98
```

Load skill `repliz-auto-poster`, run script yang baca queue dan post.

---

## Support Files
- `references/environment.md` — dual-python paths, tool locations, VPS credentials (READ THIS FIRST)
- `references/encoding.md` — confirmed working encode commands, timing benchmarks, batch strategy, corrupt clip patterns
- `references/repliz.md` — Repliz API config, schedule slots, caption templates by topic, VPS upload commands
- `references/verify_clips.py` — clip integrity checker (missing + corrupt detection)
- `references/telegram-diagnostic.md` — Telegram bot troubleshooting: token validation, getUpdates diagnostic, Hermes polling issues, common fixes
- `references/multi-agent-soul-system.md` — Kiro AI multi-agent pattern: agent souls, routing cheat sheet, prompt templates for building persistent agent teams (Orchestrator/Scout/Scribe/Reach/Dev)

---

## Pitfalls
1. **PATH INCONSISTENCY: `/root/clipper-company` vs `/home/admin/clipper-company`** — CRITICAL: The skill documentation frequently references `/root/clipper-company` but the ACTUAL working directory on this machine is `/home/admin/clipper-company`. All scripts, state.json, downloads/, and clips/ live under `/home/admin/`. If a command or script references `/root/clipper-company`, replace with `/home/admin/clipper-company`. The `clipper.sh` launcher script and all Python code in this environment use `/home/admin/` paths. Verify with `ls /home/admin/clipper-company` before running anything.
2. **Video ID belum di queue** → Add ke state.json dulu dengan format yang benar
2. **Face detection fails** → Fallback ke center crop
3. **No Indonesian subtitle** → Skip subtitle burning, tidak ada error
8. **VPS HTTP server down (port 9090)** → CRITICAL: Repliz needs this to fetch clips. Before posting, check `ss -tlnp | grep 9090` on VPS. If not running, start with `ssh root@43.134.83.2 "cd /var/www/clipper-dashboard/clips && nohup python3 -m http.server 9090 --bind 0.0.0.0 > /tmp/http.log 2>&1 &"`. Port 8080 serves retrodaya website, NOT clips.
5. **Repliz 401 Unauthorized** → Recreate AUTH header (base64 encode lagi)
6. **Clip already posted** → Track in state.json, skip bila last_posted_index >= N
7. **SVT AV1 direct crop = corrupt clips** → ALWAYS use `-vf "scale=1920:1080,crop=1920:1080"`. Direct `crop=1920:1080:x:y` fails silently with `[vf#0:0] Task finished with error code: -22 (Invalid argument)` producing corrupt 48-byte files or clips with "moov atom not found" on ffprobe. The scale-then-crop pattern avoids this. Verified on Clipper Company VPS encoding pipeline.
8. **Corrupt clip detection** → After encoding, verify ALL clips with `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 <file>`. Clips under 120s duration OR showing "moov atom not found" are corrupt. Corrupt clips are typically 0–262KB. Fix: re-encode at same timestamp with the scale+crop workaround. Example repair:
```bash
ffmpeg -y -ss <START> -t 120 -i /root/clipper-company/downloads/{VIDEO_ID}.mp4 \
 -vf "scale=1920:1080,crop=1920:1080" \
 -c:v libsvtav1 -crf 30 -c:a aac -b:a 128k -movflags +faststart \
 /root/clipper-company/clips/{VIDEO_ID}/processed/clip_XXX.mp4
```
9. **Encoding speed** → SVT AV1 @ CRF 30, preset 6, on this VPS encodes ~2 minutes per 120-second clip (≈0.8x realtime). Batch 20 clips takes ~40 minutes. Use `notify_on_complete=true` for background encoding so terminal doesn't timeout. Clip sizes: 19–37MB per clip (avg ~27MB). Total 20 clips ≈ 550MB.
10. **Python cv2 path** — cv2 is NOT at `/usr/bin/python3`. The correct Python with OpenCV is `/home/admin/.local/share/uv/tools/browser-act-cli/bin/python3`. Use this for all OpenCV operations. The `clipper.sh` launcher script handles this automatically when calling process_clips.py. When calling python3 directly from terminal, default is the Hermes venv Python which does NOT have cv2.
8. **Caption generic gaming** → Selalu detect topik actual video, jangan default gaming
9. **Hermes Telegram tidak merespons → CEK GATEWAY DAHULU** — symptom: bot dapat pesan (getUpdates shows messages), token valid, config benar, tapi tidak ada reply. Penyebab TERBAIK: `hermes gateway` tidak running. Verifikasi: `hermes gateway status` — kalau NOT running, start dengan `hermes gateway run` (foreground) atau `hermes gateway install && hermes gateway start` (background). gateway.log terakhir dari jam berapa? Jika sebelum waktu chat terakhir → gateway crash/stop. Ini adalah penyebab #1 paling sering terlewat.
10. **VPS port 9090 HTTP server DOWN → Repliz cannot fetch clips** — CRITICAL: Port 9090 on VPS (43.134.83.2) must be running for Repliz to access video clips. Repliz posts return 201 but videos don't appear on platforms because the media URL is unreachable. Before posting, verify server is running:
  ```bash
  ssh root@43.134.83.2 "ss -tlnp | grep 9090"
  ```
  If not running, start with:
  ```bash
  ssh root@43.134.83.2 "cd /var/www/clipper-dashboard/clips && nohup python3 -m http.server 9090 --bind 0.0.0.0 > /tmp/http.log 2>&1 &"
  ```
  Note: Port 8080 serves the retrodaya website, NOT clips. Clips directory is `/var/www/clipper-dashboard/clips/`.
11. **yt-dlp essential flag** — `--extractor-args "youtube:player_client=web"` is REQUIRED for reliable YouTube downloads on this VPS. Without it, downloads may fail or use suboptimal formats. Always include this flag. Tested May 2026, all alternatives (gallery-dl, youtube-dl, Invidious) failed.

12. **Repliz text-only posts: DOES NOT WORK** — Repliz API only accepts video/media posts. Text-only posts return 500 "Cannot read properties of undefined (reading '0')". Link posts return 400 "meta should not be empty". For article/text content: either (a) create video clip first via Clipper workflow, or (b) use direct platform APIs.

---

## File Structure
```
/home/admin/clipper-company/
 downloads/     - Raw video + subtitles
 clips/
  {VIDEO_ID}/   - 20 raw clips
  processed/    - 20 processed clips (face crop, subtitle)
 state.json     - Workflow state tracking
 social-automation/
  repliz-auto-poster.py
 scripts/
  download_video.py - YouTube downloader (yt-dlp)
  process_clips.py - Face-cut + encode 20 clips
 clipper.sh     - Launcher (handles dual-python env)
```

**IMPORTANT**: Working directory is `/home/admin/clipper-company`, NOT `/root/clipper-company`. All scripts and Python code reference the `/home/admin/` path.

---

## Verification Steps
1. Download: `ls -lah downloads/` → file exists, size > 0
2. Clips: `ls clips/{VIDEO_ID}/processed/ | wc -l` → 20 (minimal 18 acceptable)
3. Quick verify: `python3 references/verify_clips.py {VIDEO_ID}` — catches missing + corrupt clips
4. Topic detected: print topic category + confidence
5. Caption generated: sesuai topik video (confirm bukan generic)
6. VPS: `curl -I http://43.134.83.2:9090/clip_001.mp4` → 200
7. Repliz: POST /public/schedule → 201 Created
8. Cleanup: `find downloads/ -mtime +0` → empty or recent only
