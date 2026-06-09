---
name: voice-ai-assistant
description: Build voice-controlled AI assistants — Flask backend + Web Speech API frontend + configurable LLM provider. Voice-in, text-out with optional TTS.
triggers:
  - voice assistant
  - voice-controlled AI
  - speech-to-text AI app
  - Jarvis-like system
  - voice interface for LLM
  - ngomong ke AI
---

# Voice AI Assistant

Build a full-stack voice-controlled AI assistant with:
- **Backend**: Python Flask serving API + static files
- **Frontend**: HTML/CSS/JS with futuristic dark UI
- **Voice Input**: Web Speech API (browser built-in, free)
- **Voice Output**: Browser SpeechSynthesis API (free) or provider TTS
- **LLM Brain**: Any OpenAI-compatible API (Xiaomi MiMo, MiniMax, OpenAI, etc.)

## Architecture

```
Browser (mic → Speech API → text) 
  → POST /api/chat (with X-API-Key header)
  → Flask backend → LLM API
  → response text
  → Browser (SpeechSynthesis TTS or API TTS)
```

## Step-by-step

### 1. Project structure
```
project/
├── server.py              # Flask backend
├── templates/index.html   # Full UI (single file, embedded CSS/JS)
├── static/audio/          # TTS audio cache (if using API TTS)
├── .env                   # API keys
├── .env.example           # Template
├── requirements.txt       # flask, flask-cors, python-dotenv, requests
├── start.bat              # Windows launcher
└── start.sh               # Linux/Mac launcher
```

### 2. Backend (server.py)
- Use `flask` + `flask-cors` + `python-dotenv`
- Read provider config from env: `BASE_URL`, `API_KEY`, `MODEL`
- Accept API key from **header** `X-API-Key` (for frontend Settings UI) OR from env
- Single `/api/chat` endpoint that proxies to LLM
- `/api/status` for health check

### 3. Frontend (index.html)
- Dark futuristic theme (Orbitron + Rajdhani fonts)
- Animated orb/circle as visual feedback
- Chat interface with message history
- Settings modal for API key + voice config
- Quick action buttons for common prompts

### 4. Voice Input (Web Speech API)
```javascript
const recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
recognition.lang = 'id-ID'; // or 'en-US'
recognition.continuous = false;
recognition.interimResults = true; // show live transcript
recognition.onresult = (event) => { /* handle transcript */ };
```

### 5. Voice Output (Browser TTS — FREE, no API)
```javascript
function speakText(text) {
    speechSynthesis.cancel(); // stop any ongoing speech
    const utterance = new SpeechSynthesisUtterance(text.substring(0, 500));
    utterance.lang = 'id-ID'; // match user language
    utterance.rate = 1;
    speechSynthesis.speak(utterance);
}
```

## Pitfalls

### Multiple stale servers on Windows
When restarting Flask dev server, old processes may still hold the port. Fix:
```bash
netstat -ano | grep ":5000.*LISTENING" | awk '{print $5}' | sort -u | while read pid; do
  taskkill //F //PID $pid
done
```
Always kill ALL processes on the port before restart, not just the latest one.

### read_file line numbers corrupt files
The `read_file` tool returns `N|content` format. If you pipe this back to `write_file`, the line numbers become part of the file content. **Always strip line numbers** before writing, or use `patch` for targeted edits.

### API key from frontend vs env
Don't require `.env` file when user sets key via browser Settings UI. Use pattern:
```python
api_key = request.headers.get('X-API-Key') or ENV_API_KEY
```
Frontend sends key as `X-API-Key` header on every request.

### User prefers existing providers
Don't default to OpenAI. Check hermes config (`~/.hermes/auth.json`, `config.yaml`) for providers the user already has configured (Xiaomi, MiniMax, etc.) and use those instead. See `references/hermes-provider-discovery.md`.

### Browser TTS is good enough
Don't add OpenAI/ElevenLabs TTS as a dependency. Browser `SpeechSynthesis` is free, works offline, supports Indonesian, and is "good enough" for demos. Only add API TTS if user specifically requests higher quality.

## Windows launcher (start.bat)
```bat
@echo off
title J.A.R.V.I.S
if not exist venv (python -m venv venv)
call venv\Scripts\activate.bat
pip install -r requirements.txt -q
python server.py
pause
```
