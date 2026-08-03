"""
Central config. Pull every value from environment variables (.env locally,
App Service Configuration in production). Never hardcode keys.
"""
import os
from dotenv import load_dotenv

load_dotenv(override=True)


def _env(*names, default=None):
    for name in names:
        value = os.environ.get(name)
        if value not in (None, ""):
            return value.strip().split()[0]
    return default

class Config:
    # Azure AI Vision (interviewcoach-vision)
    VISION_ENDPOINT = _env("VISION_ENDPOINT", "AZURE_VISION_ENDPOINT")
    VISION_KEY = _env("VISION_KEY", "AZURE_VISION_KEY")

    # Azure OpenAI (interviewcoach-openai)
    AOAI_ENDPOINT = _env("AOAI_ENDPOINT", "AZURE_OPENAI_ENDPOINT")
    AOAI_KEY = _env("AOAI_KEY", "AZURE_OPENAI_KEY")
    AOAI_DEPLOYMENT = _env("AOAI_DEPLOYMENT", "AZURE_OPENAI_DEPLOYMENT", default="gpt-4o")  # your deployment name, not model name
    AOAI_API_VERSION = _env("AOAI_API_VERSION", "AZURE_OPENAI_API_VERSION", default="2024-08-01-preview")

    # Azure AI Search (interviewcoach-search)
    SEARCH_ENDPOINT = _env("SEARCH_ENDPOINT", "AZURE_SEARCH_ENDPOINT")
    SEARCH_KEY = _env("SEARCH_KEY", "AZURE_SEARCH_KEY")
    SEARCH_INDEX_NAME = _env("SEARCH_INDEX_NAME", "AZURE_SEARCH_INDEX", default="interview-coach-index")

    # Azure AI Speech (interviewcoach-speech)
    SPEECH_KEY = _env("SPEECH_KEY", "AZURE_SPEECH_KEY")
    SPEECH_REGION = _env("SPEECH_REGION", "AZURE_SPEECH_REGION")  # e.g. "centralindia"

    @classmethod
    def validate(cls):
        missing = [k for k, v in vars(cls).items()
                   if not k.startswith("_") and not callable(v) and v in (None, "")]
        if missing:
            raise RuntimeError(f"Missing required env vars: {missing}")
