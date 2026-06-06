import json
import os
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
MIN_RELEVANCE_SCORE = float(os.getenv("MIN_RELEVANCE_SCORE", "0.2"))
# New: Minimum score to consider PDF results "useful" (prevents hallucination)
MIN_USEFUL_PDF_SCORE = float(os.getenv("MIN_USEFUL_PDF_SCORE", "0.3"))

# ─────────────────────────────────────────────
# AGENTIC ROUTER
# One Groq call that does 3 jobs:
#   1. Classify intent
#   2. Decide retrieval mode
#   3. Rewrite query (handles follow-ups too)
# ─────────────────────────────────────────────

VALID_INTENTS = {
    "FACTUAL_LOOKUP",
    "SUMMARIZE",
    "GENERATE_NOTES",
    "COMPARE",
    "WEB_SEARCH",
    "CASUAL_CHAT",
    "CONVERSATION_RECALL",
}

VALID_RETRIEVAL_MODES = {"rag", "full_document", "web", "none"}

# Keywords that should trigger web search even with a file attached
WEB_OVERRIDE_KEYWORDS = {
    "exam", "entry", "requirements", "application", "admission", "fees",
    "dates", "result", "score", "ranking", "cutoff", "eligibility",
    "syllabus", "pattern", "selection process", "afcat", "nda", "cds", "upsc",
    "weather", "news", "today", "current", "latest", "price", "stock",
    "match score", "live", "breaking", "update"
}


def route_query(
    question: str,
    filename: Optional[str] = None,
    conversation_context: Optional[str] = None,
    search_type: str = "hybrid",
) -> Dict[str, str]:
    """
    Single Groq call that acts as the agentic brain.
    Returns intent, retrieval_mode, and rewritten_query.
    Replaces both classify_query_intent() and rewrite_query_for_retrieval().
    """
    trimmed_context = (conversation_context or "")[-3000:]
    file_info = f"Attached file: {filename}" if filename else "No file attached."
    search_hint = ""
    if search_type == "closed":
        search_hint = "User explicitly wants document search only."
    elif search_type == "open":
        search_hint = "User explicitly wants web search only."

    prompt = f"""You are an intelligent query router for a hybrid RAG assistant.

{file_info}
{search_hint}

Recent conversation:
{trimmed_context or "none"}

Latest user message: "{question}"

Your job:
1. Classify the intent into exactly one of:
   - FACTUAL_LOOKUP   : specific question about the document or a known topic
   - SUMMARIZE        : vague queries like "whats this", "explain", "describe", "what is this", "overview", "tell me about this"
   - GENERATE_NOTES   : "make notes", "bullet points", "key points", "summarize as notes"
   - COMPARE          : "compare", "difference between", "vs"
   - WEB_SEARCH       : needs current/live info — news, weather, prices, latest events, exam details, entry requirements, application process, fees, admission dates, results, scores, rankings, or any time-sensitive information
   - CASUAL_CHAT      : greetings, thanks, chitchat, "how are you", "bye"
   - CONVERSATION_RECALL : "what did we discuss", "earlier you said", "remind me"

2. Choose retrieval_mode:
   - "rag"           : for FACTUAL_LOOKUP, COMPARE (use vector + keyword search)
   - "full_document" : for SUMMARIZE, GENERATE_NOTES (skip similarity search, use all chunks)
   - "web"           : for WEB_SEARCH
   - "none"          : for CASUAL_CHAT, CONVERSATION_RECALL

3. Rewrite the query into a clean standalone retrieval query:
   - Resolve pronouns using conversation (e.g. "he" → actual name from context)
   - For SUMMARIZE/GENERATE_NOTES: use "document overview summary main topics introduction"
   - For FACTUAL_LOOKUP: make it a specific searchable question
   - For CASUAL_CHAT/CONVERSATION_RECALL: return the original question unchanged

IMPORTANT RULES:
- If a file is attached, PREFER WEB_SEARCH when the question asks for exam details, current information, or time-sensitive data (even if the file might contain something else)
- If a file is attached and query is vague ("whats this", "explain") and NOT time-sensitive, choose SUMMARIZE
- Return ONLY valid JSON, no explanation, no markdown, no extra text

Return this exact JSON format:
{{
  "intent": "INTENT_HERE",
  "retrieval_mode": "mode_here",
  "rewritten_query": "rewritten query here"
}}"""

    try:
        completion = groq_client.chat.completions.create(
            model=Config.LLM_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": "You are a precise query router. Return only valid JSON with intent, retrieval_mode, and rewritten_query.",
                },
                {"role": "user", "content": prompt},
            ],
            temperature=0,
            max_tokens=120,
        )
        raw = completion.choices[0].message.content.strip()
        # Strip markdown code fences if present
        raw = raw.replace("```json", "").replace("```", "").strip()
        parsed = json.loads(raw)

        intent = parsed.get("intent", "FACTUAL_LOOKUP").upper()
        retrieval_mode = parsed.get("retrieval_mode", "rag").lower()
        rewritten_query = parsed.get("rewritten_query", question).strip() or question

        # Validate
        if intent not in VALID_INTENTS:
            intent = "FACTUAL_LOOKUP"
        if retrieval_mode not in VALID_RETRIEVAL_MODES:
            retrieval_mode = "rag"

        # Override: Check for web-search keywords even with file attached
        if filename and retrieval_mode != "web" and search_type != "closed":
            question_lower = question.lower()
            if any(kw in question_lower for kw in WEB_OVERRIDE_KEYWORDS):
                print(f"🌐 Web override triggered for: {question[:50]}...")
                retrieval_mode = "web"
                intent = "WEB_SEARCH"

        # Safety override: if file attached and web mode chosen (not explicitly open), use web (allowing web search)
        # Removed the override that forced rag - now web is allowed even with files

        print(f"🧠 Router → intent: {intent} | mode: {retrieval_mode} | query: {rewritten_query[:60]}")
        return {
            "intent": intent,
            "retrieval_mode": retrieval_mode,
            "rewritten_query": rewritten_query,
        }

    except Exception as e:
        print(f"Router error: {e} — falling back to defaults")
        # Fallback: basic heuristics
        return _fallback_route(question, filename, search_type)


