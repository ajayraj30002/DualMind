# hybrid.py - Optimized for DualMind

import json
import os
import re
from typing import Any, Dict, List, Optional

import httpx
from groq import Groq

try:
    from .closed_domain import search_closed_domain
except ImportError:
    from ..vector_store import search_similar_chunks

    def search_closed_domain(question: str, user_id: str, top_k: int = 5, filename: Optional[str] = None):
        return search_similar_chunks(question, user_id, top_k=top_k, filename=filename)

try:
    from .open_domain import search_open_domain
except ImportError:
    def search_open_domain(question: str, top_k: int = 3):
        return []

try:
    from .closed_domain import supabase as closed_supabase
except ImportError:
    closed_supabase = None

from ..config import Config

groq_client = Groq(api_key=Config.GROQ_API_KEY)

MAX_RERANK_CANDIDATES = int(os.getenv("MAX_RERANK_CANDIDATES", "10"))
MAX_RERANK_DOC_CHARS = int(os.getenv("MAX_RERANK_DOC_CHARS", "1200"))
MIN_RELEVANCE_SCORE = float(os.getenv("MIN_RELEVANCE_SCORE", "0.1"))
MIN_USEFUL_PDF_SCORE = float(os.getenv("MIN_USEFUL_PDF_SCORE", "0.15"))

# ─────────────────────────────────────────────
# FAST PATTERN MATCHING (90% OF QUERIES)
# ─────────────────────────────────────────────

def detect_intent_fast(question: str, has_file: bool = False) -> Dict[str, str]:
    """Fast pattern matching for common queries - NO LLM CALL"""
    q = question.lower().strip().rstrip("?!")

    # 1. Casual chat (instant response)
    casual = ['hi', 'hello', 'hey', 'thanks', 'thank you', 'great', 'bye', 'goodbye', 
              'how are you', 'what\'s up', 'good morning', 'good evening']
    if any(q.startswith(word) for word in casual):
        return {"intent": "CASUAL_CHAT", "retrieval_mode": "none", "rewritten_query": question}

    # 2. Document summary (with file)
    if has_file:
        summary_words = ['summarize', 'summarise', 'what is this', 'explain this', 
                        'describe this', 'overview', 'tell me about this']
        if any(q.startswith(word) for word in summary_words):
            return {"intent": "SUMMARIZE", "retrieval_mode": "full_document", "rewritten_query": "document summary"}

    # 3. Generate notes (with file)
    if has_file:
        note_words = ['make notes', 'bullet points', 'key points', 'create notes']
        if any(q.startswith(word) for word in note_words):
            return {"intent": "GENERATE_NOTES", "retrieval_mode": "full_document", "rewritten_query": "key points"}

    # 4. Compare
    if any(word in q for word in ['compare', 'difference between', 'vs', 'versus']):
        return {"intent": "COMPARE", "retrieval_mode": "rag", "rewritten_query": question[:60]}

    # 5. Web search (only if no file attached)
    web_words = ['news', 'weather', 'today', 'current', 'latest', 'price', 'stock', 'cricket', 'football']
    if not has_file and any(word in q for word in web_words):
        return {"intent": "WEB_SEARCH", "retrieval_mode": "web", "rewritten_query": question}

    # 6. Default: factual lookup - extract keywords
    words = re.findall(r'\b[a-zA-Z0-9]+\b', q)
    stop_words = {'what', 'is', 'are', 'the', 'a', 'an', 'of', 'to', 'in', 'for', 'on', 
                  'with', 'by', 'from', 'list', 'tell', 'me', 'about', 'give', 'can', 'you'}
    keywords = [w for w in words if w.lower() not in stop_words]
    rewritten = " ".join(keywords[:8]) if keywords else q[:50]
    
    return {"intent": "FACTUAL_LOOKUP", "retrieval_mode": "rag", "rewritten_query": rewritten}


