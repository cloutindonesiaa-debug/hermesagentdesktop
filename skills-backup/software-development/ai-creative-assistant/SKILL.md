---
name: ai-creative-assistant
description: Build AI-powered creative tool web apps — voice assistants, UGC creators, affiliate video generators, ad makers. Flask backend + single-page HTML frontend. Use when user shows a reference of an AI tool and wants similar built, or asks for a creative workflow app.
triggers:
  - user shows video or screenshot of AI assistant and asks to build similar
  - build like this with AI assistant reference
  - voice-controlled AI tool request
  - voice in ads out type creative workflow
  - AI assistant with TTS and image generation
  - AI UGC creator, affiliate video generator, content creator workflow
  - product scraping tool, e-commerce automation web app
  - multi-step wizard SPA, step-by-step workflow builder
  - video composition tool, FFmpeg-based video generator
---

# AI Creative Tool Builder

Build full-stack AI creative tools: voice assistants, UGC creators, affiliate video generators, ad makers. Flask backend + single-page HTML frontend.

Two architecture patterns — pick based on task:
1. **Chat-based** (JARVIS pattern): conversational UI, voice I/O, canvas output
2. **Multi-step wizard** (UGC Creator pattern): step-by-step pipeline with progress stepper, state management, and batch processing

## Architecture

```
jarvis/
├── server.py          # Flask backend (API proxy to OpenAI)
├── templates/
│   └── index.html     # Single-page app (embedded CSS/JS)
├── static/
│   └── audio/         # Generated TTS audio files
├── generated_ads/     # Generated images
├── requirements.txt   # flask, flask-cors, python-dotenv, requests
├── .env.example       # API key template
├── start.bat          # Windows launcher
└── start.sh           # Linux/Mac launcher
```

## Key Components

### 1. Voice Input (Web Speech API)
- Built into Chrome, no API key needed
- `recognition.lang = 'id-ID'` for Indonesian, `'en-US'` for English
- Support interim results for real-time transcript display
- Always provide fallback text input

### 2. AI Brain (OpenAI Chat Completions)
- Proxy API calls through Flask backend (never expose API key in frontend)
- Keep conversation history in memory (last 20 messages)
- System prompt should instruct AI to return JSON blocks for image generation:
  ```json
  {"generate_image": true, "prompt": "...", "style": "vivid", "size": "1024x1024"}
  ```
- Parse JSON from response, strip it from displayed message

### 3. TTS Output (OpenAI TTS API)
- Save audio files to `static/audio/` directory
- Serve via Flask static route
- Fallback to browser `speechSynthesis` if API fails
- Limit input text to 4096 chars (API limit)

### 4. Image Generation (DALL-E 3)
- Use `quality: "hd"` for best results
- Support styles: `vivid` (creative) / `natural` (realistic)
- Support sizes: `1024x1024`, `1792x1024`, `1024x1792`
- Save generated images to `generated_ads/` directory

### 5. Settings (localStorage)
- Store API key, model, voice, style, size in browser localStorage
- Settings modal with form inputs
- Load settings on page init

## Support Files

- `references/dark-ui-design.md` — CSS color scheme, font stacks, animation patterns
- `references/openai-api-patterns.md` — Chat completions, JSON extraction, streaming
- `references/web-speech-api.md` — Voice recognition setup, language codes
- `references/product-scraping.md` — Marketplace URL scraping: OpenGraph → JSON-LD → per-site regex (Tokopedia, Shopee)
- `references/video-composition-ffmpeg-pil.md` — FFmpeg+PIL frame-by-frame video pipeline: layout, animations, assembly

## UI Design Pattern

Dark futuristic theme with:
- **Orb animation**: Animated rings + glowing core as visual centerpiece
- **Two-panel layout**: Chat (left) + Canvas/Gallery (right)
- **Tab system**: JARVIS assistant view + Gallery view
- **Voice mode overlay**: Full-screen with large orb when listening
- **Quick actions**: Preset prompts as clickable chips

### Color Scheme
```css
--primary: #00d4ff;      /* Cyan */
--accent: #ff6b35;       /* Orange */
--bg-dark: #0a0a0f;      /* Near black */
--bg-card: rgba(15, 20, 35, 0.85);
```

### Fonts
- Orbitron (headings, logo)
- Rajdhani (body text)
- Inter (secondary)

## Multi-Step Wizard Architecture (Pattern 2)

For tools with a pipeline flow (upload → process → generate → output):

```
project/
├── server.py              # Flask backend with pipeline APIs
├── templates/
│   └── index.html         # Single-page wizard SPA
├── static/
│   ├── uploads/           # User uploads
│   ├── avatars/           # Processed assets
│   ├── products/          # Scraped product images
│   ├── outputs/           # Generated videos/images
│   └── frames/            # Temp frame renders (cleanup after)
├── requirements.txt
└── start.bat
```

### Frontend: Step-by-Step Wizard

- **Stepper nav**: Numbered tabs (1. Avatar, 2. Product, 3. Script, 4. Generate, 5. Output)
- **Step validation**: Block forward navigation until step prerequisites met (`btnToStepN.disabled = true` until data ready)
- **State object**: Single `state = { currentStep, avatarPath, product, script, projectId }` — all steps read/write from it
- **Progress animation**: Fake progress bar during async processing (random increments, status text changes)
- **Polling pattern**: After POST to start job, poll `GET /api/project/<id>` every 2-3s until `status: "done"` or `"error"`
- **Two-column layout**: Left = input form, Right = preview/summary card

### Backend: Background Processing

