from typing import List, Dict, Any
from ..vector_store import search_similar_chunks

def expand_query(question: str) -> str:
    """Expand query with relevant keywords for better retrieval"""
    
    # Common expansion mappings
    expansions = {
        "skill": "technical skills programming languages tools frameworks",
        "skills": "technical skills programming languages tools frameworks",
        "experience": "work experience internship job role responsibilities achievements",
        "education": "degree university college major GPA courses certification",
        "project": "project built developed created using technologies",
        "projects": "project built developed created using technologies",
    }
    
    expanded = question
    for key, value in expansions.items():
        if key in question.lower():
            expanded += f" {value}"
    
    return expanded

def search_closed_domain(question: str, user_id: str, top_k: int = 8) -> List[Dict[str, Any]]:
    """
    Search user's uploaded documents with query expansion for better results.
    """
    # Expand query for better retrieval
    expanded_question = expand_query(question)
    print(f"🔍 Original: {question[:50]}...", flush=True)
    print(f"🔍 Expanded: {expanded_question[:50]}...", flush=True)
    
    results = search_similar_chunks(expanded_question, user_id, top_k)
    return results
