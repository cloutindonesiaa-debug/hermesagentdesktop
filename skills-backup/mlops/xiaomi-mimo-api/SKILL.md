---
name: xiaomi-mimo-api
description: Xiaomi MiMo LLM API integration — endpoint, auth, OpenAI-compatible format, TTS fallback. Use when building apps or scripts that call Xiaomi MiMo models.
---

# Xiaomi MiMo API

Xiaomi MiMo provides an **OpenAI-compatible** chat completions API.

## Endpoint

| Item | Value |
|------|-------|
| Base URL | `https://token-plan-sgp.xiaomimimo.com/v1` |
| Chat | `{base_url}/chat/completions` |
| Auth | `Authorization: Bearer {key}` |
| Env var | `XIAOMI_API_KEY` |
| Model | `mimo-v2.5-pro` |

## Request format

Identical to OpenAI chat completions:

```python
requests.post(
    f'{base_url}/chat/completions',
    headers={
        'Authorization': f'Bearer {api_key}',
        'Content-Type': 'application/json'
    },
    json={
        'model': 'mimo-v2.5-pro',
        'messages': messages,
        'max_tokens': 1500,
        'temperature': 0.7
    },
    timeout=60
)
```

Response shape: `result['choices'][0]['message']['content']` — same as OpenAI.

## Capabilities & limitations

- **Text generation**: ✅ Full chat completions
- **Image generation**: ❌ No DALL-E equivalent — use separate image API (DALL-E, Stability, etc.) or skip
- **TTS**: ❌ No TTS endpoint — use browser Speech Synthesis API as fallback
- **Function calling**: Unknown — test before relying on it

## Pitfalls

1. **API key location**: Hermes stores the key in `auth.json` under `credential_pool.xiaomi[].source = "env:XIAOMI_API_KEY"`. The actual key lives in the system environment, NOT in `.env` files by default. When building standalone apps, explicitly copy the key into the app's `.env`.

2. **No image gen endpoint**: Don't try to call `/images/generations` — it doesn't exist. If the app needs image generation, use a separate provider or the `image_gen` Hermes toolset.

3. **TTS fallback**: Since Xiaomi has no TTS API, use the browser's built-in `SpeechSynthesis` API. Set `utterance.lang` to match the user's language (`id-ID` for Indonesian, `en-US` for English).

## Flask app integration pattern

When building a Flask app that uses Xiaomi MiMo:

```python
# server.py
XIAOMI_API_KEY = os.getenv('XIAOMI_API_KEY', '')
XIAOMI_BASE_URL = os.getenv('XIAOMI_BASE_URL', 'https://token-plan-sgp.xiaomimimo.com/v1')
XIAOMI_MODEL = os.getenv('XIAOMI_MODEL', 'mimo-v2.5-pro')

# Accept key from frontend settings via header (fallback to env)
api_key = request.headers.get('X-API-Key') or XIAOMI_API_KEY
```

Frontend sends key as custom header:
```javascript
fetch('/api/chat', {
    headers: { 'X-API-Key': settings.apiKey || '' }
});
```

## References

- See `references/jarvis-build-notes.md` for full Jarvis voice-assistant build session notes.