def _fallback_route(question: str, filename: Optional[str], search_type: str) -> Dict[str, str]:
    """Fallback routing when Groq router fails."""
    import re

    q = question.lower().strip().rstrip("?!")

    casual_patterns = [
        r'^(hey|hi|hello|yo|sup|hiya|good morning|good afternoon|good evening)',
        r'^(thanks|thank you|great|cool|awesome|nice|bye|goodbye)',
        r'^how are you',
    ]
    if any(re.match(p, q) for p in casual_patterns):
        return {"intent": "CASUAL_CHAT", "retrieval_mode": "none", "rewritten_query": question}

    # Check for web search keywords in fallback
    if any(kw in q for kw in WEB_OVERRIDE_KEYWORDS):
        return {"intent": "WEB_SEARCH", "retrieval_mode": "web", "rewritten_query": question}

    vague_doc_queries = {
        "whats this", "what is this", "explain", "explain this", "describe",
        "describe this", "summarize", "summarise", "what's this", "tell me about this",
        "what does this say", "overview", "give me a summary", "what is in this",
        "what is this document", "what is this file", "what is this about"
    }
    if q in vague_doc_queries and filename:
        return {"intent": "SUMMARIZE", "retrieval_mode": "full_document", "rewritten_query": "document overview summary main topics introduction"}

    if search_type == "open":
        return {"intent": "WEB_SEARCH", "retrieval_mode": "web", "rewritten_query": question}

    return {"intent": "FACTUAL_LOOKUP", "retrieval_mode": "rag", "rewritten_query": question}


# ─────────────────────────────────────────────
# FULL DOCUMENT FETCH (for SUMMARIZE / GENERATE_NOTES)
# ─────────────────────────────────────────────

