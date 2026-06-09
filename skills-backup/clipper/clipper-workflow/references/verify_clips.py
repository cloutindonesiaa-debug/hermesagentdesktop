#!/usr/bin/env python3
"""Verified clip integrity checker for clipper-workflow.
Checks all 20 clips for missing files and corrupt encoding.
Usage: python3 verify_clips.py {VIDEO_ID}"""
import subprocess, os, sys

def verify_clip(video_id, clip_num):
    path = f"/root/clipper-company/clips/{video_id}/processed/clip_{clip_num:03d}.mp4"
    if not os.path.exists(path):
        return "MISSING", 0
    size = os.path.getsize(path)
    if size < 1_000_000:
        return "CORRUPT", size
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", path],
        capture_output=True, text=True
    )
    if r.returncode != 0 or not r.stdout.strip():
        return "CORRUPT", size
    dur = float(r.stdout.strip())
    if dur < 60:  # 120s clips should be ~120s
        return "CORRUPT", size
    return "OK", size

def main():
    if len(sys.argv) < 2:
        video_id = "WkhP_5oOgpw"  # default
    else:
        video_id = sys.argv[1]

    results = []
    for i in range(1, 21):
        status, size = verify_clip(video_id, i)
        results.append((i, status, size))
        marker = "✅" if status == "OK" else "❌"
        print(f"{marker} clip_{i:03d} | {size//1024//1024}MB | {status}")

    corrupt = sum(1 for _, s, _ in results if s != "OK")
    print(f"\n{'ALL OK' if corrupt==0 else f'{corrupt} CORRUPT'}")
    return corrupt

if __name__ == "__main__":
    sys.exit(main())