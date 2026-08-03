"""
The agent: OpenAI + function calling. This is the loop described in your
spec — model decides which function to call, your code executes it
(including querying AI Search), result feeds back, model decides next step.

Session state (questions, answers, scores, weak_areas) is passed in
explicitly on every call — no server-side memory between requests.
"""
import json
from openai import AzureOpenAI
from config import Config
from services import search_service

client = AzureOpenAI(
    azure_endpoint=Config.AOAI_ENDPOINT,
    api_key=Config.AOAI_KEY,
    api_version=Config.AOAI_API_VERSION,
)

FUNCTIONS = [
    {
        "type": "function",
        "function": {
            "name": "get_next_question",
            "description": "Generate the next interview question, grounded in retrieved resume/JD context, targeting a topic and difficulty.",
            "parameters": {
                "type": "object",
                "properties": {
                    "topic": {"type": "string", "description": "e.g. 'React', 'system design', 'leadership'"},
                    "difficulty": {"type": "string", "enum": ["easy", "medium", "hard"]},
                },
                "required": ["topic", "difficulty"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "evaluate_answer",
            "description": "Score and critique the candidate's answer against the retrieved context, covering both content accuracy and delivery.",
            "parameters": {
                "type": "object",
                "properties": {
                    "question": {"type": "string"},
                    "answer": {"type": "string"},
                    "context": {"type": "string"},
                },
                "required": ["question", "answer", "context"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_weak_areas",
            "description": "Record a topic's score to update the candidate's weak-area profile for adapting future questions.",
            "parameters": {
                "type": "object",
                "properties": {
                    "topic": {"type": "string"},
                    "score": {"type": "number", "description": "0-10"},
                },
                "required": ["topic", "score"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "generate_summary",
            "description": "Produce the final session summary: strengths, weak areas, focus points, and per-question coaching on how each answer could have been approached better.",
            "parameters": {
                "type": "object",
                "properties": {
                    "session_history": {"type": "string", "description": "JSON-encoded list of Q/A/score records"},
                },
                "required": ["session_history"],
            },
        },
    },
]

SYSTEM_PROMPT = """You are an AI interview coach. You ask tailored interview
questions grounded in the candidate's resume and the job description, then
evaluate their spoken answers on both content and delivery (clarity,
structure, confidence signals in phrasing). You adapt difficulty based on
weak areas that emerge across the session. Always call a function rather
than answering in plain text; the function calls drive the interview."""


def _execute_function(name: str, args: dict, session: dict, injected_context: str = None) -> dict:
    """Executes the function the model chose to call, using AI Search for grounding.

    injected_context: for evaluate_answer, the caller (app.py) already knows
    the real grounding context — pass it here instead of trusting the model
    to faithfully retype a potentially long string into its own tool-call
    arguments, which is fragile and previously caused a KeyError when the
    model omitted the field.
    """
    if name == "get_next_question":
        context_chunks = search_service.retrieve_context(args["topic"])
        context = "\n---\n".join(context_chunks)
        # Ask the model to phrase the actual question text, grounded in context
        completion = client.chat.completions.create(
            model=Config.AOAI_DEPLOYMENT,
            messages=[
                {"role": "system", "content": "Write ONE interview question only, no preamble."},
                {"role": "user", "content": (
                    f"Topic: {args['topic']}\nDifficulty: {args['difficulty']}\n"
                    f"Candidate background / JD context:\n{context}\n"
                    f"Weak areas so far: {session.get('weak_areas', {})}"
                )},
            ],
        )
        question_text = completion.choices[0].message.content.strip()
        return {"question": question_text, "topic": args["topic"], "difficulty": args["difficulty"]}

    if name == "evaluate_answer":
        # Prefer server-injected context (reliable) over the model's own
        # copy of it (fragile) — fall back to the model's copy only if
        # nothing was injected, and to an empty string as a last resort
        # so a missing field never crashes the request.
        context = injected_context if injected_context is not None else args.get("context", "")
        completion = client.chat.completions.create(
            model=Config.AOAI_DEPLOYMENT,
            messages=[
                {"role": "system", "content": (
                    "Evaluate the answer using the FULL 0-10 range — do not cluster "
                    "scores in the middle. Use this rubric for content_score:\n"
                    "0-2: off-topic, no relevant content\n"
                    "3-4: partially relevant but vague, missing key details\n"
                    "5-6: solid, covers fundamentals, but lacks depth or concrete specifics\n"
                    "7-8: strong — specific, well-structured, shows real hands-on experience\n"
                    "9-10: exceptional — precise, insightful, clearly differentiates the candidate\n"
                    "Apply the same full-range logic to delivery_score (clarity, structure, "
                    "confidence, minimal filler words). A genuinely excellent, detailed, "
                    "well-organized answer MUST score 8 or above — do not default to 6 "
                    "out of caution. Return strict JSON: "
                    '{"content_score": 0-10, "delivery_score": 0-10, '
                    '"feedback": "2-3 sentences", "gap": "one specific weakness"}'
                )},
                {"role": "user", "content": (
                    f"Question: {args['question']}\nAnswer: {args['answer']}\n"
                    f"Grounding context: {context}"
                )},
            ],
            response_format={"type": "json_object"},
        )
        return json.loads(completion.choices[0].message.content)

    if name == "update_weak_areas":
        weak_areas = session.setdefault("weak_areas", {})
        weak_areas[args["topic"]] = args["score"]
        return {"weak_areas": weak_areas}

    if name == "generate_summary":
        completion = client.chat.completions.create(
            model=Config.AOAI_DEPLOYMENT,
            messages=[
                {"role": "system", "content": (
                    "You are coaching a candidate after a mock interview. Summarize the "
                    "session AND give concrete, actionable coaching for each question — "
                    "specifically what a stronger answer would have said differently, and "
                    "one specific speech-delivery tip (pacing, filler words, structure like "
                    "STAR, confidence signals in phrasing) based on the transcript. Be "
                    "specific to what was actually said, not generic advice. "
                    "Return strict JSON: "
                    '{"strengths": ["..."], "weak_areas": ["..."], "focus_points": ["..."], '
                    '"question_reviews": [{"topic": "...", "question": "...", '
                    '"better_approach": "1-2 sentences on what a stronger answer would have '
                    'covered or how it would be structured differently", '
                    '"delivery_tip": "1 concrete sentence on delivery, e.g. pacing, filler '
                    'words, or structure"}]}'
                )},
                {"role": "user", "content": args["session_history"]},
            ],
            response_format={"type": "json_object"},
        )
        return json.loads(completion.choices[0].message.content)

    raise ValueError(f"Unknown function: {name}")


def generate_next_question(topic: str, difficulty: str, session: dict) -> str:
    """Fast path for the live interview question. Uses one model call instead of the full tool loop."""
    context_chunks = search_service.retrieve_context(topic)
    context = "\n---\n".join(context_chunks)
    completion = client.chat.completions.create(
        model=Config.AOAI_DEPLOYMENT,
        messages=[
            {"role": "system", "content": "Write ONE interview question only, no preamble."},
            {"role": "user", "content": (
                f"Topic: {topic}\nDifficulty: {difficulty}\n"
                f"Candidate background / JD context:\n{context}\n"
                f"Weak areas so far: {session.get('weak_areas', {})}"
            )},
        ],
        max_tokens=120,
    )
    return completion.choices[0].message.content.strip()


def run_agent_turn(user_message: str, session: dict, injected_context: str = None) -> dict:
    """
    One turn of the agent loop:
      1. Send conversation + function defs to the model
      2. Model picks a function
      3. We execute it (may call AI Search)
      4. Result feeds back to the model for a final natural-language reply
      5. Return both the structured result and the reply for the frontend

    injected_context: passed straight through to _execute_function for
    evaluate_answer calls — see that function's docstring for why.
    """
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_message},
    ]

    first_pass = client.chat.completions.create(
        model=Config.AOAI_DEPLOYMENT,
        messages=messages,
        tools=FUNCTIONS,
        tool_choice="auto",
    )

    choice = first_pass.choices[0]
    if not choice.message.tool_calls:
        return {"reply": choice.message.content, "function_result": None}

    results = []
    messages.append(choice.message)

    for tool_call in choice.message.tool_calls:
        func_name = tool_call.function.name
        func_args = json.loads(tool_call.function.arguments)
        result = _execute_function(func_name, func_args, session, injected_context=injected_context)
        results.append({"name": func_name, "id": tool_call.id, "result": result})
        messages.append({
            "role": "tool",
            "tool_call_id": tool_call.id,
            "content": json.dumps(result),
        })

    primary = next((item for item in results if item["name"] == "evaluate_answer"), results[0])

    # Feed the result back so the model can phrase a natural response
    second_pass = client.chat.completions.create(
        model=Config.AOAI_DEPLOYMENT,
        messages=messages,
    )

    return {
        "reply": second_pass.choices[0].message.content,
        "function_called": [item["name"] for item in results],
        "function_result": primary["result"],
        "function_results": results,
    }