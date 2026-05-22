from typing import List, Dict, Any, Optional
from groq import Groq
from .closed_domain import search_closed_domain
from .open_domain import search_open_domain
from ..config import Config

groq_client = Groq(api_key=Config.GROQ_API_KEY)

def generate_answer(question: str, sources: List[Dict], conversation_context: Optional[str] = None) -> str:
    """Generate answer using Groq LLM - PRIORITIZES PDF CONTENT 90%"""
    
    context_section = ""
    if conversation_context:
        context_section = f"Previous conversation:\n{conversation_context}\n\n"
    
    if not sources:
        prompt = f"""{context_section}The user asked: "{question}"

I have no information from any PDF documents.

Please respond: "I couldn't find any information about this in your uploaded PDF documents. Please make sure your PDF contains the relevant information or try uploading a different document."

Keep it concise and helpful."""
    else:
        # Separate PDF sources from web sources
        pdf_sources = [s for s in sources if s.get('source_type') == '📁 PDF Document']
        web_sources = [s for s in sources if s.get('source_type') == '🌐 Web Search']
        
        # Build context - PDF sources FIRST (90% priority)
        context_parts = []
        
        if pdf_sources:
            context_parts.append("📄 FROM YOUR UPLOADED PDF DOCUMENT(S):")
            for idx, source in enumerate(pdf_sources[:5], 1):
                content = source.get('content', '')
                filename = source.get('filename', 'Unknown')
                if len(content) > 1500:
                    content = content[:1500] + "..."
                context_parts.append(f"[PDF Document: {filename}]\n{content}")
        
        if web_sources and not pdf_sources:
            # Only use web if NO PDF results
            context_parts.append("\n🌐 FROM WEB SEARCH (no PDF found):")
            for idx, source in enumerate(web_sources[:3], 1):
                content = source.get('content', '')
                if len(content) > 800:
                    content = content[:800] + "..."
                context_parts.append(f"[Web Source {idx}]\n{content}")
        
        doc_context = "\n\n---\n\n".join(context_parts)
        
        prompt = f"""{context_section}Here is information from the user's uploaded PDF documents (PRIMARY SOURCE):

{doc_context}

The user asked: "{question}"

CRITICAL INSTRUCTIONS:
1. Answer based ONLY on the PDF DOCUMENTS above (90% priority)
2. If the PDF contains the answer, use it directly and quote from it
3. If the PDF does NOT contain the answer, say: "I couldn't find this information in your uploaded PDF document."
4. Do NOT use general knowledge or make up information
5. Be specific and cite what the PDF actually says
6. Keep your answer concise (2-3 sentences max unless more is needed)

Your answer based on the PDF:"""

    try:
        completion = groq_client.chat.completions.create(
            model=Config.LLM_MODEL,
            messages=[
                {"role": "system", "content": "You are a document search assistant. You ONLY answer based on the provided PDF content. NEVER use your own knowledge. If the answer isn't in the PDF, say so directly. Be concise."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.2,
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
    Perform search - PDF takes 90% priority in ALL modes
    """
    
    closed_results = []
    open_results = []
    
    print(f"🔍 Search type: {search_type}")
    
    # ALWAYS search PDFs first (for all modes except explicit 'open')
    if search_type != "open":
        try:
            closed_results = search_closed_domain(question, user_id, top_k=5)
            print(f"📁 PDF results: {len(closed_results)}")
            if closed_results:
                for r in closed_results[:2]:
                    print(f"   - From PDF: {r.get('filename', 'Unknown')}")
        except Exception as e:
            print(f"PDF search error: {e}")
    
    # Only search web if NO PDF results AND mode is not 'closed'
    if search_type == "open" or (search_type == "hybrid" and len(closed_results) == 0):
        try:
            open_results = search_open_domain(question, top_k=3)
            print(f"🌐 Web results: {len(open_results)}")
        except Exception as e:
            print(f"Web search error: {e}")
    
    # Combine - PDF sources FIRST (priority)
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
            display_name = source.get('filename', 'PDF Document')[:40]
        else:
            display_name = source.get('title', 'Web Result')[:40]
        
        response_sources.append({
            "type": source.get('source_type'),
            "title": display_name,
            "content": source.get('content', '')[:200],
            "url": source.get('url', '')
        })
    
    mode_used = "PDF Document" if closed_results else ("Web Search" if open_results else "No results")
    
    return {
        "answer": answer,
        "sources": response_sources,
        "search_type_used": mode_used,
        "closed_source_count": len(closed_results),
        "open_source_count": len(open_results)
    }
