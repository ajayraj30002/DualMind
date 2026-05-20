from typing import List, Dict, Any
from groq import Groq
from .closed_domain import search_closed_domain
from .open_domain import search_open_domain
from ..config import Config

# Initialize Groq client
groq_client = Groq(api_key=Config.GROQ_API_KEY)

def combine_sources(closed_results: List[Dict], open_results: List[Dict], max_sources: int = 10) -> List[Dict]:
    """Combine and deduplicate results from both sources"""
    
    all_sources = []
    
    # Add closed domain results
    for r in closed_results:
        r['source_type'] = '📁 My Documents'
        all_sources.append(r)
    
    # Add open domain results
    for r in open_results:
        r['source_type'] = '🌐 Web Search'
        all_sources.append(r)
    
    # Limit total sources
    return all_sources[:max_sources]

def generate_answer(question: str, sources: List[Dict]) -> str:
    """
    Generate a clean, natural answer using Groq LLM
    No source citations - just direct answers
    """
    
    if not sources:
        # No sources found - ask LLM to answer from its knowledge
        prompt = f"""You are DualMind, a helpful AI assistant. Answer the following question based on your knowledge. If you don't know, say so honestly.

Question: {question}

Answer:"""
    else:
        # Format sources without citations
        context_parts = []
        for source in sources:
            context_parts.append(source['content'])
        
        context = "\n\n---\n\n".join(context_parts)
        
        prompt = f"""You are DualMind, a helpful AI assistant. Answer the question based ONLY on the information below.

INFORMATION:
{context}

QUESTION: {question}

INSTRUCTIONS:
1. Answer naturally - don't mention "source" or "document"
2. Don't use phrases like "according to" or "based on"
3. Just give the answer directly
4. If the information doesn't contain the answer, say "I don't have enough information to answer that"

ANSWER:"""

    try:
        # Call Groq API
        completion = groq_client.chat.completions.create(
            model=Config.LLM_MODEL,
            messages=[
                {"role": "system", "content": "You are a helpful assistant that gives direct, natural answers without citing sources."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.3,
            max_tokens=1000
        )
        
        return completion.choices[0].message.content
        
    except Exception as e:
        return f"Error generating response: {str(e)}"

async def hybrid_search(question: str, user_id: str, search_type: str = "hybrid") -> Dict[str, Any]:
    """
    Perform hybrid search based on specified type:
    - "closed": Only user's documents
    - "open": Only web search
    - "hybrid": Both sources
    """
    
    closed_results = []
    open_results = []
    
    # Get closed-domain results (user's documents)
    if search_type in ["closed", "hybrid"]:
        closed_results = search_closed_domain(question, user_id, top_k=4)
    
    # Get open-domain results (web search)
    if search_type in ["open", "hybrid"]:
        open_results = search_open_domain(question, top_k=4)
    
    # Combine sources
    all_sources = combine_sources(closed_results, open_results)
    
    # Generate clean answer
    answer = generate_answer(question, all_sources)
    
    # Prepare sources for response (for debugging, not shown to user)
    response_sources = []
    for source in all_sources[:4]:
        response_sources.append({
            "type": source.get('source_type', 'Source'),
            "content": source.get('content', '')[:200],
            "filename": source.get('filename', ''),
            "url": source.get('url', '')
        })
    
    return {
        "answer": answer,
        "sources": response_sources,
        "search_type_used": search_type,
        "closed_source_count": len(closed_results),
        "open_source_count": len(open_results)
    }
