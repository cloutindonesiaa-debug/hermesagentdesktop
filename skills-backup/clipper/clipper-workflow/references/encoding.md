# Encoding Reference — Clipper Company Pipeline

## Verified Working Encoding Command

```bash
ffmpeg -y -ss <START_SEC> -t 120 \
  -i /root/clipper-company/downloads/{VIDEO_ID}.mp4 \
  -vf "scale=1920:1080,crop=1920:1080" \
  -c:v libsvtav1 -crf 30 \
  -c:a aac -b:a 128k \
  -movflags +faststart \
  /root/clipper-company/clips/{VIDEO_ID}/processed/clip_{NUM:03d}.mp4
```

**Why scale+crop instead of direct crop:** Direct `crop=1920:1080:x:y` causes SVT AV1 encoder to fail with `[vf#0:0] Task finished with error code: -22 (Invalid argument)`. Output is corrupt (48 bytes or "moov atom not found"). The scale-first-then-crop pattern avoids the encoder issue.

## Batch Encoding Strategy

Clip timestamps (2-min clips, 96s overlap — i.e., 24s overlap since clip_dur=120, overlap=24):
```
clip_001: 0–120s     (i=0, start=0)
clip_002: 96–216s    (i=1, start=96)
clip_003: 192–312s   (i=2, start=192)
clip_004: 288–408s   (i=3, start=288)
...
clip_020: 1440–1560s (i=19, start=1824 — but video is ~3076s so this is fine)
```

Formula: `start = i * (clip_dur - overlap)` where `clip_dur=120, overlap=24`

## Corrupt Clip Patterns

**Symptom:** `ffprobe <file>` returns "moov atom not found" or duration < 110s.

**Common corrupt sizes:**
- 0 bytes (completely empty)
- 48 bytes (SVT header only, no video data)
- 262,192 bytes (partial write, truncated)

**Non-corrupt sizes:** 19–37MB for 120s clips.

## Repair Workflow

1. Identify corrupt clips: `for i in $(seq -w 1 20); do f="processed/clip_0${i}.mp4"; s=$(stat -c%s "$f"); [ $s -lt 1000000 ] && echo "CORRUPT: $i ($s bytes)"; done`

2. For each corrupt clip, re-encode with same command + same timestamp.

3. Verify: `ffprobe -v error -show_entries format=duration,size -of default=noprint_wrappers=1 <file>` — should show ~120s duration.

## Encoding Timing (Benchmarked)

- SVT AV1 CRF 30, preset 6: ~2 minutes per 120-second clip (≈0.8x realtime)
- Speed varies by timestamp position in video (earlier = faster, later = slower due to scene complexity)
- Clip sizes: 19MB (simple) to 37MB (complex/scene-heavy)
- Total 20 clips ≈ 550MB encoded output

## Face Detection

Using OpenCV Haar cascade from system Python (NOT Hermes venv):
```bash
/usr/bin/python3 -c "
import cv2
cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
faces = cascade.detectMultiScale(gray, 1.3, 5)
"
```

Face detection runs per-clip at start timestamp. If no face found, center crop is used.

## Python Path Note

The Hermes agent execute_code tool uses venv Python (`/usr/local/lib/hermes-agent/venv/bin/python3`) which does NOT have cv2. Use `/usr/bin/python3` for OpenCV operations via terminal or subprocess.