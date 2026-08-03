# AI Interview Coach — Setup Guide

A step-by-step walkthrough: GitHub → Azure → API integration → naming. Follow in order; each section assumes the previous one is done.

---

## 1. GitHub

### 1.1 Create the repo
- Go to github.com → **New repository**
- Repo name: `ai-interview-coach-agent` (see naming rationale in §4)
- Description: *"Voice-based mock interview agent — Azure AI Speech, Vision, Search & OpenAI, tailored to your resume and target JD."*
- Visibility: **Public** if this is for a hackathon/portfolio (judges and recruiters need to see it without an invite); **Private** if it contains anything you're not ready to share, and add collaborators individually
- Check **Add a README**, **Add .gitignore → Python**, **Choose a license → MIT** (standard for student/portfolio projects — permissive, recognizable, no legal ambiguity)

### 1.2 Clone and lay out the structure
```powershell
git clone https://github.com/<your-username>/ai-interview-coach-agent.git
cd ai-interview-coach-agent
```
Copy in the `app.py`, `config.py`, `requirements.txt`, `.env.example`, `services/`, and `frontend/` from the zip I gave you.

### 1.3 Critical: protect your keys
Your `.gitignore` (from the Python template) already excludes `.env` — **double check this before your first commit**:
```powershell
cat .gitignore | Select-String ".env"
```
If it's not there, add it:
```
.env
__pycache__/
venv/
*.pyc
```
Never commit `.env` with real keys. This matters doubly for you specifically — you've had one Azure key end up pasted somewhere it shouldn't have during EchoAI, so treat every key like it's already been leaked until it's rotated.

### 1.4 Commit conventions
Use a simple, readable convention — not strictly Conventional Commits, just consistent:
```
feat: add resume upload + Vision OCR
fix: correct WAV sample rate mismatch in speech_service
docs: add setup guide
```

### 1.5 Branching
For a solo project on a deadline, keep it simple:
- `main` — always demo-able
- `dev` — where you actually work
- Merge `dev → main` only when a feature fully works end-to-end

```powershell
git checkout -b dev
# ...work...
git add .
git commit -m "feat: wire up agent function-calling loop"
git push -u origin dev
```

### 1.6 README essentials
Your README (already drafted in the zip) should open with: what it does in one line, a screenshot/GIF of the console UI, setup steps, and the architecture diagram. Recruiters and judges skim — the first screen of the README is your pitch.

---

## 2. Azure

You already have all 4 resources provisioned from the admin's subscription. This section is about *retrieving the right values* and *wiring them in correctly* — the part that actually breaks most demos.

### 2.1 Where to find each value

Go to **portal.azure.com** → search each resource by name → **Keys and Endpoint** (for Speech/Vision/Search) or **Keys and Endpoint** under **Resource Management** (for OpenAI).

| Resource | Portal blade | What you need |
|---|---|---|
| `interviewcoach-vision` | Keys and Endpoint | `VISION_ENDPOINT`, `VISION_KEY` (Key 1) |
| `interviewcoach-speech` | Keys and Endpoint | `SPEECH_KEY` (Key 1), `SPEECH_REGION` (the region shown, e.g. `centralindia`) |
| `interviewcoach-search` | Keys | `SEARCH_ENDPOINT` (from Overview → Url), `SEARCH_KEY` (Primary admin key) |
| `interviewcoach-openai` | Keys and Endpoint | `AOAI_ENDPOINT`, `AOAI_KEY` |

### 2.2 Azure OpenAI needs one extra step: deploy a model
Unlike the others, Azure OpenAI doesn't work off the resource key alone — you deploy a *model* inside it first.
1. Go to `interviewcoach-openai` → **Model deployments** → **Manage Deployments** (opens Azure AI Foundry)
2. **Create new deployment** → model `gpt-4o` (or `gpt-4o-mini` if quota is tight) → give it a **deployment name** — this is what you put in `.env` as `AOAI_DEPLOYMENT`, *not* the model name itself. If you name the deployment `interview-coach-gpt4o`, that exact string goes in `.env`.
3. Note the **API version** shown in the Foundry playground's code sample (e.g. `2024-08-01-preview`) — Azure OpenAI is versioned per-request, unlike plain OpenAI.

### 2.3 Fill in `.env`
```
VISION_ENDPOINT=https://interviewcoach-vision.cognitiveservices.azure.com/
VISION_KEY=<paste>

AOAI_ENDPOINT=https://interviewcoach-openai.openai.azure.com/
AOAI_KEY=<paste>
AOAI_DEPLOYMENT=<your deployment name from 2.2>
AOAI_API_VERSION=2024-08-01-preview

SEARCH_ENDPOINT=https://interviewcoach-search.search.windows.net
SEARCH_KEY=<paste>
SEARCH_INDEX_NAME=interview-coach-index

SPEECH_KEY=<paste>
SPEECH_REGION=<e.g. centralindia>
```

