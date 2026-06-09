# Clipper Company — Environment Reference

## Dual-Python Environment

This VPS has TWO Python installations:
- **Hermes venv Python**: `/home/admin/.venvs/camoufox/bin/python3` — NO cv2, NO yt_dlp module
- **Browser-act Python**: `/home/admin/.local/share/uv/tools/browser-act-cli/bin/python3` — HAS cv2 4.13.0

When scripts need cv2, use the browser-act Python:
```bash
/home/admin/.local/share/uv/tools/browser-act-cli/bin/python3 process_clips.py <video_id>
```

## Tool Paths (Confirmed Working)
- yt-dlp CLI: `/home/admin/.local/bin/yt-dlp` (NOT as Python module)
- ffmpeg: `/usr/bin/ffmpeg`
- sshpass: `/usr/bin/sshpass`
- OpenCV: browser-act Python only

## State File
`/home/admin/clipper-company/state.json` — config + video queue

## VPS Paths
- VPS IP: `43.134.83.2`
- SSH port: `2222`
- SSH user: `root`
- Clips dir on VPS: `/var/www/clipper-dashboard/clips/`
- HTTP port for clips: `9090` (NOT 8080 — 8080 serves retrodaya website)