def fetch_full_document(user_id: str, filename: str) -> str:
    """Fetch all chunks for a file in order and reconstruct full text."""
    try:
        # Try to get supabase client from closed_domain or vector_store
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

        # Trim to fit context window safely (Llama 3.3 70B has 128k context)
        if len(full_text) > 14000:
            full_text = full_text[:14000] + "\n...[document truncated for context window]"

        return full_text

    except Exception as e:
        print(f"fetch_full_document error: {e}")
        return ""


# ─────────────────────────────────────────────
# ANSWER GENERATORS
# ─────────────────────────────────────────────

def generate_conversational_answer(question: str, conversation_context: Optional[str] = None) -> str:
    """Handle casual chat and conversation recall without retrieval."""
    context_section = ""
    if conversation_context:
        context_section = f"Recent conversation:\n{conversation_context[-2500:]}\n\n"

    prompt = f"""{context_section}The user said:
{question}

INSTRUCTIONS:
- Respond as a warm, capable AI assistant.
- If the user is asking about something discussed earlier in the conversation, answer based on the conversation context above.
- Do not mention documents, web search, sources, or internal routing unless the user asks.

FORMATTING RULES:
- For simple greetings or short answers, plain prose is fine.
- If explaining something from the conversation that involves multiple points, use ## headers and - bullet points.
- Never write a wall of text when structure would help.

Answer:"""

    try:
        completion = groq_client.chat.completions.create(
            model=Config.LLM_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a warm, intelligent AI assistant. "
                        "For casual conversation, reply naturally. "
                        "When explaining topics, use clean markdown formatting with headers and bullets where helpful."
                    ),
                },
                {"role": "user", "content": prompt},
            ],
            temperature=0.5,
            max_tokens=900,
        )
        return completion.choices[0].message.content.strip()
    except Exception as e:
        print(f"Conversational answer error: {e}")
        return "I had trouble processing that. Please try again."


def generate_full_document_answer(
    question: str,
    full_text: str,
    filename: str,
    intent: str,
    conversation_context: Optional[str] = None,
) -> str:
    """
    LLM-based answer using full document text.
    Used for SUMMARIZE and GENERATE_NOTES intents.
    No similarity search — entire document goes to LLM.
    """
    context_section = ""
    if conversation_context:
        context_section = f"Previous conversation:\n{conversation_context[-1500:]}\n\n"

    if intent == "GENERATE_NOTES":
        task_instruction = """
TASK: Generate clean, structured notes from this document.

FORMATTING RULES:
- Use ## headers for each major topic or section found in the document.
- Under each header, use - bullet points for key points.
- Each bullet should be a complete, informative sentence.
- If the document has numbered items (like PO1, PO2), preserve numbering: e.g. "- **PO1:** Description."
- Add a blank line between sections.
- End with a ## Key Takeaways section summarizing the 3-5 most important points.
"""
    elif intent == "COMPARE":
        task_instruction = """
TASK: Compare and contrast the sections or topics the user is asking about.

FORMATTING RULES:
- Use a ## header for each item being compared.
- Use - bullets to list key attributes under each.
- Add a ## Summary of Differences section at the end.
"""
    else:  # SUMMARIZE or default
        task_instruction = """
TASK: Summarize and explain this document clearly and completely.

FORMATTING RULES:
- Begin with a 1-2 sentence intro describing what this document is about.
- Use ## headers to separate major sections or categories found in the document.
- Under each header, use - bullet points for key details.
- If the document has numbered items (like PO1, PO2, PSO1), preserve numbering: e.g. "- **PO1:** Description here."
- Add a blank line between each section.
- End with a short ## Summary section (2-3 sentences).
- Never dump all content into one paragraph.
"""

    prompt = f"""{context_section}The following is the full content of the uploaded document "{filename}":

---
{full_text}
---

The user asked: "{question}"

{task_instruction}

IMPORTANT:
- Use only information from the document above.
- Do not fabricate or infer anything not present.
- Do not mention "chunk", "PDF", "document_chunks", or internal labels in your answer.

Answer:"""

    try:
        completion = groq_client.chat.completions.create(
            model=Config.LLM_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are an intelligent AI assistant that reads documents carefully and presents "
                        "information in clean, well-structured markdown. Use ## headers, - bullet points, "
                        "and **bold** for emphasis. Never write walls of text. Never fabricate information."
                    ),
                },
                {"role": "user", "content": prompt},
            ],
            temperature=0.4,
            max_tokens=1400,
        )
        return completion.choices[0].message.content.strip()
    except Exception as e:
        print(f"Full document answer error: {e}")
        return "I had trouble processing the document. Please try again."


