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
            "description": "Produce the final session summary: strengths, weak areas, focus points.",
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


def _execute_function(name: str, args: dict, session: dict) -> dict:
    """Executes the function the model chose to call, using AI Search for grounding."""
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
        completion = client.chat.completions.create(
            model=Config.AOAI_DEPLOYMENT,
            messages=[
                {"role": "system", "content": (
                    "Evaluate the answer. Return strict JSON: "
                    '{"content_score": 0-10, "delivery_score": 0-10, '
                    '"feedback": "2-3 sentences", "gap": "one specific weakness"}'
                )},
                {"role": "user", "content": (
                    f"Question: {args['question']}\nAnswer: {args['answer']}\n"
                    f"Grounding context: {args['context']}"
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
                    "Summarize the interview session. Return strict JSON: "
                    '{"strengths": [...], "weak_areas": [...], "focus_points": [...]}'
                )},
                {"role": "user", "content": args["session_history"]},
            ],
            response_format={"type": "json_object"},
        )
        return json.loads(completion.choices[0].message.content)

    raise ValueError(f"Unknown function: {name}")


def run_agent_turn(user_message: str, session: dict) -> dict:
    """
    One turn of the agent loop:
      1. Send conversation + function defs to the model
      2. Model picks a function
      3. We execute it (may call AI Search)
      4. Result feeds back to the model for a final natural-language reply
      5. Return both the structured result and the reply for the frontend
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

    tool_call = choice.message.tool_calls[0]
    func_name = tool_call.function.name
    func_args = json.loads(tool_call.function.arguments)

    result = _execute_function(func_name, func_args, session)

    # Feed the result back so the model can phrase a natural response
    messages.append(choice.message)
    messages.append({
        "role": "tool",
        "tool_call_id": tool_call.id,
        "content": json.dumps(result),
    })
    second_pass = client.chat.completions.create(
        model=Config.AOAI_DEPLOYMENT,
        messages=messages,
    )

    return {
        "reply": second_pass.choices[0].message.content,
        "function_called": func_name,
        "function_result": result,
    }
