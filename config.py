"""
Central config. Pull every value from environment variables (.env locally,
App Service Configuration in production). Never hardcode keys.
"""
import os
from dotenv import load_dotenv

load_dotenv()

class Config:
    # Azure AI Vision (interviewcoach-vision)
    VISION_ENDPOINT = os.environ.get("VISION_ENDPOINT")
    VISION_KEY = os.environ.get("VISION_KEY")

    # Azure OpenAI (interviewcoach-openai)
    AOAI_ENDPOINT = os.environ.get("AOAI_ENDPOINT")
    AOAI_KEY = os.environ.get("AOAI_KEY")
    AOAI_DEPLOYMENT = os.environ.get("AOAI_DEPLOYMENT", "gpt-4o")  # your deployment name, not model name
    AOAI_API_VERSION = os.environ.get("AOAI_API_VERSION", "2024-08-01-preview")

    # Azure AI Search (interviewcoach-search)
    SEARCH_ENDPOINT = os.environ.get("SEARCH_ENDPOINT")
    SEARCH_KEY = os.environ.get("SEARCH_KEY")
    SEARCH_INDEX_NAME = os.environ.get("SEARCH_INDEX_NAME", "interview-coach-index")

    # Azure AI Speech (interviewcoach-speech)
    SPEECH_KEY = os.environ.get("SPEECH_KEY")
    SPEECH_REGION = os.environ.get("SPEECH_REGION")  # e.g. "centralindia"

    @classmethod
    def validate(cls):
        missing = [k for k, v in vars(cls).items()
                   if not k.startswith("_") and not callable(v) and v in (None, "")]
        if missing:
            raise RuntimeError(f"Missing required env vars: {missing}")
