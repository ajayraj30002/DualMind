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
Your personality: polite, patient, encouraging, and genuinely eager to help.

The user asked: "{question}"

However, I don't have any relevant documents or web search results to answer this question.

Please respond in a kind, helpful way that:
1. Politely explains that you don't have enough information right now
2. Suggests what the user could do (upload relevant documents or ask something else)
3. Maintains a warm, encouraging tone
4. Uses emojis occasionally to feel friendly 😊

Example tone: "I'm sorry, I don't have enough information to answer that question yet. Could you please upload a relevant PDF document, or try asking something else? I'm here to help! 💫"

Your response:"""
    else:
        # Format sources
        context_parts = []
        for source in sources:
            context_parts.append(source['content'])
        
        doc_context = "\n\n---\n\n".join(context_parts)
        
        prompt = f"""{context_section}You are DualMind, a friendly, warm, and helpful AI assistant.
Your personality: polite, patient, encouraging, and genuinely eager to help.

Information from documents/web:
{doc_context}

Current question: "{question}"

Instructions for your response:
1. Be warm, friendly, and polite - like a helpful friend
2. Answer naturally without mentioning "sources" or "documents"
3. If you're unsure about something, say so kindly
4. Use a positive, encouraging tone
5. Add emojis occasionally to feel warm and approachable 😊 ✨ 💫
6. If the information doesn't fully answer the question, offer to help further

Example tone: "Great question! Based on what I found... 💡 Let me know if you'd like more details!"

Your friendly response:"""

    try:
        completion = groq_client.chat.completions.create(
            model=Config.LLM_MODEL,
            messages=[
                {"role": "system", "content": "You are DualMind, a warm, friendly, and helpful AI assistant. You are always polite, patient, and encouraging. You never get frustrated or rude. You use a kind tone and occasional emojis to make users feel comfortable. You genuinely want to help and make the user feel good about asking questions."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.7,
            max_tokens=1000
        )
        
        return completion.choices[0].message.content
        
    except Exception as e:
        return f"😊 I'm having a small technical issue right now. Could you please try again? I'm here to help!"

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
    
    # Generate polite answer with conversation context
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