def generate_answer(question: str, sources: List[Dict], conversation_context: Optional[str] = None) -> str:
    """Generate an answer using RAG-retrieved chunks (PDF or web sources)."""
    context_section = ""
    if conversation_context:
        context_section = f"Previous conversation:\n{conversation_context}\n\n"

    if not sources:
        prompt = f"""{context_section}The user asked: "{question}"

You have no relevant information to answer this question.

Respond naturally. If this needs current web or document information, say what is missing and ask for the right source or a clearer question.
Keep the answer useful and concise."""
    else:
        pdf_sources = [s for s in sources if s.get("source_type") == "PDF Document"]
        web_sources = [s for s in sources if s.get("source_type") == "Web Search"]

        context_parts = []

        if pdf_sources:
            context_parts.append("FROM YOUR UPLOADED PDF DOCUMENT(S):")
            for source in pdf_sources[:5]:
                content = source.get("content", "")
                filename = source.get("filename", "Unknown")
                if len(content) > 1500:
                    content = content[:1500] + "..."
                context_parts.append(f"[PDF Document: {filename}]\n{content}")

        if web_sources and not pdf_sources:
            context_parts.append("FROM WEB SEARCH:")
            for idx, source in enumerate(web_sources[:3], 1):
                content = source.get("content", "")
                if len(content) > 800:
                    content = content[:800] + "..."
                context_parts.append(f"[Web Source {idx}]\n{content}")

        doc_context = "\n\n---\n\n".join(context_parts)

        if pdf_sources:
            prompt = f"""{context_section}Here is information extracted from the user's uploaded PDF document(s):

{doc_context}

The user asked: "{question}"

INSTRUCTIONS:
1. Use the PDF content above as your primary source of truth.
2. Understand the content deeply and answer clearly and completely.
3. Use your own words — do not copy-paste raw sentences.
4. Extract ALL relevant details, even if scattered across chunks.
5. Do NOT fabricate or infer anything not in the document.
6. If the document does not contain the answer, say: "I couldn't find this information in the uploaded document."
7. Do not mention internal labels like "chunk", "PDF Document", or "source".

FORMATTING RULES — follow these strictly:
- Begin with a short 1-2 sentence intro that directly answers or frames the topic.
- Use ## headers to separate major sections or categories.
- Under each header, use - bullet points for individual points.
- Each bullet must be a complete, readable sentence or phrase — never a raw fragment.
- If the document has numbered items (like PO1, PO2, PSO1), preserve numbering: e.g. "- **PO1:** Description here."
- Add a blank line between each section for visual breathing room.
- Do NOT dump all text into one paragraph.
- End with a short 1-2 sentence closing summary if the content warrants it.

Answer:"""
        else:
            prompt = f"""{context_section}Here is current information from web search:

{doc_context}

The user asked: "{question}"

INSTRUCTIONS:
1. Answer using the web search results above as your source.
2. Explain the information clearly and helpfully in your own words.
3. If the snippets lack enough detail, say what is missing.
4. Do not mention internal labels like "Web Source", "snippet", or "retrieved content".
5. Give a thorough, direct answer.

FORMATTING RULES:
- Use ## headers to separate major topics if the answer covers multiple areas.
- Use bullet points ( - ) for lists of items, features, or steps.
- Keep paragraphs short — 2-3 sentences max.
- Add blank lines between sections.

Answer:"""

    try:
        completion = groq_client.chat.completions.create(
            model=Config.LLM_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are an intelligent AI assistant. When given document or web content, "
                        "you read it carefully, understand it fully, and present your answer in a "
                        "clean, well-structured format using markdown — with headers (##), bullet points ( - ), "
                        "and bold text (**text**) where appropriate. "
                        "Never dump text into a single congested paragraph. "
                        "Always break content into clearly labelled sections with breathing room between them. "
                        "Never fabricate information. Never copy-paste raw document text."
                    ),
                },
                {"role": "user", "content": prompt},
            ],
            temperature=0.4,
            max_tokens=1200,
        )
        return completion.choices[0].message.content.strip()
    except Exception as e:
        print(f"Groq error: {e}")
        return "I had trouble processing your request. Please try again."


