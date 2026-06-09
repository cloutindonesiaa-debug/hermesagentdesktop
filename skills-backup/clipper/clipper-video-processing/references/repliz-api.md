# Repliz API Reference

**Base URL:** `https://api.repliz.com`
**Auth:** Basic Auth — `base64(access_key:secret_key)`

## Auth Header Construction

```python
import base64, requests

ACCESS_KEY = os.getenv("REPLIZ_ACCESS_KEY")
SECRET_KEY = os.getenv("REPLIZ_SECRET_KEY")

creds = f"{ACCESS_KEY}:{SECRET_KEY}"
encoded = base64.b64encode(creds.encode()).decode()
headers = {
    "Authorization": f"Basic {encoded}",
    "Content-Type": "application/json"
}
```

## Known Endpoints

### Account
- `GET /public/account` — account info (returns 401 if unauthorized)
- `GET /account` — (returns 401)

### Content
- `GET /public/content?accountId={id}&page=1&limit=20` — list content from account

### Scheduling
- `GET /public/schedule?accountIds={ids}&status=pending&page=1&limit=50` — list scheduled posts
- `POST /public/schedule` — schedule a post

### Chat
- `GET /public/chat?accountIds={ids}&status=unread&page=1&limit=20` — conversations

### Other
- `GET /public/link/metadata` (POST) — URL metadata for link previews
- `GET /public/content/{content_id}/comment?accountId={id}` — comments

## Known Account IDs (Clipper Company)

| Platform | Username | Account ID |
|----------|----------|------------|
| YouTube | @sosokberbicara | `6a123e004492e5f5a8f83ded` |
| TikTok | @sosokbicaraclip | `6a119ad84492e5f8f82fe4` |
| Threads | @eric_ai_traderfx | `69fd8b28877ca2e454040e50` |

## Post Scheduling Format

```python
{
    "accountId": "6a123e004492e5f5a8f83ded",
    "title": "Clip Title",
    "description": "Caption with hashtags...",
    "scheduledAt": "2026-05-25T15:00:00Z",  # ISO 8601 UTC
    "medias": [{"url": "https://cdn.url/video.mp4"}]
}
```

## Troubleshooting

### 401 Unauthorized
- Verify access key and secret key are correct and complete
- Secret key may have been truncated when shared in chat
- Check Repliz dashboard at https://app.repliz.com → Settings → API Keys
- Keys may need to be regenerated if they appear incomplete

### Endpoints returning 404
- Repliz API structure may differ from documented `/public/*` paths
- Check actual API documentation in Repliz dashboard
- May need to try different base paths or authentication schemes

## Files on VPS

- `/root/clipper-company/social-automation/repliz-agent.py` — Python wrapper with helper functions
- `/root/clipper-company/social-automation/repliz-poster.sh` — shell poster
- `/root/clipper-company/social-automation/scheduler.sh` — scheduling logic