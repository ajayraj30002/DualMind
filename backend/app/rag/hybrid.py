from typing import List, Dict, Any, Optional
from groq import Groq
from .closed_domain import search_closed_domain
from .open_domain import search_open_domain
from ..config import Config

# Initialize Groq client
groq_client = Groq(api_key=Config.GROQ_API_KEY)

def combine_sources(closed_results: List[Dict], open_results: List[Dict], max_sources: int = 8) -> List[Dict]:
    """Combine and deduplicate results from both sources"""
    
    all_sources = []
    
    # Add closed domain results (user documents) - PRIORITY
    for r in closed_results:
        r['source_type'] = '📁 My Documents'
        r['priority'] = 1  # Higher priority
        all_sources.append(r)
    
    # Add open domain results (web search)
    for r in open_results:
        r['source_type'] = '🌐 Web Search'
        r['priority'] = 2  # Lower priority
        all_sources.append(r)
    
    # Return limited sources
    return all_sources[:max_sources]

def generate_answer(question: str, sources: List[Dict], conversation_context: Optional[str] = None) -> str:
    """
    Generate a polite, helpful answer using Groq LLM
    """
    
    # Build conversation context if available
    context_section = ""
    if conversation_context:
        context_section = f"""Previous conversation:
{conversation_context}

"""
    
    if not sources:
        # Polite response when no information found
        prompt = f"""{context_section}You are DualMind, a friendly, warm, and helpful AI assistant. 

The user asked: "{question}"

I don't have any relevant documents or web search results to answer this question.

Please respond kindly explaining that you need more information. Keep it concise and helpful."""
    else:
        # Format sources - prioritize document sources
        context_parts = []
        
        # Separate document sources and web sources
        doc_sources = [s for s in sources if s.get('source_type') == '📁 My Documents']
        web_sources = [s for s in sources if s.get('source_type') == '🌐 Web Search']
        
        # Put document sources first (they have priority)
        ordered_sources = doc_sources + web_sources
        
        for idx, source in enumerate(ordered_sources[:5], 1):
            content = source.get('content', '')
            source_type = source.get('source_type', 'Source')
            
            # Truncate if too long for memory efficiency
            if len(content) > 1000:
                content = content[:1000] + "..."
            
            context_parts.append(f"[Source {idx}] {content}")
        
        doc_context = "\n\n---\n\n".join(context_parts)
        
        prompt = f"""{context_section}You are DualMind, a helpful AI assistant.

Here is information to answer the user's question:

{doc_context}

Current question: "{question}"

Instructions:
1. Answer based ONLY on the information above
2. If the information includes documents, prioritize that over web results
3. Be concise and helpful (max 250 words)
4. If unsure about something, say so politely

Your answer:"""

    try:
        completion = groq_client.chat.completions.create(
            model=Config.LLM_MODEL,
            messages=[
                {"role": "system", "content": "You are DualMind, a helpful AI assistant. Be concise, accurate, and friendly."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.7,
            max_tokens=400  # Limit tokens for faster response
        )
        
        return completion.choices[0].message.content.strip()
        
    except Exception as e:
        print(f"Groq error: {e}")
        if sources:
            return "I found some information that might help. Could you please rephrase your question more specifically?"
        else:
            return "I don't have enough information to answer that. Please upload a relevant PDF or try a different question."

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
    - "hybrid": Both sources (documents take priority)
    """
    
    closed_results = []
    open_results = []
    
    # Get closed-domain results (user's documents) - ALWAYS try this first for hybrid/closed
    if search_type in ["closed", "hybrid"]:
        try:
            closed_results = search_closed_domain(question, user_id, top_k=4)
            print(f"📁 Documents found: {len(closed_results)} results")
        except Exception as e:
            print(f"Document search error: {e}")
            closed_results = []
    
    # Get open-domain results (web search) - ONLY for open/hybrid modes
    # For hybrid mode, only do web search if document results are insufficient
    if search_type in ["open", "hybrid"]:
        # In hybrid mode, only search web if we have fewer than 2 document results
        if search_type == "hybrid" and len(closed_results) >= 2:
            print("🌐 Skipping web search - sufficient document results found")
        else:
            try:
                open_results = search_open_domain(question, top_k=3)
                print(f"🌐 Web results: {len(open_results)} results")
            except Exception as e:
                print(f"Web search error: {e}")
                open_results = []
    
    # Combine sources (documents prioritized)
    all_sources = combine_sources(closed_results, open_results)
    
    # Generate answer with context
    answer = generate_answer(question, all_sources, conversation_context)
    
    # Prepare clean sources for response
    response_sources = []
    for source in all_sources[:3]:
        source_type = source.get('source_type', 'Source')
        
        if source_type == '📁 My Documents':
            display_name = source.get('filename', 'Document')[:40]
        else:
            display_name = source.get('title', source.get('url', 'Web'))[:40]
        
        response_sources.append({
            "type": source_type,
            "title": display_name,
            "content": source.get('content', '')[:150],
            "url": source.get('url', '')
        })
    
    return {
        "answer": answer,
        "sources": response_sources,
        "search_type_used": search_type,
        "closed_source_count": len(closed_results),
        "open_source_count": len(open_results)
    }
