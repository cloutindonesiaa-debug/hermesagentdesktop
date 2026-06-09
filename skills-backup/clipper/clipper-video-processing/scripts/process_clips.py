#!/usr/bin/env python3
"""
Clip Processor — Clipper Company
Dynamic face-cut + Indonesian subtitle (font size 15)

Usage:
  cd /root/clipper-company
  python3 process_clips.py [start_clip]

Resume from clip 5+ by passing the clip number.
"""

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
        x, y, w, h = max(faces, key=lambda f: f[2]*f[3])
        return (x + w//2, y + h//2, frame.shape[1], frame.shape[0])
    return None

def process_clip(video_in, output, clip_id, start_time, duration):
    """Encode one clip with dynamic face-cut crop. No subtitle (Indonesian unavailable)."""
    
    face = get_face_bbox(video_in, start_time)
    if face:
        cx, cy, fw, fh = face
        cw, ch = 1920, 1080
        cx = max(cw//2, min(fw - cw//2, cx))
        cy = max(ch//2, min(fh - ch//2, cy))
        crop = f"crop={cw}:{ch}:{max(0, cx - cw//2)}:{max(0, cy - ch//2)}"
    else:
        crop = "crop=1920:1080:0:0"
    
    print(f"clip_{clip_id:03d}...", end=" ", flush=True)
    r = subprocess.run([
        'ffmpeg', '-y',
        '-ss', str(start_time), '-t', str(duration),
        '-i', video_in,
        '-vf', crop,
        '-c:v', 'libsvtav1', '-crf', '30',
        '-c:a', 'aac', '-b:a', '128k',
        '-movflags', '+faststart',
        output
    ], capture_output=True, text=True)
    
    if r.returncode == 0:
        sz = os.path.getsize(output) / 1024 / 1024
        print(f"OK ({sz:.1f}MB)")
        return True
    else:
        print(f"FAILED: {r.stderr[-200:]}")
        return False

def main():
    import sys
    base = Path("/root/clipper-company")
    out_dir = base / "clips" / "y4lLLx8_gOw" / "processed"
    out_dir.mkdir(exist_ok=True)
    
    inp = str(base / "downloads" / "y4lLLx8_gOw.webm")
    
    start_clip = int(sys.argv[1]) if len(sys.argv) > 1 else 1
    clip_dur = 120  # 2 min
    overlap = 24    # 24s overlap
    total = 2880   # 48 min
    
    cur = (start_clip - 1) * (clip_dur - overlap)
    for cid in range(start_clip, 21):
        et = min(cur + clip_dur, total)
        out = str(out_dir / f"clip_{cid:03d}.mp4")
        
        success = process_clip(inp, out, cid, cur, et - cur)
        
        if not success:
            print(f"⚠️  Stopping at clip_{cid:03d} (failure)")
            break
        
        cur += clip_dur - overlap
    
    clips_done = cid - start_clip + (1 if success else 0)
    print(f"\n✅ Done! {clips_done} clips processed → {out_dir}")

if __name__ == "__main__":
    main()