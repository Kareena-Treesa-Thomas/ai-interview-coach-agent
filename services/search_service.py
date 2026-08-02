"""
Azure AI Search — the RAG retrieval layer. Indexes chunks of the resume
and job description, retrieves the most relevant chunks for a given topic
so the agent's questions/feedback stay grounded instead of generic.

Uses a simple keyword/semantic hybrid search on a flat index. No embeddings
pipeline required to get a working demo; add vector search later if you
have time.
"""
import uuid
from azure.core.credentials import AzureKeyCredential
from azure.search.documents import SearchClient
from azure.search.documents.indexes import SearchIndexClient
from azure.search.documents.indexes.models import (
    SearchIndex, SimpleField, SearchableField, SearchFieldDataType,
)
from config import Config


def _index_client():
    return SearchIndexClient(Config.SEARCH_ENDPOINT, AzureKeyCredential(Config.SEARCH_KEY))


def _search_client():
    return SearchClient(Config.SEARCH_ENDPOINT, Config.SEARCH_INDEX_NAME,
                         AzureKeyCredential(Config.SEARCH_KEY))


def ensure_index():
    """Creates the index if it doesn't already exist. Safe to call on every startup."""
    client = _index_client()
    existing = [i.name for i in client.list_indexes()]
    if Config.SEARCH_INDEX_NAME in existing:
        return

    fields = [
        SimpleField(name="id", type=SearchFieldDataType.String, key=True),
        SimpleField(name="source", type=SearchFieldDataType.String, filterable=True),  # "resume" | "jd"
        SearchableField(name="content", type=SearchFieldDataType.String),
    ]
    index = SearchIndex(name=Config.SEARCH_INDEX_NAME, fields=fields)
    client.create_index(index)


def _chunk_text(text: str, max_chars: int = 800):
    words = text.split()
    chunks, current = [], []
    length = 0
    for w in words:
        current.append(w)
        length += len(w) + 1
        if length >= max_chars:
            chunks.append(" ".join(current))
            current, length = [], 0
    if current:
        chunks.append(" ".join(current))
    return chunks


def index_document(text: str, source: str):
    """source: 'resume' or 'jd'. Splits into chunks and uploads to the index."""
    client = _search_client()
    docs = [
        {"id": str(uuid.uuid4()), "source": source, "content": chunk}
        for chunk in _chunk_text(text)
    ]
    if docs:
        client.upload_documents(documents=docs)
    return len(docs)


def retrieve_context(query: str, source_filter: str = None, top: int = 3) -> list[str]:
    """
    Pulls the most relevant chunks for a given query (e.g. a topic like
    'React' or 'team leadership'). Used to ground question generation
    and answer evaluation.
    """
    client = _search_client()
    filter_expr = f"source eq '{source_filter}'" if source_filter else None
    results = client.search(search_text=query, filter=filter_expr, top=top)
    return [r["content"] for r in results]
