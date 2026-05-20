from typing import List, Dict, Any, Optional
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

def generate_answer(question: str, sources: List[Dict], conversation_context: Optional[str] = None) -> str:
    """
    Generate a clean, natural answer using Groq LLM
    Supports conversation context for follow-up questions
    """
    
    # Build conversation context if available
    context_section = ""
    if conversation_context:
        context_section = f"""PREVIOUS CONVERSATION:
{conversation_context}

"""
    
    if not sources:
        # No sources found - ask LLM to answer from its knowledge with context
        prompt = f"""{context_section}You are DualMind, a helpful AI assistant. Answer the following question based on your knowledge and the conversation history. If you don't know, say so honestly.

Current Question: {question}

Answer:"""
    else:
        # Format sources without citations
        context_parts = []
        for source in sources:
            context_parts.append(source['content'])
        
        doc_context = "\n\n---\n\n".join(context_parts)
        
        prompt = f"""{context_section}You are DualMind, a helpful AI assistant. Answer the question based ONLY on the information below and the conversation history.

INFORMATION FROM DOCUMENTS/WEB:
{doc_context}

CURRENT QUESTION: {question}

INSTRUCTIONS:
1. Answer naturally - don't mention "source" or "document"
2. Don't use phrases like "according to" or "based on"
3. Just give the answer directly
4. If the information doesn't contain the answer, say "I don't have enough information to answer that"
5. Use the conversation history to understand follow-up questions

ANSWER:"""

    try:
        # Call Groq API
        completion = groq_client.chat.completions.create(
            model=Config.LLM_MODEL,
            messages=[
                {"role": "system", "content": "You are a helpful assistant that gives direct, natural answers without citing sources. Use conversation history to understand context."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.3,
            max_tokens=1000
        )
        
        return completion.choices[0].message.content
        
    except Exception as e:
        return f"Error generating response: {str(e)}"

async def hybrid_search(
    question: str, 
    user_id: str, 
    search_type: str = "hybrid",
    conversation_context: Optional[str] = None
) -> Dict[str, Any]:
    """
    Perform hybrid search based on specified type:
    - "closed": Only user's documents
    - "open": Only web search
    - "hybrid": Both sources
    
    Args:
        question: User's question
        user_id: User ID for document search
        search_type: Type of search to perform
        conversation_context: Previous conversation for context
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
    
    # Generate answer with conversation context
    answer = generate_answer(question, all_sources, conversation_context)
    
    # Prepare sources for response (clean UI format)
    response_sources = []
    for source in all_sources[:4]:
        source_type = source.get('source_type', 'Source')
        # Clean up source display
        if source_type == '📁 My Documents':
            display_name = source.get('filename', 'Document')
        else:
            display_name = source.get('url', 'Web Search')
        
        response_sources.append({
            "type": source_type,
            "title": display_name,
            "content": source.get('content', '')[:200],
            "url": source.get('url', '')
        })
    
    return {
        "answer": answer,
        "sources": response_sources,
        "search_type_used": search_type,
        "closed_source_count": len(closed_results),
        "open_source_count": len(open_results)
    }