### 2.4 Sanity-check each service in isolation before running the full app
This is the step people skip and then can't tell which of 4 services is the problem when something fails.

```powershell
# From the project root, with venv activated
python -c "from services import search_service; search_service.ensure_index(); print('Search OK')"
```
For Vision, Speech, and OpenAI, the quickest check is just running `app.py` and hitting one endpoint at a time via the UI — upload the resume first and confirm `chunks_indexed` comes back before touching anything else.

### 2.5 Deployment (once local demo works)
Same pattern as your AskMyDocs deploy:
```powershell
az login
az webapp up --name interview-coach-app --resource-group <admin-provided-rg> --runtime "PYTHON:3.11"
```
Then set the same `.env` values as **Application Settings** in the portal (App Service → Configuration → Application settings) — App Service doesn't read `.env` files directly, each key needs to be added there individually, or via:
```powershell
az webapp config appsettings set --name interview-coach-app --resource-group <rg> --settings VISION_KEY="..." SPEECH_KEY="..." AOAI_KEY="..." SEARCH_KEY="..."
```

---

## 3. API Integration — how the pieces actually connect

This is the mental model, not just the code:

```
Resume image ──▶ Vision (OCR) ──▶ text ──▶ chunked ──▶ indexed in AI Search
JD text/image ──▶ Vision (if image) ──▶ same, tagged "jd"

User asks for next question
  └─▶ OpenAI (function calling) decides: call get_next_question(topic, difficulty)
        └─▶ your code queries AI Search for relevant resume/JD chunks
        └─▶ feeds those chunks back to OpenAI to phrase the actual question
        └─▶ question text ──▶ Speech (TTS) ──▶ audio back to browser

User speaks answer
  └─▶ browser records WAV ──▶ Speech (STT) ──▶ transcript
        └─▶ OpenAI calls evaluate_answer(question, answer, context) ──▶ scores
        └─▶ OpenAI calls update_weak_areas(topic, score) ──▶ session state updates
```

The one thing to get right: **AI Search is retrieval, not generation.** It never writes text — it just returns the closest-matching chunks you already indexed. OpenAI is the only service that generates language. If you keep that boundary straight, debugging "why does this question sound generic" becomes easy: check what AI Search actually returned before blaming the prompt.

### Testing the loop end-to-end without the frontend
Useful when something breaks and you want to isolate frontend vs. backend:
```powershell
curl -X POST http://localhost:5000/start-session
curl -X POST http://localhost:5000/next-question -H "Content-Type: application/json" -d "{\"session_id\":\"<id>\",\"topic\":\"React\",\"difficulty\":\"medium\"}"
```

---

## 4. Naming — professional, consistent, portfolio-ready

Consistency across GitHub, Azure, LinkedIn, and your resume matters more than any individual name — a recruiter or judge should be able to find the same project three different ways and recognize it instantly.

| Context | Name | Why |
|---|---|---|
| Project / product name | **AI Interview Coach** | Plain, descriptive, no forced acronym — says exactly what it does |
| GitHub repo | `ai-interview-coach-agent` | lowercase-hyphenated is GitHub convention; matches product name exactly |
| Azure resources | `interviewcoach-*` (already set) | consistent prefix across all 4 services makes them instantly identifiable in a shared subscription with other people's resources |
| App Service name | `interview-coach-app` | mirrors the resource prefix, `-app` suffix disambiguates from the AI resources |
| Azure OpenAI deployment | `interview-coach-gpt4o` | includes the model so you're not guessing later when you have multiple deployments |
| Search index | `interview-coach-index` | already used in the starter code — keep it |
| Demo/live URL (if you get a custom domain later) | `interviewcoach.<yourdomain>` or the default `interview-coach-app.azurewebsites.net` | fine as-is for a hackathon demo |
| LinkedIn post / resume line | "AI Interview Coach — voice-based mock interview agent with adaptive difficulty (Azure AI Speech, Vision, Search, OpenAI)" | leads with what it does, names the real stack, no buzzwords beyond what's accurate |

Avoid: version numbers in the name ("V2", "Pro"), your own name in the repo ("kareena-interview-app" — the project should stand on its own), and cutesy names that don't describe function (fine for personal fun projects, but this one's going in front of judges/recruiters).

---

## Quick checklist before demo day
- [ ] `.env` filled, `.gitignore` confirmed excluding it
- [ ] Azure OpenAI deployment name matches `.env` exactly
- [ ] Full 5-question loop run once locally end-to-end
- [ ] Mic permission granted once in the browser you'll demo with
- [ ] Repo pushed to `main`, README has a screenshot
- [ ] If deployed: Application Settings on App Service match your local `.env`
