from typing import List, Dict, Any
from ..vector_store import search_similar_chunks

def search_closed_domain(question: str, user_id: str, top_k: int = 4) -> List[Dict[str, Any]]:
    """
    Search user's uploaded documents for relevant chunks.
    Returns top_k relevant chunks.
    """
    results = search_similar_chunks(question, user_id, top_k)
    return results
