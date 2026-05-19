from typing import List, Dict, Any
from ..vector_store import search_similar_chunks

def expand_query(question: str) -> str:
    """
    Expand query with relevant keywords for better retrieval.
    Helps overcome limitations of short or vague questions.
    """
    
    # Common expansion mappings
    expansions = {
        "skill": "technical skills programming languages tools frameworks",
        "skills": "technical skills programming languages tools frameworks",
        "experience": "work experience internship job role responsibilities achievements",
        "education": "degree university college major GPA courses certification",
        "project": "project built developed created using technologies",
        "projects": "project built developed created using technologies",
        "resume": "skills experience education projects achievements qualifications",
        "cover letter": "introduction background skills interest motivation qualifications",
        "policy": "rules guidelines requirements procedures regulations",
        "manual": "instructions steps directions specifications details",
    }
    
    expanded = question
    
    # Add expansions
    for key, value in expansions.items():
        if key in question.lower():
            expanded += f" {value}"
    
    # Don't expand too much (keep under 500 chars for API efficiency)
    if len(expanded) > 500:
        expanded = expanded[:500]
    
    return expanded

def search_closed_domain(question: str, user_id: str, top_k: int = 5) -> List[Dict[str, Any]]:
    """
    Search user's uploaded documents with query expansion for better results.
    
    Args:
        question: User's question string
        user_id: UUID of the authenticated user
        top_k: Number of top results to return (default: 5)
    
    Returns:
        List of relevant document chunks with metadata
    """
    # Expand query for better retrieval
    expanded_question = expand_query(question)
    
    # Only log if expansion actually changed something
    if expanded_question != question:
        print(f"🔍 Original: {question[:60]}...", flush=True)
        print(f"🔍 Expanded: {expanded_question[:60]}...", flush=True)
    else:
        print(f"🔍 Searching: {question[:60]}...", flush=True)
    
    # Search using Cohere-powered vector store
    results = search_similar_chunks(expanded_question, user_id, top_k)
    
    return results
