#!/usr/bin/env python3
"""
Clip Processor: Dynamic face-cut, no subtitle (Indonesian unavailable)
Font: DejaVu Sans, size 15 (prepared for subtitle when available)
Face detection via OpenCV Haar cascade

Usage:
    python3 process_clips.py  # processes all 20 clips in background
    python3 - << 'EOF'  # inline mode for specific clips
"""

import cv2
import subprocess
import os
from pathlib import Path

def get_face_bbox(video_path, timestamp):
    """Detect face at timestamp, return (cx, cy, frame_w, frame_h) or None"""
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

def process_clip(input_video, output_video, clip_id, start_time, end_time):
    duration = end_time - start_time
    
    face = get_face_bbox(input_video, start_time)
    if face:
        cx, cy, fw, fh = face
        cw, ch = 1920, 1080
        cx = max(cw//2, min(fw - cw//2, cx))
        cy = max(ch//2, min(fh - ch//2, cy))
        x1 = max(0, cx - cw//2)
        y1 = max(0, cy - ch//2)
        crop_str = f"crop={cw}:{ch}:{x1}:{y1}"
    else:
        crop_str = "crop=1920:1080:0:0"
    
    cmd = [
        'ffmpeg', '-y',
        '-ss', str(start_time), '-t', str(duration),
        '-i', input_video,
        '-vf', crop_str,
        '-c:v', 'libsvtav1', '-crf', '30',  # NOTE: no -preset flag for libsvtav1
        '-c:a', 'aac', '-b:a', '128k',
        '-movflags', '+faststart',
        output_video
    ]
    
    print(f"clip_{clip_id:03d}...", end=" ", flush=True)
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print(f"FAILED")
        print(r.stderr[-200:])
        return False
    
    sz = os.path.getsize(output_video) / 1024 / 1024
    print(f"OK ({sz:.1f}MB)")
    return True

def main():
    base = Path("/root/clipper-company")
    out_dir = base / "clips" / "y4lLLx8_gOw" / "processed"
    out_dir.mkdir(exist_ok=True)
    
    inp = str(base / "downloads" / "y4lLLx8_gOw.webm")
    
    clip_dur = 120  # 2 min
    overlap = 24   # 24s overlap
    total = 2880   # 48 min
    
    cur = 0
    cid = 1
    while cid <= 20 and cur < total:
        et = min(cur + clip_dur, total)
        out = str(out_dir / f"clip_{cid:03d}.mp4")
        process_clip(inp, out, cid, cur, et)
        cur += clip_dur - overlap
        cid += 1
    
    print(f"\n✅ Selesai! {cid-1} clips → {out_dir}")

if __name__ == "__main__":
    main()