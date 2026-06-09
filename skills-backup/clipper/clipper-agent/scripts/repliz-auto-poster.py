#!/usr/bin/env python3
"""
Clipper Company - Auto Poster to Repliz
Posts to YouTube @sosokberbicara + TikTok @sosokbicaraclip
3 posts/day, 5-hour intervals: 09:00, 14:00, 19:00 WIB

Usage:
    python3 repliz-auto-poster.py post      # Post 1 round to both platforms
    python3 repliz-auto-poster.py status   # Check queue status
    python3 repliz-auto-poster.py test     # Dry-run test

Setup: Install sshpass if needed:
    yum install -y sshpass
"""

import base64, json, os, sys, requests, subprocess
from datetime import datetime, timezone
from pathlib import Path

# === CONFIG ===
ACCESS_KEY = '6730837506'
SECRET_KEY = '***'  # FULL key required
BASE = 'https://api.repliz.com'
STATE_FILE = '/root/clipper-company/state.json'
CLIPS_DIR = '/root/clipper-company/clips'
VPS_HOST = '43.134.83.2'
VPS_PORT = 9090
VPS_PASS = 'gDe-pFj-dNm-UHp'

ACCOUNTS = {
    'youtube': '6a123e004492e5f5a8f83ded',   # @sosokberbicara
    'tiktok':  '6a119ad84492e5f5a8f82fe4',   # @sosokbicaraclip
}
# ==============

def get_auth():
    creds = f"{ACCESS_KEY}:{SECRET_KEY}"
    encoded = base64.b64encode(creds.encode()).decode()
    return {'Authorization': f'Basic {encoded}', 'Content-Type': 'application/json'}

def get_vps_url(filename):
    return f"http://{VPS_HOST}:{VPS_PORT}/{filename}"

def ensure_vps_server():
    """Ensure HTTP server is running on VPS port 9090"""
    check = subprocess.run(['sshpass', '-p', VPS_PASS, 'ssh', '-o', 'StrictHostKeyChecking=no',
        f'root@{VPS_HOST}', "pgrep -f 'http.server 9090'"], capture_output=True, text=True, timeout=10)
    if check.stdout.strip():
        return True
    subprocess.run(['sshpass', '-p', VPS_PASS, 'ssh', '-o', 'StrictHostKeyChecking=no',
        f'root@{VPS_HOST}',
        "mkdir -p /var/www/clipper-dashboard/clips && "
        "nohup python3 -m http.server 9090 > /dev/null 2>&1 &"],
        capture_output=True, timeout=10)
    return True

def upload_clip_to_vps(local_path, filename):
    """SCP clip to VPS /var/www/clipper-dashboard/clips/"""
    result = subprocess.run(
        ['sshpass', '-p', VPS_PASS, 'scp', '-o', 'StrictHostKeyChecking=no',
         local_path, f'root@{VPS_HOST}:/var/www/clipper-dashboard/clips/{filename}'],
        capture_output=True, text=True, timeout=60)
    return result.returncode == 0

def load_state():
    if Path(STATE_FILE).exists():
        with open(STATE_FILE) as f:
            return json.load(f)
    return {'clips': [], 'social_posts': []}

def save_state(state):
    with open(STATE_FILE, 'w') as f:
        json.dump(state, f, indent=2, default=str)

def get_next_clip(state):
    """Get next unposted clip (status=ready, not in social_posts)"""
    posted_ids = [p.get('clip_id') for p in state.get('social_posts', [])]
    for clip in state.get('clips', []):
        if clip.get('status') == 'ready' and clip['id'] not in posted_ids:
            return clip
    return None

def post_to_platform(account_id, description, video_url):
    """POST video to Repliz"""
    headers = get_auth()
    schedule_at = datetime.now(timezone.utc).isoformat().replace('+00:00', '000Z')
    data = {
        'accountId': account_id,
        'description': description,
        'type': 'video',
        'medias': [{'url': video_url, 'type': 'video'}],
        'scheduleAt': schedule_at
    }
    r = requests.post(BASE + '/public/schedule', headers=headers, json=data, timeout=20)
    return r.status_code, r.json()

def post_one_round():
    """Post 1 clip to BOTH YouTube and TikTok"""
    print(f"\n=== POST ROUND | {datetime.now().strftime('%Y-%m-%d %H:%M')} ===")
    
    ensure_vps_server()
    state = load_state()
    clip = get_next_clip(state)
    if not clip:
        print("No clips available to post")
        return False

    filename = Path(clip.get('file_path', '')).name
    local_path = Path(CLIPS_DIR) / filename
    if not local_path.exists():
        print(f"Clip file not found: {local_path}")
        return False

    print(f"Uploading {filename} to VPS...")
    if not upload_clip_to_vps(str(local_path), filename):
        print("Upload to VPS failed")
        return False

    video_url = get_vps_url(filename)
    caption = clip.get('caption', clip.get('title', 'Gaming highlight!'))
    hashtags = ' '.join(clip.get('hashtags', []))
    full_description = f"{caption} {hashtags}".strip()
    print(f"Video URL: {video_url}")

    results = []
    for platform, account_id in ACCOUNTS.items():
        print(f"\nPosting to {platform} ({account_id[:12]}...)...")
        status, resp = post_to_platform(account_id, full_description, video_url)
        print(f"  -> {status}: {resp}")
        if status in [200, 201]:
            results.append({'platform': platform, 'status': status, 'response': resp})
            state['social_posts'].append({
                'id': f"post_{len(state['social_posts'])+1:03d}",
                'clip_id': clip['id'],
                'platform': platform,
                'caption': full_description,
                'posted_at': datetime.utcnow().isoformat() + 'Z',
                'schedule_id': resp.get('scheduleId', '')
            })

    save_state(state)
    return len(results) > 0

def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'post'
    if cmd == 'post':
        post_one_round()
    elif cmd == 'status':
        state = load_state()
        ready = [c for c in state.get('clips', []) if c.get('status') == 'ready']
        posted = state.get('social_posts', [])
        print(f"Ready clips: {len(ready)}")
        print(f"Posted clips: {len(posted)}")
        for p in posted[-5:]:
            print(f"  {p['platform']} | {p['clip_id']} | {p.get('posted_at', '')[:10]}")
    elif cmd == 'test':
        headers = get_auth()
        r = requests.get(BASE + '/public/account', headers=headers, params={'page': 1, 'limit': 1}, timeout=10)
        print(f"Repliz auth: {r.status_code}")
        r2 = requests.get(f"http://{VPS_HOST}:{VPS_PORT}/", timeout=5)
        print(f"VPS HTTP: {r2.status_code}")

if __name__ == '__main__':
    main()