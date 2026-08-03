# AI Interview Coach

Full stack: Flask backend + a studio-console-styled frontend, served from one process.

## Structure
```
interview-coach/
├── app.py                    # Flask routes — orchestration + serves the frontend
├── config.py                 # Loads all 4 services' keys from env
├── requirements.txt
├── .env.example               # Copy to .env and fill in real keys
├── services/
│   ├── vision_service.py      # Resume/JD OCR
│   ├── search_service.py      # RAG index + retrieval
│   ├── speech_service.py      # STT + TTS
│   └── agent.py               # OpenAI function-calling loop (the "agent")
└── frontend/
    ├── index.html             # 3-screen app: setup → live session → debrief
    ├── styles.css              # design system (see "Design" below)
    └── app.js                  # API calls, mic capture, WAV encoding, waveform
```

## Setup
```bash
cd interview-coach
python -m venv venv
venv\Scripts\activate        # PowerShell
pip install -r requirements.txt
copy .env.example .env       # then fill in your 4 keys
python app.py
```
Open **http://localhost:5000** — that's it, one process serves both frontend and API.

## Design
The UI borrows the vocabulary of a recording studio, since the whole product is
about voice: a lit console status bar, a live waveform that shifts color for
question playback (amber) vs. your recorded answer (red), a signal meter for
weak areas, and score dots down the session rail. Space Grotesk for headers,
IBM Plex Mono for data/scores/transcripts, Inter for body text.

No frontend framework or build step — plain HTML/CSS/JS, so there's nothing
to compile before your demo. Mic capture uses the Web Audio API directly
(ScriptProcessorNode) to build a 16kHz mono PCM WAV client-side — no ffmpeg
or server-side audio conversion needed.

## Demo flow (matches your 2-min script)
1. **Setup screen** — drop in resume image, paste the JD text (auto-indexes after ~40 chars, debounced)
2. Click **Start Interview** → session begins, first question generates and reads itself aloud
3. Tap the **mic button** → waveform turns red, recording; tap again to stop and submit
4. Feedback card rises with content/delivery scores + transcript
5. Click **Next question** → topic/difficulty auto-adapts to your weakest scored area so far
6. After 5 questions → **debrief screen**: strengths, weak areas, focus points

## Endpoints (if you need them directly)
- `POST /upload-resume` (multipart `file`) → Vision extracts text, indexed in Search
- `POST /upload-jd` (multipart `file` or JSON `{"text": "..."}`)
- `POST /start-session` → `{session_id}`
- `POST /next-question` `{session_id, topic, difficulty}` → `{question, audio_base64}`
- `POST /submit-answer` (multipart `session_id`, `question`, `topic`, `audio`) → transcript + scores
- `POST /summary` `{session_id}` → strengths, weak areas, focus points

## What's still a stub / needs attention
- **PDF resumes**: `vision_service.py` currently OCRs images. If resumes come in as native-text PDFs, add a `pypdf`/`pdfplumber` text-extraction path before falling back to Vision OCR.
- **Session persistence**: in-memory dict in `app.py` — fine for the demo, swap for Redis or a DB table if you need it to survive restarts.
- **Browser mic permissions**: first click of the mic button triggers the browser's permission prompt — test this once before the actual demo so it's not happening live in front of judges.
- **Deployment**: same pattern as AskMyDocs — Azure App Service (Linux, Python runtime), same `az webapp` deploy flow you already know.

## Next concrete steps for you
1. Fill in `.env` with the 4 keys you already have
2. Run `python app.py`, open `http://localhost:5000`, upload a real resume image + paste a real JD, and run through all 5 questions once end-to-end before demo day
3. If scores/questions feel off, the prompts to tune live in `services/agent.py` (`SYSTEM_PROMPT` and the per-function system messages)
