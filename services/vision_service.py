"""
Azure AI Vision — Read/OCR. Extracts raw text from an uploaded resume or JD
(image or scanned PDF page). If the resume is a native-text PDF, prefer
extracting text directly (e.g. via a PDF library) and only fall back to
Vision for scanned/image-based documents.
"""
from azure.ai.vision.imageanalysis import ImageAnalysisClient
from azure.ai.vision.imageanalysis.models import VisualFeatures
from azure.core.credentials import AzureKeyCredential
from config import Config


def _client():
    return ImageAnalysisClient(
        endpoint=Config.VISION_ENDPOINT,
        credential=AzureKeyCredential(Config.VISION_KEY),
    )


def extract_text_from_image_bytes(image_bytes: bytes) -> str:
    """Runs OCR (Read feature) on raw image bytes, returns concatenated text."""
    client = _client()
    result = client.analyze(
        image_data=image_bytes,
        visual_features=[VisualFeatures.READ],
    )
    lines = []
    if result.read is not None:
        for block in result.read.blocks:
            for line in block.lines:
                lines.append(line.text)
    return "\n".join(lines)


def extract_text_from_upload(file_storage) -> str:
    """
    file_storage: werkzeug FileStorage from Flask's request.files.
    Handles the common case where resumes come in as images (png/jpg) or
    photographed pages. For native PDFs, swap in a text-layer extractor first.
    """
    raw = file_storage.read()
    return extract_text_from_image_bytes(raw)
