# rag/hybrid.py
from typing import List, Dict, Any, Optional
from groq import Groq
from .closed_domain import search_closed_domain
from .open_domain import search_open_domain
from ..config import Config

groq_client = Groq(api_key=Config.GROQ_API_KEY)

def generate_answer(question: str, sources: List[Dict], conversation_context: Optional[str] = None) -> str:
    """Generate answer using Groq LLM - PRIORITIZES PDF CONTENT"""
    
    context_section = ""
    if conversation_context:
        context_section = f"""Previous conversation:
{conversation_context}

"""
    
    if not sources:
        prompt = f"""{context_section}The user asked: "{question}"

I have no information from documents or web search to answer this question.

Please respond: "I couldn't find any information about this in your uploaded documents. Please make sure your PDF contains the relevant information or try rephrasing your question." Keep it concise."""
    else:
        # Build context from sources
        context_parts = []
        for idx, source in enumerate(sources[:5], 1):
            content = source.get('content', '')
            source_type = source.get('source_type', 'Source')
            
            if len(content) > 1500:
                content = content[:1500] + "..."
            
            context_parts.append(f"[Source {idx} - {source_type}]\n{content}")
        
        doc_context = "\n\n---\n\n".join(context_parts)
        
        prompt = f"""{context_section}Here is information from the user's uploaded PDF documents:

{doc_context}

The user asked: "{question}"

IMPORTANT INSTRUCTIONS:
1. Answer ONLY based on the information above from the PDF documents
2. Do NOT make up or hallucinate any information not found in the documents
3. If the exact answer is not in the documents, say "I couldn't find this information in the uploaded PDF"
4. Be concise and direct - no generic advice
5. Quote specific information from the documents when possible

Your answer based ONLY on the PDF content:"""

    try:
        completion = groq_client.chat.completions.create(
            model=Config.LLM_MODEL,
            messages=[
                {"role": "system", "content": "You are a document search assistant. You ONLY answer based on the provided document content. NEVER make up information. If the answer isn't in the documents, say so directly."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.3,  # Lower temperature = less hallucination
            max_tokens=500
        )
        
        return completion.choices[0].message.content.strip()
        
    except Exception as e:
        print(f"Groq error: {e}")
        return "I had trouble processing your request. Please try again."

async def hybrid_search(
    question: str, 
    user_id: str, 
    search_type: str = "hybrid",
    conversation_context: Optional[str] = None
) -> Dict[str, Any]:
    """
    Perform search based on type:
    - "closed": ONLY user's documents (PDFs) - HIGHEST PRIORITY
    - "open": Only web search
    - "hybrid": Both (but documents take priority)
    """
    
    closed_results = []
    open_results = []
    
    print(f"🔍 Search type requested: {search_type}")
    
    # ALWAYS search closed domain for 'closed' or 'hybrid'
    if search_type in ["closed", "hybrid"]:
        try:
            closed_results = search_closed_domain(question, user_id, top_k=5)
            print(f"📁 Closed domain (PDF) results: {len(closed_results)}")
            if closed_results:
                for r in closed_results[:2]:
                    print(f"   - From: {r.get('filename', 'Unknown')}")
        except Exception as e:
            print(f"Closed domain error: {e}")
    
    # ONLY search web if explicitly 'open' mode or 'hybrid' with NO document results
    if search_type == "open":
        try:
            open_results = search_open_domain(question, top_k=3)
            print(f"🌐 Web results: {len(open_results)}")
        except Exception as e:
            print(f"Web search error: {e}")
    elif search_type == "hybrid" and len(closed_results) == 0:
        # Only search web if no documents found
        try:
            open_results = search_open_domain(question, top_k=3)
            print(f"🌐 Web results (fallback): {len(open_results)}")
        except Exception as e:
            print(f"Web search error: {e}")
    
    # Combine sources - documents FIRST
    all_sources = []
    for r in closed_results:
        r['source_type'] = '📁 PDF Document'
        all_sources.append(r)
    for r in open_results:
        r['source_type'] = '🌐 Web Search'
        all_sources.append(r)
    
    # Generate answer
    answer = generate_answer(question, all_sources, conversation_context)
    
    # Prepare response sources
    response_sources = []
    for source in all_sources[:3]:
        if source.get('source_type') == '📁 PDF Document':
            display_name = source.get('filename', 'PDF Document')[:50]
        else:
            display_name = source.get('title', 'Web Result')[:50]
        
        response_sources.append({
            "type": source.get('source_type'),
            "title": display_name,
            "content": source.get('content', '')[:200],
            "url": source.get('url', '')
        })
    
    return {
        "answer": answer,
        "sources": response_sources,
        "search_type_used": "closed (PDF only)" if closed_results and search_type != "open" else search_type,
        "closed_source_count": len(closed_results),
        "open_source_count": len(open_results)
    }