def is_complex_query(question: str, conversation_context: Optional[str]) -> bool:
    """Determine if query needs LLM for intent detection"""
    q = question.lower()
    
    # Complex query indicators
    complex_indicators = [
        'but', 'however', 'although', 'whereas',  # Conditional logic
        'referring to', 'as we discussed', 'earlier you said',  # Conversation recall
        'what did we', 'remind me', 'you mentioned',  # Memory-based
        'compare and contrast', 'difference between',  # Complex comparison
        'analyze', 'evaluate', 'critique'  # Complex analysis
    ]
    
    # Use LLM if:
    # 1. Has complex indicators
    if any(indicator in q for indicator in complex_indicators):
        return True
    
    # 2. Long conversation context (>500 chars) AND question is vague
    if conversation_context and len(conversation_context) > 500:
        vague_words = ['it', 'that', 'this', 'there', 'those', 'these']
        if len(q.split()) < 8 and any(word in q.split() for word in vague_words):
            return True
    
    # 3. Question is very long and complex
    if len(q.split()) > 20:
        return True
    
    return False


def route_with_llm(question: str, filename: Optional[str], conversation_context: Optional[str]) -> Dict[str, str]:
    """Use LLM for complex intent detection (only when needed)"""
    
    context_section = ""
    if conversation_context:
        context_section = f"Previous conversation (last 1000 chars):\n{conversation_context[-1000:]}\n\n"
    
    file_info = f"Attached file: {filename}" if filename else "No file attached"
    
    prompt = f"""{context_section}{file_info}

Current user question: "{question}"

Classify this query into ONE intent:

INTENTS:
- FACTUAL_LOOKUP: Specific question about document content (e.g., "What are the skills?", "Find contact info")
- SUMMARIZE: Vague document questions (e.g., "What is this?", "Summarize", "Explain this")
- GENERATE_NOTES: "Make notes", "Bullet points", "Key points"
- COMPARE: "Compare", "Difference between", "VS"
- WEB_SEARCH: Current events, news, live data, external info
- CASUAL_CHAT: Greetings, thanks, chitchat
- CONVERSATION_RECALL: References to previous discussion ("Earlier you said", "As we discussed")

Also provide:
- retrieval_mode: "rag", "full_document", "web", or "none"
- rewritten_query: Short keyword query for search (5-10 words max)

Return ONLY JSON: {{"intent": "", "retrieval_mode": "", "rewritten_query": ""}}"""

    try:
        completion = groq_client.chat.completions.create(
            model=Config.LLM_MODEL,
            messages=[
                {"role": "system", "content": "Return only valid JSON. No markdown, no explanation."},
                {"role": "user", "content": prompt}
            ],
            temperature=0,
            max_tokens=120,
        )
        raw = completion.choices[0].message.content.strip()
        raw = raw.replace("```json", "").replace("```", "").strip()
        parsed = json.loads(raw)
        
        return {
            "intent": parsed.get("intent", "FACTUAL_LOOKUP").upper(),
            "retrieval_mode": parsed.get("retrieval_mode", "rag").lower(),
            "rewritten_query": parsed.get("rewritten_query", question)[:60]
        }
    except Exception as e:
        print(f"LLM router error: {e}")
        return None


def route_query(
    question: str,
    filename: Optional[str] = None,
    conversation_context: Optional[str] = None,
    search_type: str = "hybrid",
) -> Dict[str, str]:
    """
    Hybrid routing: Use fast pattern matching first, LLM only for complex queries.
    """
    has_file = filename is not None
    
    # Check if query needs LLM
    needs_llm = is_complex_query(question, conversation_context)
    
    if not needs_llm:
        # Fast path - 90% of queries
        result = detect_intent_fast(question, has_file)
        print(f"⚡ Fast router → {result['intent']} | {result['retrieval_mode']}")
        return result
    
    # Complex path - use LLM
    print(f"🧠 Complex query detected - using LLM router")
    llm_result = route_with_llm(question, filename, conversation_context)
    
    if llm_result:
        return llm_result
    
    # Fallback to fast router if LLM fails
    return detect_intent_fast(question, has_file)


# ─────────────────────────────────────────────
# REST OF YOUR EXISTING CODE...
# (keep your existing fetch_full_document, 
#  generate_conversational_answer, 
#  generate_full_document_answer,
#  get_score, filter_results_by_relevance,
#  check_pdf_quality, _dedupe_sources,
#  rerank_with_cohere, generate_answer,
#  and hybrid_search function)
# ─────────────────────────────────────────────

# ... [Keep all your existing helper functions here] ...