# ─────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────

def filter_results_by_relevance(
    results: List[Dict[str, Any]], min_score: float = MIN_RELEVANCE_SCORE
) -> List[Dict[str, Any]]:
    """
    Filter by relevance score.
    FIXED: Returns empty list if no results meet threshold.
    Prevents low-quality results from blocking web fallback.
    """
    filtered = [r for r in results if r.get("similarity", r.get("score", 0)) >= min_score]
    # FIXED: Return empty list instead of forcing top results
    return filtered


def check_pdf_quality(results: List[Dict[str, Any]], min_useful_score: float = MIN_USEFUL_PDF_SCORE) -> tuple[bool, float]:
    """
    Check if PDF results are actually useful for answering the question.
    Returns (has_useful_results, max_score)
    """
    if not results:
        return False, 0.0
    
    max_score = max([r.get("similarity", r.get("score", 0)) for r in results], default=0.0)
    has_useful = max_score >= min_useful_score
    
    if not has_useful:
        print(f"⚠️ PDF results have low quality (max score: {max_score:.2f} < {min_useful_score}) — will fall back to web")
    
    return has_useful, max_score


def _dedupe_sources(sources: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
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
    """Rerank retrieved documents through Cohere."""
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
            ranked.append(source)
        return ranked or sources[:top_n]
    except Exception as e:
        print(f"Cohere rerank error: {e}")
        return sources[:top_n]


def sanitize_verbose_response(answer: str) -> str:
    """Clean up verbose no-match responses."""
    import re

    patterns = [
        r"The provided PDFs contain.*?(?:but|and) none of them",
        r"The documents appear to contain.*?but none of them",
        r"I couldn't find any relevant information related to .* in your uploaded PDF documents\.",
        r"Please make sure your PDF contains the relevant information or try uploading a different document\.",
    ]
    result = answer
    for pattern in patterns:
        result = re.sub(pattern, "", result, flags=re.IGNORECASE)
    result = re.sub(r'\s+', ' ', result).strip()
    return result if result else "I don't have that information available."


def generate_friendly_no_result() -> str:
    return "I don't have that information available."


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
    Agentic Hybrid RAG pipeline.

    Flow:
      1. route_query()  → intent + retrieval_mode + rewritten_query  [Groq call 1]
      2. Execute the right retrieval based on retrieval_mode
      3. generate_answer() or generate_full_document_answer()        [Groq call 2]
    """
    search_type = (search_type or "hybrid").lower()
    if search_type not in {"closed", "open", "hybrid"}:
        search_type = "hybrid"

    # ── Step 1: Agentic Router ──
    route = route_query(
        question=question,
        filename=filename,
        conversation_context=conversation_context,
        search_type=search_type,
    )
    intent = route["intent"]
    retrieval_mode = route["retrieval_mode"]
    rewritten_query = route["rewritten_query"]

    # Override retrieval_mode based on explicit search_type from frontend
    if search_type == "closed":
        retrieval_mode = "full_document" if intent in ("SUMMARIZE", "GENERATE_NOTES") else "rag"
    elif search_type == "open":
        retrieval_mode = "web"

    # ── Step 2: CASUAL_CHAT / CONVERSATION_RECALL — no retrieval ──
    if retrieval_mode == "none" or intent in ("CASUAL_CHAT", "CONVERSATION_RECALL"):
        return {
            "answer": generate_conversational_answer(question, conversation_context),
            "sources": [],
            "search_type_used": "Conversation",
            "closed_source_count": 0,
            "open_source_count": 0,
            "rewritten_query": question,
        }

    # ── Step 3: FULL DOCUMENT MODE (SUMMARIZE / GENERATE_NOTES) ──
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
            sources = [{
                "type": "PDF Document",
                "title": filename[:40],
                "content": full_text[:200],
                "url": "",
            }]
            return {
                "answer": answer,
                "sources": sources,
                "search_type_used": "PDF Document",
                "closed_source_count": 1,
                "open_source_count": 0,
                "rewritten_query": rewritten_query,
            }
        else:
            # Full doc fetch failed — fall through to RAG
            print("Full document fetch failed — falling back to RAG")
            retrieval_mode = "rag"

    # ── Step 4: RAG PIPELINE (FACTUAL_LOOKUP / COMPARE) ──
    closed_results = []
    open_results = []

    if retrieval_mode == "rag":
        try:
            closed_results = search_closed_domain(rewritten_query, user_id, top_k=8, filename=filename)
            print(f"PDF results (before relevance filter): {len(closed_results)}")
            closed_results = filter_results_by_relevance(closed_results, MIN_RELEVANCE_SCORE)
            print(f"PDF results (after relevance filter): {len(closed_results)}")
            
            # NEW: Check quality of PDF results
            has_useful_pdf, max_pdf_score = check_pdf_quality(closed_results, MIN_USEFUL_PDF_SCORE)
            
            if closed_results:
                for result in closed_results[:2]:
                    print(f"   - From PDF: {result.get('filename', 'Unknown')} (score: {result.get('similarity', 0):.2f})")
            
            # FIXED: Clear closed_results if they're not useful
            if not has_useful_pdf:
                print(f"⚠️ No useful PDF results (max score: {max_pdf_score:.2f}) — clearing for web fallback")
                closed_results = []
                
        except Exception as e:
            print(f"PDF search error: {e}")

        # FIXED: Web fallback if hybrid mode AND no USEFUL PDF results
        if search_type == "hybrid" and len(closed_results) == 0:
            try:
                open_results = search_open_domain(rewritten_query, top_k=3)
                print(f"🌐 Web fallback results: {len(open_results)}")
            except Exception as e:
                print(f"Web fallback error: {e}")

    # ── Step 5: WEB SEARCH MODE ──
    elif retrieval_mode == "web":
        try:
            open_results = search_open_domain(rewritten_query, top_k=3)
            print(f"🌐 Web results: {len(open_results)}")
        except Exception as e:
            print(f"Web search error: {e}")

    # ── Step 6: Build sources ──
    all_sources = []
    for result in closed_results:
        result["source_type"] = "PDF Document"
        all_sources.append(result)
    for result in open_results:
        result["source_type"] = "Web Search"
        all_sources.append(result)

    # Only rerank if we have mix or more than 1 source
    if len(all_sources) > 1:
        all_sources = _dedupe_sources(all_sources)
        all_sources = rerank_with_cohere(rewritten_query, all_sources, top_n=5)

    # ── Step 7: Generate answer ──
    # Add a note if we fell back to web search
    answer = generate_answer(question, all_sources, conversation_context)
    answer = sanitize_verbose_response(answer)

    # ── Step 8: Build response sources ──
    response_sources = []
    for source in all_sources[:3]:
        if source.get("source_type") == "PDF Document":
            display_name = source.get("filename", "PDF Document")[:40]
        else:
            display_name = source.get("title", "Web Result")[:40]
        response_sources.append({
            "type": source.get("source_type"),
            "title": display_name,
            "content": source.get("content", "")[:200],
            "url": source.get("url", ""),
        })

    mode_used = "PDF Document" if closed_results else ("Web Search" if open_results else "No results")

    return {
        "answer": answer,
        "sources": response_sources,
        "search_type_used": mode_used,
        "closed_source_count": len(closed_results),
        "open_source_count": len(open_results),
        "rewritten_query": rewritten_query,
    }
