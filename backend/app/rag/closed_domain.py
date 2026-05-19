from typing import List, Dict, Any
from ..vector_store import search_similar_chunks

def search_closed_domain(question: str, user_id: str, top_k: int = 5) -> List[Dict[str, Any]]:
    """
    Search user's uploaded documents for relevant chunks using pgvector.
    
    Args:
        question: User's question string 
        user_id: UUID of the authenticated user
        top_k: Number of top results to return (default: 5) 
    
    Returns:
        List of dictionaries containing:
        - content: The text chunk
        - similarity: Similarity score (0-1)
        - filename: Source filename
        - type: Always "closed_domain"
    """
    results = search_similar_chunks(question, user_id, top_k)
    return results