async def hybrid_search(
    question: str,
    user_id: str,
    search_type: str = "hybrid",
    conversation_context: Optional[str] = None,
    filename: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Main entry point - uses hybrid routing for intent detection.
    """
    search_type = (search_type or "hybrid").lower()
    if search_type not in {"closed", "open", "hybrid"}:
        search_type = "hybrid"

    print(f"\n{'='*50}")
    print(f"📝 Query: {question[:80]}")
    print(f"📎 File: {filename or 'None'}")
    print(f"{'='*50}")

    # Route the query (uses fast pattern matching or LLM)
    route = route_query(
        question=question,
        filename=filename,
        conversation_context=conversation_context,
        search_type=search_type,
    )
    
    intent = route["intent"]
    retrieval_mode = route["retrieval_mode"]
    rewritten_query = route["rewritten_query"]
    
    print(f"🎯 Intent: {intent} | Mode: {retrieval_mode}")
    print(f"🔍 Rewritten: {rewritten_query}")

    # Override based on explicit search_type
    if search_type == "closed":
        retrieval_mode = "full_document" if intent in ("SUMMARIZE", "GENERATE_NOTES") else "rag"
    elif search_type == "open":
        retrieval_mode = "web"

    # CASUAL CHAT - no retrieval needed
    if retrieval_mode == "none" or intent in ("CASUAL_CHAT", "CONVERSATION_RECALL"):
        return {
            "answer": generate_conversational_answer(question, conversation_context),
            "sources": [],
            "search_type_used": "Conversation",
            "closed_source_count": 0,
            "open_source_count": 0,
            "rewritten_query": question,
        }

    # FULL DOCUMENT mode
    if retrieval_mode == "full_document" and filename:
        full_text = fetch_full_document(user_id, filename)
        if full_text:
            answer = generate_full_document_answer(
                question=question,
                full_text=full_text,
                filename=filename,
                intent=intent,
                conversation_context=conversation_context,
            )
            return {
                "answer": answer,
                "sources": [{"type": "PDF Document", "title": filename, "content": full_text[:200]}],
                "search_type_used": "PDF Document",
                "closed_source_count": 1,
                "open_source_count": 0,
                "rewritten_query": rewritten_query,
            }

    # RAG mode
    closed_results = []
    open_results = []

    if retrieval_mode == "rag":
        try:
            closed_results = search_closed_domain(rewritten_query, user_id, top_k=8, filename=filename)
            print(f"📄 PDF results: {len(closed_results)}")
            
            if closed_results:
                for r in closed_results[:2]:
                    score = get_score(r)
                    print(f"   - Score: {score:.3f} | File: {r.get('filename', 'Unknown')[:30]}")
        except Exception as e:
            print(f"PDF search error: {e}")

        # Web fallback if no PDF results
        if search_type == "hybrid" and len(closed_results) == 0:
            try:
                open_results = search_open_domain(rewritten_query, top_k=3)
                print(f"🌐 Web results: {len(open_results)}")
            except Exception as e:
                print(f"Web search error: {e}")

    elif retrieval_mode == "web":
        try:
            open_results = search_open_domain(rewritten_query, top_k=3)
            print(f"🌐 Web results: {len(open_results)}")
        except Exception as e:
            print(f"Web search error: {e}")

    # Build sources
    all_sources = []
    for result in closed_results:
        result["source_type"] = "PDF Document"
        all_sources.append(result)
    for result in open_results:
        result["source_type"] = "Web Search"
        all_sources.append(result)

    # Generate answer
    answer = generate_answer(question, all_sources, conversation_context)

    # Build response sources
    response_sources = []
    for source in all_sources[:3]:
        response_sources.append({
            "type": source.get("source_type", "Unknown"),
            "title": source.get("filename", source.get("title", "Source"))[:40],
            "content": source.get("content", "")[:200],
        })

    mode_used = "PDF Document" if closed_results else ("Web Search" if open_results else "General Knowledge")

    return {
        "answer": answer,
        "sources": response_sources,
        "search_type_used": mode_used,
        "closed_source_count": len(closed_results),
        "open_source_count": len(open_results),
        "rewritten_query": rewritten_query,
    }


# Keep all your existing helper functions here
# (generate_conversational_answer, generate_full_document_answer,
#  get_score, filter_results_by_relevance, check_pdf_quality,
#  _dedupe_sources, rerank_with_cohere, generate_answer)
