from typing import List, Dict, Any
from ..vector_store import search_similar_chunks

def search_closed_domain(question: str, user_id: str, top_k: int = 5) -> List[Dict[str, Any]]:
    """Search user's uploaded PDF documents"""
    
    results = search_similar_chunks(question, user_id, top_k)
    
    print(f"📄 PDF search: {len(results)} chunks found")
    
    formatted_results = []
    for r in results:
        formatted_results.append({
            "content": r.get('content', ''),
            "filename": r.get('filename', 'Unknown.pdf'),
            "score": r.get('similarity', r.get('score', 0)),
            "source_type": "closed"
        })
    
    return formatted_results 
