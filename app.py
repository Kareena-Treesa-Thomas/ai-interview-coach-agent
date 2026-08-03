"""
AI Interview Coach — Flask backend.

Flow:
  POST /upload-resume   -> Vision extracts text -> indexed in AI Search
  POST /upload-jd       -> same, tagged as 'jd'
  POST /start-session   -> initializes session state
  POST /next-question   -> agent picks/generates next question (+ TTS audio)
  POST /submit-answer   -> STT transcribes -> agent evaluates -> updates weak areas
  POST /summary         -> agent generates final summary

Session state is NOT stored server-side beyond a simple in-memory dict
keyed by session_id (fine for a demo; swap for Redis/DB for real use).
"""
import io
import uuid

from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS

from config import Config
from services import vision_service, search_service, speech_service, agent

app = Flask(__name__, static_folder="frontend", static_url_path="")
CORS(app)


@app.route("/")
def serve_frontend():
    return send_from_directory(app.static_folder, "index.html")

# Demo-only in-memory session store: {session_id: {history: [], weak_areas: {}}}
SESSIONS = {}

TOPIC_ROTATION = [
    "background & experience",
    "core technical skills",
    "system design",
    "past projects",
    "behavioral / teamwork",
]


@app.before_request
def _startup_check():
    search_service.ensure_index()


@app.route("/upload-resume", methods=["POST"])
def upload_resume():
    file = request.files["file"]
    text = vision_service.extract_text_from_upload(file)
    chunks_indexed = search_service.index_document(text, source="resume")
    return jsonify({"extracted_chars": len(text), "chunks_indexed": chunks_indexed})


@app.route("/upload-jd", methods=["POST"])
def upload_jd():
    # JD can arrive as pasted text or an uploaded image
    if "file" in request.files:
        text = vision_service.extract_text_from_upload(request.files["file"])
    else:
        text = request.json.get("text", "")
    chunks_indexed = search_service.index_document(text, source="jd")
    return jsonify({"extracted_chars": len(text), "chunks_indexed": chunks_indexed})


@app.route("/start-session", methods=["POST"])
def start_session():
    session_id = str(uuid.uuid4())
    SESSIONS[session_id] = {"history": [], "weak_areas": {}, "used_topics": []}
    return jsonify({"session_id": session_id})


def _next_topic(session: dict) -> str:
    used_topics = set(session.get("used_topics", []))
    for topic in TOPIC_ROTATION:
        if topic not in used_topics:
            session.setdefault("used_topics", []).append(topic)
            return topic
    return TOPIC_ROTATION[-1]


@app.route("/next-question", methods=["POST"])
def next_question():
    data = request.json
    session_id = data["session_id"]
    session = SESSIONS[session_id]

    topic = data.get("topic") or _next_topic(session)
    difficulty = data.get("difficulty", "medium")
    used_topics = session.setdefault("used_topics", [])
    if topic not in used_topics and len(used_topics) < len(TOPIC_ROTATION):
        used_topics.append(topic)

    question_text = agent.generate_next_question(topic=topic, difficulty=difficulty, session=session)
    return jsonify({"question": question_text, "topic": topic, "level": difficulty})


@app.route("/submit-answer", methods=["POST"])
def submit_answer():
    """
    Expects multipart form: 'audio' (WAV bytes) + 'question' (text) as form fields.
    """
    session_id = request.form["session_id"]
    question = request.form["question"]
    topic = request.form.get("topic", "general")
    difficulty = request.form.get("difficulty", "medium")
    session = SESSIONS[session_id]

    audio_bytes = request.files["audio"].read()
    answer_text = speech_service.speech_to_text_from_bytes(audio_bytes)

    context_chunks = search_service.retrieve_context(topic)
    context = "\n---\n".join(context_chunks)

    eval_result = agent.run_agent_turn(
        user_message=(
            f"Evaluate this answer. Question: {question} Answer: {answer_text} "
            f"Context: {context}"
        ),
        session=session,
    )
    scores = eval_result["function_result"]

    # Update weak areas directly from the scored result to avoid a second fragile tool-call hop.
    session.setdefault("weak_areas", {})[topic] = scores.get("content_score", 5)

    session["history"].append({
        "question": question, "answer": answer_text, "topic": topic, "level": difficulty, **scores,
    })

    return jsonify({"transcript": answer_text, "topic": topic, "level": difficulty, **scores})


@app.route("/summary", methods=["POST"])
def summary():
    session_id = request.json["session_id"]
    session = SESSIONS[session_id]

    result = agent.run_agent_turn(
        user_message=f"Generate summary. session_history: {session['history']}",
        session=session,
    )
    return jsonify(result["function_result"])


if __name__ == "__main__":
    Config.validate()
    app.run(debug=True, port=5000)
