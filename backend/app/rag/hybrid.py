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
    """Generate an answer using Groq LLM based on retrieved sources"""
    
    if not sources:
        prompt = f"""You are DualMind, a helpful AI assistant. Answer the following question based on your knowledge. If you don't know, say so honestly.

Question: {question}

Answer:"""
    else:
        # Format sources without citing source numbers
        context_parts = []
        for source in sources:
            context_parts.append(source['content'])
        
        context = "\n\n---\n\n".join(context_parts)
        
        prompt = f"""You are DualMind, a helpful AI assistant that answers questions based on the provided information.

Here are the relevant information from the documents:

{context}

Question: {question}

Instructions:
1. Answer based ONLY on the provided information
2. Do NOT mention "Source 1", "Source 2", or any source numbers
3. Do NOT say "According to the sources" or similar phrases
4. Just give a clean, natural answer as if you know the information
5. If the answer isn't in the information, say "I don't have enough information to answer that"

Answer:"""

    try:
        completion = groq_client.chat.completions.create(
            model=Config.LLM_MODEL,
            messages=[
                {"role": "system", "content": "You are a helpful assistant that provides clean, natural answers without citing sources or mentioning that you're reading from documents."},
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
        closed_results = search_closed_domain(question, user_id, top_k=5)
    
    # Get open-domain results (web search)
    if search_type in ["open", "hybrid"]:
        open_results = search_open_domain(question, top_k=5)
    
    # Combine sources
    all_sources = combine_sources(closed_results, open_results)
    
    # Generate answer
    answer = generate_answer(question, all_sources)
    
    # Prepare sources for response (without full content for brevity)
    response_sources = []
    for source in all_sources[:5]:  # Limit to 5 sources in response
        response_sources.append({
            "type": source.get('source_type', 'Source'),
            "content": source.get('content', '')[:300],  # Truncate for response
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
