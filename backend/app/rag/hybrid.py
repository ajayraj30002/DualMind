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
# FAST PATTERN-BASED INTENT DETECTION
# ─────────────────────────────────────────────

def detect_intent_fast(question: str, has_file: bool = False) -> Dict[str, str]:
    """Fast pattern matching for common queries - NO LLM CALL"""
    q = question.lower().strip().rstrip("?!")

    # 1. Casual chat
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


def route_query(
    question: str,
    filename: Optional[str] = None,
    conversation_context: Optional[str] = None,
    search_type: str = "hybrid",
) -> Dict[str, str]:
    """Route query using fast pattern matching"""
    has_file = filename is not None
    result = detect_intent_fast(question, has_file)
    print(f"⚡ Fast router → {result['intent']} | {result['retrieval_mode']}")
    return result


# ─────────────────────────────────────────────
# FULL DOCUMENT FETCH
# ─────────────────────────────────────────────

def fetch_full_document(user_id: str, filename: str) -> str:
    """Fetch all chunks for a file in order and reconstruct full text."""
    try:
        sb = None
        try:
            from ..vector_store import supabase as vs_supabase
            sb = vs_supabase
        except ImportError:
            pass

        if sb is None and closed_supabase is not None:
            sb = closed_supabase

        if sb is None:
            print("fetch_full_document: no supabase client available")
            return ""

        response = sb.table("document_chunks") \
            .select("chunk_text, chunk_index") \
            .eq("user_id", user_id) \
            .eq("filename", filename) \
            .order("chunk_index") \
            .execute()

        if not response.data:
            return ""

        full_text = "\n".join([c["chunk_text"] for c in response.data])
        print(f"📄 Full document fetched: {len(response.data)} chunks, {len(full_text)} chars")

        if len(full_text) > 14000:
            full_text = full_text[:14000] + "\n...[document truncated]"

        return full_text

    except Exception as e:
        print(f"fetch_full_document error: {e}")
        return ""


# ─────────────────────────────────────────────
# ANSWER GENERATORS
# ─────────────────────────────────────────────

def generate_conversational_answer(question: str, conversation_context: Optional[str] = None) -> str:
    """Simple plain text response for casual chat."""
    prompt = f"""User: "{question}"
Respond naturally, no markdown, just friendly conversation."""

    try:
        completion = groq_client.chat.completions.create(
            model=Config.LLM_MODEL,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.5,
            max_tokens=150,
        )
        return completion.choices[0].message.content.strip()
    except Exception as e:
        print(f"Conversational answer error: {e}")
        return "Hello! How can I help you today?"


