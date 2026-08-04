# 🎙️ AI INTERVIEW COACH – VOICE-BASED MOCK INTERVIEW AGENT

[![Live Demo](https://img.shields.io/badge/Live%20Demo-ai--interview--coach--agent.azurewebsites.net-22c55e?style=flat-square)](https://ai-interview-coach-agent.azurewebsites.net/)
[![Demo Video](https://img.shields.io/badge/Demo%20Video-Watch-ff0000?style=flat-square)](https://drive.google.com/file/d/1RSVrr0nEA5eh8GGwYHRvv42Z9ETEOiF3/view?usp=sharing)
[![Azure OpenAI](https://img.shields.io/badge/Azure%20OpenAI-GPT--4o-a855f7?style=flat-square)](https://azure.microsoft.com/en-us/products/ai-services/openai-service)
[![Azure AI Speech](https://img.shields.io/badge/Azure%20AI-Speech-ec4899?style=flat-square)](https://azure.microsoft.com/en-us/products/ai-services/ai-speech)
[![Azure AI Search](https://img.shields.io/badge/Azure%20AI-Search-3b82f6?style=flat-square)](https://azure.microsoft.com/en-us/products/ai-services/ai-search)
[![Azure AI Vision](https://img.shields.io/badge/Azure%20AI-Vision-06b6d4?style=flat-square)](https://azure.microsoft.com/en-us/products/ai-services/ai-vision)
[![Deployed on Azure App Service](https://img.shields.io/badge/Azure%20App%20Service-Deployed-f59e0b?style=flat-square)](https://azure.microsoft.com/en-us/products/app-service)
[![License](https://img.shields.io/badge/License-MIT-fb923c?style=flat-square)](#license)

> Most interview prep tools ask generic questions. This one reads your resume against the actual job description — and asks about the gap between them, live, by voice.

---

## 🎬 Live Demo

🚀 **[ai-interview-coach-agent.azurewebsites.net](https://ai-interview-coach-agent.azurewebsites.net/)**

📹 **[Watch the demo video](https://drive.google.com/file/d/1RSVrr0nEA5eh8GGwYHRvv42Z9ETEOiF3/view?usp=sharing)**

---

## 🧩 The Problem

Most interview prep tools recycle the same generic question bank regardless of who's answering or what role they're prepping for. Candidates end up rehearsing answers that don't map to the job they're actually interviewing for, and get no real read on how they sound — just how they read.

## ✅ The Solution

AI Interview Coach indexes your resume and a target job description, then generates questions specific to the gap between them. You answer out loud through the mic; the agent transcribes your response in real time, scores content and delivery separately, and adapts the next question's topic and difficulty to your weakest area so far. A full debrief — strengths, weak areas, focus points — is available as a downloadable PDF at the end.

---

## ⚡ Features

| Feature | Description |
|---|---|
| 🎯 **Resume-vs-JD Question Generation** | Azure OpenAI (GPT-4o) generates questions grounded in the gap between your resume and the target role |
| 🖼️ **Resume/JD Ingestion** | Azure AI Vision OCRs uploaded resume/JD images; text JDs can be pasted directly |
| 🔍 **RAG-Backed Retrieval** | Azure AI Search indexes resume/JD content so every question stays grounded in it |
| 🎙️ **Live Voice Interview** | Azure AI Speech handles real-time speech-to-text and text-to-speech, no typing required |
| 📊 **Dual Scoring** | Content and delivery scored separately per answer, alongside a full transcript |
| 🌐 **CEFR Proxy Indicator** | Language-proficiency signal derived from the content score (standalone grammar analysis planned) |
| 🧭 **Adaptive Difficulty** | Topic and difficulty for the next question adjust to your weakest scored area so far |
| 📡 **Live Signal Meter** | Session-wide strength indicator updates after every answer |
| 📄 **Downloadable PDF Debrief** | Strengths, weak areas, and focus points exported for pre-interview review |
| 🎨 **Studio Console UI** | No frontend framework — plain HTML/CSS/JS styled like a recording studio console |

---

## 🛠 Tech Stack

```
Frontend        HTML · CSS · JavaScript (no framework, no build step)
Backend         Python · Flask (single process serves API + frontend)
AI — Vision     Azure AI Vision (resume/JD OCR)
AI — Retrieval  Azure AI Search (RAG indexing + retrieval)
AI — Generation Azure OpenAI Service (GPT-4o, function-calling agent)
AI — Voice      Azure AI Speech (STT + TTS)
Audio Capture   Web Audio API (ScriptProcessorNode) — 16kHz mono PCM WAV, client-side
Deployment      Azure App Service (Linux, Python runtime)
Version Control Git & GitHub
```

---

## 🔄 How It Works

1. **Upload** your resume (image) and paste or upload the job description
2. **Azure AI Vision** OCRs the resume; **Azure AI Search** indexes both documents
3. **Start Interview** — the agent generates question 1 and reads it aloud via **Azure AI Speech**
4. **Answer by voice** — your response is transcribed live and scored on content + delivery
5. **Azure OpenAI** picks the next question's topic/difficulty based on your weakest area so far
6. After 5 questions → **debrief screen** with strengths, weak areas, focus points, and a downloadable PDF report

---

## 🚀 Quick Start

```bash
git clone https://github.com/Kareena-Treesa-Thomas/ai-interview-coach-agent.git
cd ai-interview-coach-agent
python -m venv venv
venv\Scripts\activate        # PowerShell
pip install -r requirements.txt
copy .env.example .env       # then fill in your 4 Azure keys
python app.py
```

Open **http://localhost:5000** — one process serves both frontend and API.

---

## ⚙️ Environment Setup

Create a `.env` file in the project root:

```env
AZURE_VISION_KEY=your_azure_vision_key
AZURE_VISION_ENDPOINT=your_azure_vision_endpoint
AZURE_SEARCH_KEY=your_azure_search_key
AZURE_SEARCH_ENDPOINT=your_azure_search_endpoint
AZURE_OPENAI_KEY=your_azure_openai_key
AZURE_OPENAI_ENDPOINT=your_azure_openai_endpoint
AZURE_SPEECH_KEY=your_azure_speech_key
AZURE_SPEECH_REGION=your_azure_speech_region
```

> ⚠️ Never commit `.env`. All API keys must stay in backend environment variables only.

---

## 📁 Project Structure

```
ai-interview-coach-agent/
├── app.py                    # Flask routes — orchestration + serves the frontend
├── config.py                 # Loads all 4 Azure API keys from env
├── requirements.txt
├── .env.example               # Copy to .env and fill in real keys
├── services/
│   ├── vision_service.py      # Resume/JD OCR
│   ├── search_service.py      # RAG index + retrieval
│   ├── speech_service.py      # STT + TTS
│   └── agent.py               # OpenAI function-calling loop (the "agent")
└── frontend/
    ├── index.html             # 3-screen app: setup → live session → debrief
    ├── styles.css              # design system
    └── app.js                  # API calls, mic capture, WAV encoding, waveform
```

---

## 🔌 API Endpoints

| Endpoint | Description |
|---|---|
| `POST /upload-resume` | Multipart `file` → Vision extracts text, indexed in Search |
| `POST /upload-jd` | Multipart `file` or JSON `{"text": "..."}` |
| `POST /start-session` | → `{session_id}` |
| `POST /next-question` | `{session_id, topic, difficulty}` → `{question, audio_base64}` |
| `POST /submit-answer` | Multipart `session_id`, `question`, `topic`, `audio` → transcript + scores |
| `POST /summary` | `{session_id}` → strengths, weak areas, focus points |

---

## 🔗 Links

| | |
|---|---|
| 🚀 Live Demo | [ai-interview-coach-agent.azurewebsites.net](https://ai-interview-coach-agent.azurewebsites.net/) |
| 📹 Demo Video | [Watch on Google Drive](https://drive.google.com/file/d/1RSVrr0nEA5eh8GGwYHRvv42Z9ETEOiF3/view?usp=sharing) |
| 💻 GitHub Repo | [github.com/Kareena-Treesa-Thomas/ai-interview-coach-agent](https://github.com/Kareena-Treesa-Thomas/ai-interview-coach-agent) |

---

## 👩‍💻 Developer

Built by **Kareena Treesa Thomas** · [github.com/Kareena-Treesa-Thomas](https://github.com/Kareena-Treesa-Thomas)

Mega project for the **Microsoft Season of AI 2.0 Bootcamp** — built on five Azure services end to end.

---

## 📄 License

Licensed under the [MIT License](LICENSE).