```python
# Process video in background thread (don't block request)
def process_video():
    result = compose_video_ffmpeg(project)
    project["status"] = "done" if "error" not in result else "error"
    project["output"] = result

thread = threading.Thread(target=process_video)
thread.daemon = True
thread.start()
return jsonify({"project_id": project_id, "status": "processing"})
```

In-memory dict for project store is fine for single-user tools. Add SQLite if multi-user.

## Product Scraping Pattern

Scrape product info from marketplace URLs — works for Tokopedia, Shopee, Lazada, and generic sites.

**Extraction cascade** (try in order, stop when data found):
1. **OpenGraph meta tags**: `og:title`, `og:description`, `og:image` — works for ~80% of sites
2. **JSON-LD structured data**: `<script type="application/ld+json">` with `@type: "Product"` — gives name, price, image, brand, rating
3. **Marketplace-specific regex**: Search `<script>` tags for known field patterns
4. **Fallback**: `<title>` tag for name

**Product image download**: After extracting `og:image` URL, download to `static/products/` and save both the remote URL and local path. Use local path for video composition (avoids CORS/hotlink issues).

See `references/product-scraping.md` for full extraction code patterns per marketplace.

## Video Composition Pipeline (FFmpeg + PIL)

For generating UGC-style vertical videos (9:16, 1080×1920):

### Frame Generation with PIL

```python
W, H = 1080, 1920
for scene_idx, scene in enumerate(scenes):
    for frame_idx in range(fps * seconds_per_scene):
        img = Image.new("RGB", (W, H))
        draw = ImageDraw.Draw(img)
        
        # 1. Background gradient
        draw_gradient(draw, W, H, (10,10,30), (25,10,40))
        
        # 2. Avatar (circular mask + glow)
        # 3. Product image (centered, with border)
        # 4. Product info text (name, price with colored bg)
        # 5. Script text (animated character-by-character reveal)
        # 6. CTA button (pulsing animation, appears late in scene)
        # 7. Watermark
        
        img.save(f"frame_{scene_idx}_{frame_idx:04d}.png")
```

### FFmpeg Assembly

```bash
# Concat frames → MP4
ffmpeg -y -f concat -safe 0 -i frames.txt \
  -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2" \
  -c:v libx264 -preset fast -crf 23 -pix_fmt yuv420p -r 30 output.mp4
```

**frames.txt format** (one entry per frame):
```
file 'frame_000_0000.png'
duration 0.033333
file 'frame_000_0001.png'
duration 0.033333
```

### Animation Techniques

- **Text reveal**: Count chars revealed = `len(text) * min(1.0, frame_idx / (fps * 2))` — 2-second reveal per scene
- **CTA pulse**: `int(10 * abs((frame_idx % 20) - 10) / 10)` for color oscillation
- **Glow effect**: Draw large semi-transparent ellipse behind avatar, blend with gradient overlay
- **Circular avatar mask**: `Image.new("L", (400,400), 0)` + `draw.ellipse` → `putalpha(mask)`

### Pitfalls

- **Frame cleanup**: Always `shutil.rmtree(frames_dir)` after FFmpeg runs — 4 scenes × 120 frames = 480 PNG files
- **Font fallback**: Try `segoeui.ttf` → `arial.ttf` → `calibri.ttf` → `ImageFont.load_default()`
- **FFmpeg not found**: Check with `ffmpeg -version` before starting. Fail gracefully with install instructions.
- **Video too long**: Cap scenes or reduce `seconds_per_scene` — 4s per scene × 6 scenes = 24s is good for TikTok

## Graceful Degradation Pattern

When AI API key isn't available, provide a **template-based fallback** that still produces usable output:

```python
def mimo_chat(system_prompt, user_prompt, temperature=0.8):
    if not MIMO_API_KEY:
        return _generate_template_script(user_prompt)  # Smart template
    # ... actual API call ...
    except Exception as e:
        return _generate_template_script(user_prompt)  # Fallback on error too
```

Template extracts data from the prompt itself (product name, price, description) and produces a structured script. User can always edit the result. This keeps the tool usable even without API keys configured.

## Pitfalls

1. **API key exposure**: NEVER put API keys in frontend JS. Always proxy through backend.
2. **JSON in AI response**: AI returns JSON blocks for structured output. Must parse AND strip from display.
3. **TTS text length**: OpenAI TTS has 4096 char limit. Truncate before sending.
4. **Voice recognition language**: Default to user's language. Indonesian users expect `id-ID`.
5. **Settings persistence**: Use localStorage, not sessionStorage, so settings survive page reload.
6. **Audio autoplay**: Browsers block autoplay. TTS audio must be triggered by user interaction.
7. **Image generation timeout**: DALL-E can take 30-60s. Show loading state, don't block UI.
8. **Port 5000 conflicts on Windows**: Port 5000 is commonly occupied by other Flask apps or Windows services. Use port 5050 or check `netstat -ano | grep ":5000"` first.
9. **Frame file explosion**: FFmpeg concat mode creates one file per frame. Always cleanup temp frame directory after video assembly.
10. **Product image CORS**: Download product images to local `static/products/` instead of hotlinking — avoids CORS and expired-URL issues in video composition.

## Deployment Notes

- Single command startup: `python server.py`
- Windows: double-click `start.bat`
- Default port: **5050** (5000 commonly conflicts)
- Requires: Python 3.8+, API key for AI features (optional — template fallback available)
- FFmpeg required for video generation: `ffmpeg -version` to check
- No database needed (in-memory state for single-user tools)