def generate_full_document_answer(
    question: str,
    full_text: str,
    filename: str,
    intent: str,
    conversation_context: Optional[str] = None,
) -> str:
    """Generate answer using full document text."""
    
    prompt = f"""Document "{filename}":

{full_text[:8000]}

User asked: "{question}"

Answer using ONLY the document above.
Use ## headers and - bullet points for organization.
If the answer is not in the document, say "I cannot find this information."

Answer:"""

    try:
        completion = groq_client.chat.completions.create(
            model=Config.LLM_MODEL,
            messages=[
                {"role": "system", "content": "You summarize documents clearly. Use ## headers and - bullet points."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.4,
            max_tokens=1000,
        )
        return completion.choices[0].message.content.strip()
    except Exception as e:
        print(f"Full document answer error: {e}")
        return "I had trouble processing the document."


# ─────────────────────────────────────────────
# SCORE HANDLING FUNCTIONS
# ─────────────────────────────────────────────

def get_score(result: Dict[str, Any]) -> float:
    """Extract score from result - handles multiple field names."""
    # Try different field names that might contain the score
    score_fields = ["similarity", "score", "keyword_score", "relevance_score", "rerank_score"]
    for field in score_fields:
        if field in result and result[field] is not None:
            val = float(result[field])
            if val > 0:
                return val
    # Default score if none found (assume moderately relevant)
    return 0.3


def filter_results_by_relevance(
    results: List[Dict[str, Any]], min_score: float = MIN_RELEVANCE_SCORE
) -> List[Dict[str, Any]]:
    """Filter results by relevance score."""
    if not results:
        return []
    
    # Ensure all results have scores
    for r in results:
        if "extracted_score" not in r:
            r["extracted_score"] = get_score(r)
    
    # If min_score is low or we have few results, keep them
    if min_score <= 0.1 or len(results) <= 2:
        return results
    
    filtered = [r for r in results if r.get("extracted_score", 0) >= min_score]
    
    # If filtering removed everything, return top 2 anyway
    if not filtered and results:
        print(f"⚠️ Keeping top {min(2, len(results))} results despite low scores")
        return results[:2]
    
    return filtered


def check_pdf_quality(results: List[Dict[str, Any]], min_useful_score: float = MIN_USEFUL_PDF_SCORE) -> tuple[bool, float]:
    """Check if PDF results are useful."""
    if not results:
        return False, 0.0
    
    max_score = max([get_score(r) for r in results], default=0.0)
    # Always consider results useful if we have at least 1 result
    has_useful = len(results) >= 1
    
    return has_useful, max_score


def _dedupe_sources(sources: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Remove duplicate sources."""
    seen = set()
    unique = []
    for source in sources:
        key = (
            source.get("filename", ""),
            source.get("url", ""),
            source.get("content", "")[:160],
        )
        if key in seen:
            continue
        seen.add(key)
        unique.append(source)
    return unique


def rerank_with_cohere(query: str, sources: List[Dict[str, Any]], top_n: int = 5) -> List[Dict[str, Any]]:
    """Rerank with Cohere (optional)."""
    api_key = getattr(Config, "COHERE_API_KEY", None) or os.getenv("COHERE_API_KEY")
    if not api_key or len(sources) <= 1:
        return sources[:top_n]

    candidates = sources[:MAX_RERANK_CANDIDATES]
    documents = [(source.get("content") or "")[:MAX_RERANK_DOC_CHARS] for source in candidates]

    try:
        response = httpx.post(
            "https://api.cohere.com/v2/rerank",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": getattr(Config, "COHERE_RERANK_MODEL", os.getenv("COHERE_RERANK_MODEL", "rerank-v3.5")),
                "query": query,
                "documents": documents,
                "top_n": min(top_n, len(candidates)),
            },
            timeout=6.0,
        )
        response.raise_for_status()
        ranked = []
        for item in response.json().get("results", []):
            idx = item.get("index")
            if idx is None or idx >= len(candidates):
                continue
            source = dict(candidates[idx])
            source["rerank_score"] = item.get("relevance_score", 0)
            source["extracted_score"] = source["rerank_score"]
            ranked.append(source)
        return ranked or sources[:top_n]
    except Exception as e:
        print(f"Cohere rerank error: {e}")
        return sources[:top_n]


def generate_answer(question: str, sources: List[Dict], conversation_context: Optional[str] = None) -> str:
    """Generate answer from sources."""
    
    if not sources:
        prompt = f"""User asked: "{question}"

Answer based on your general knowledge. If unsure, say so honestly.

Answer:"""
    else:
        context_parts = []
        for i, source in enumerate(sources[:3]):
            content = source.get("content", "")[:1000]
            source_type = source.get("source_type", "Document")
            context_parts.append(f"[{source_type}]\n{content}")
        
        context = "\n\n---\n\n".join(context_parts)
        
        prompt = f"""Context information:
{context}

User question: "{question}"

Answer using the context above. 
- Use ## headers for sections
- Use - bullet points for lists
- Be clear and direct

Answer:"""

    try:
        completion = groq_client.chat.completions.create(
            model=Config.LLM_MODEL,
            messages=[
                {"role": "system", "content": "You answer questions clearly. Use ## headers and - bullet points. Be direct and helpful."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.4,
            max_tokens=1000,
        )
        answer = completion.choices[0].message.content.strip()
        
        # Ensure answer has proper formatting
        if len(answer) > 200 and '##' not in answer and '# ' not in answer:
            answer = "## Answer\n\n" + answer
            
        return answer
    except Exception as e:
        print(f"Generate answer error: {e}")
        return "I had trouble processing your request. Please try again."


# ─────────────────────────────────────────────
# MAIN ENTRY POINT
# ─────────────────────────────────────────────

async def hybrid_search(
    question: str,
    user_id: str,
    search_type: str = "hybrid",
    conversation_context: Optional[str] = None,
    filename: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Main entry point for hybrid search.
    """
    search_type = (search_type or "hybrid").lower()
    if search_type not in {"closed", "open", "hybrid"}:
        search_type = "hybrid"

    print(f"\n{'='*50}")
    print(f"📝 Query: {question[:80]}")
    print(f"📎 File: {filename or 'None'}")
    print(f"{'='*50}")

    # Route the query
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
        else:
            print("Full document fetch failed - falling back to RAG")
            retrieval_mode = "rag"

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

    if len(all_sources) > 1:
        all_sources = _dedupe_sources(all_sources)

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
