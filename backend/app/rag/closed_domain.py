# rag/closed_domain.py
from typing import List, Dict, Any
from ..vector_store import search_similar_chunks

def search_closed_domain(question: str, user_id: str, top_k: int = 5) -> List[Dict[str, Any]]:
    """Search user's uploaded PDF documents for relevant chunks"""
    
    results = search_similar_chunks(question, user_id, top_k)
    
    print(f"📄 Closed domain search for user {user_id}: {len(results)} results found")
    
    # Ensure each result has the required fields
    formatted_results = []
    for r in results:
        formatted_results.append({
            "content": r.get('content', ''),
            "filename": r.get('filename', 'Unknown.pdf'),
            "score": r.get('score', 0),
            "chunk_id": r.get('chunk_id', ''),
            "source_type": "closed"
        })
    
    return formatted_results
