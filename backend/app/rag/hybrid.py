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
MIN_USEFUL_PDF_SCORE = float(os.getenv("MIN_USEFUL_PDF_SCORE", "0.3"))

# ─────────────────────────────────────────────
# AGENTIC ROUTER
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


def route_query(
    question: str,
    filename: Optional[str] = None,
    conversation_context: Optional[str] = None,
    search_type: str = "hybrid",
) -> Dict[str, str]:
    """
    Single Groq call that acts as the agentic brain.
    Returns intent, retrieval_mode, and rewritten_query.
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
   - WEB_SEARCH       : needs current/live info — news, weather, prices, latest events, exam details, current affairs
   - CASUAL_CHAT      : greetings, thanks, chitchat, "how are you", "bye"
   - CONVERSATION_RECALL : "what did we discuss", "earlier you said", "remind me"

2. Choose retrieval_mode:
   - "rag"           : for FACTUAL_LOOKUP, COMPARE (use vector + keyword search)
   - "full_document" : for SUMMARIZE, GENERATE_NOTES (skip similarity search, use all chunks)
   - "web"           : for WEB_SEARCH
   - "none"          : for CASUAL_CHAT, CONVERSATION_RECALL

3. Rewrite the query for RETRIEVAL (not for answering):
   - Return a SHORT, KEYWORD-FOCUSED search query (5-15 words maximum)
   - Remove unnecessary words like "what", "how", "tell me", "can you"
   - Keep proper nouns (names, dates, technical terms)
   - Example: "Ajay Raj resume skills" not "What are the skills listed in Ajay Raj's resume?"
   - For SUMMARIZE/GENERATE_NOTES: use "document overview summary"
   - For CASUAL_CHAT/CONVERSATION_RECALL: return the original question

IMPORTANT RULES:
- A file attachment does NOT force document search — evaluate the question content
- If question asks for time-sensitive or external information, use WEB_SEARCH even with files
- Return ONLY valid JSON, no explanation, no markdown

Return this exact JSON format:
{{
  "intent": "INTENT_HERE",
  "retrieval_mode": "mode_here",
  "rewritten_query": "short keyword search query here"
}}"""

    try:
        completion = groq_client.chat.completions.create(
            model=Config.LLM_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": "You are a precise query router. Return only valid JSON with intent, retrieval_mode, and a SHORT keyword-focused rewritten_query.",
                },
                {"role": "user", "content": prompt},
            ],
            temperature=0,
            max_tokens=120,
        )
        raw = completion.choices[0].message.content.strip()
        raw = raw.replace("```json", "").replace("```", "").strip()
        parsed = json.loads(raw)

        intent = parsed.get("intent", "FACTUAL_LOOKUP").upper()
        retrieval_mode = parsed.get("retrieval_mode", "rag").lower()
        rewritten_query = parsed.get("rewritten_query", question).strip() or question

        # Keep rewritten query short if it got too long
        if len(rewritten_query.split()) > 15 and intent != "CASUAL_CHAT":
            rewritten_query = " ".join(rewritten_query.split()[:15])
            print(f"📏 Shortened rewritten query to: {rewritten_query}")

        if intent not in VALID_INTENTS:
            intent = "FACTUAL_LOOKUP"
        if retrieval_mode not in VALID_RETRIEVAL_MODES:
            retrieval_mode = "rag"

        print(f"🧠 Router → intent: {intent} | mode: {retrieval_mode} | query: {rewritten_query[:60]}")
        return {
            "intent": intent,
            "retrieval_mode": retrieval_mode,
            "rewritten_query": rewritten_query,
        }

    except Exception as e:
        print(f"Router error: {e} — falling back to defaults")
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

    vague_doc_queries = {
        "whats this", "what is this", "explain", "explain this", "describe",
        "describe this", "summarize", "summarise", "what's this", "tell me about this",
        "what does this say", "overview", "give me a summary", "what is in this",
        "what is this document", "what is this file", "what is this about"
    }
    if q in vague_doc_queries and filename:
        return {"intent": "SUMMARIZE", "retrieval_mode": "full_document", "rewritten_query": "document overview summary"}

    if search_type == "open":
        return {"intent": "WEB_SEARCH", "retrieval_mode": "web", "rewritten_query": question}

    # Create a short keyword query from question
    words = re.findall(r'\b[a-zA-Z0-9]+\b', q)
    short_query = " ".join(words[:8]) if len(words) > 8 else " ".join(words)
    
    return {"intent": "FACTUAL_LOOKUP", "retrieval_mode": "rag", "rewritten_query": short_query}


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
# CASUAL CONVERSATION (SIMPLE, NO MARKDOWN)
# ─────────────────────────────────────────────

def generate_conversational_answer(question: str, conversation_context: Optional[str] = None) -> str:
    """Handle casual chat and conversation recall - SIMPLE plain text response."""
    context_section = ""
    if conversation_context:
        context_section = f"Recent conversation:\n{conversation_context[-2500:]}\n\n"

    prompt = f"""{context_section}The user said:
{question}

INSTRUCTIONS:
- Respond as a warm, capable AI assistant.
- Keep response NATURAL and CONVERSATIONAL (NO markdown, NO headers, NO bullet points)
- Just use plain sentences and line breaks
- If the user is asking about something discussed earlier, use the conversation context.
- Do not mention documents, web search, or internal routing.
- End with a helpful, friendly note.

Example of GOOD response:
"Hi there! I'm doing great, thanks for asking. How can I help you today?"

Example of BAD response (DO NOT USE):
"## Greeting\n- I'm doing well\n**Thank you**"

Answer:"""

    try:
        completion = groq_client.chat.completions.create(
            model=Config.LLM_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": "You are a warm, friendly AI assistant. Respond in plain, natural language. NO markdown, NO headers, NO bullet points. Just simple sentences like a human conversation.",
                },
                {"role": "user", "content": prompt},
            ],
            temperature=0.5,
            max_tokens=300,
        )
        answer = completion.choices[0].message.content.strip()
        return answer
    except Exception as e:
        print(f"Conversational answer error: {e}")
        return "I had trouble processing that. Please try again."


# ─────────────────────────────────────────────
# FULL DOCUMENT ANSWER (WITH MARKDOWN)
# ─────────────────────────────────────────────

def generate_full_document_answer(
    question: str,
    full_text: str,
    filename: str,
    intent: str,
    conversation_context: Optional[str] = None,
) -> str:
    """LLM-based answer using full document text with markdown formatting."""
    context_section = ""
    if conversation_context:
        context_section = f"Previous conversation:\n{conversation_context[-1500:]}\n\n"

    if intent == "GENERATE_NOTES":
        task_instruction = """
TASK: Generate clean, well-structured notes from this document.

FORMATTING RULES:
- Start with a brief introductory sentence
- Use ## headers for each major topic or section
- Use - bullet points for key points under each header
- Use **bold** for important terms
- Use ```python (or appropriate language) for code blocks
- End with ## Key Takeaways section
"""
    elif intent == "COMPARE":
        task_instruction = """
TASK: Compare and contrast the sections or topics the user asked about.

FORMATTING RULES:
- Start with a brief overview
- Use ## header for each item being compared
- Use - bullets for attributes under each
- Use **bold** for key differences
- End with ## Summary of Differences
"""
    else:  # SUMMARIZE
        task_instruction = """
TASK: Create a comprehensive, well-structured summary of this document.

FORMATTING RULES:
- Start with a 1-2 sentence overview
- Use ## headers for each major section
- Use - bullet points for key details
- Use **bold** for important terms
- Use ```python (or appropriate language) for code examples if present
- End with ## Summary
"""

    prompt = f"""{context_section}Document "{filename}":

{full_text}

User asked: "{question}"

{task_instruction}

IMPORTANT:
- Use ONLY information from the document above
- For code blocks, ALWAYS specify the language like: ```python or ```javascript
- ALWAYS close code blocks with ```
- Do NOT leave code blocks open or malformed

Answer:"""

    try:
        completion = groq_client.chat.completions.create(
            model=Config.LLM_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": "You are an AI assistant that formats responses with proper markdown. ALWAYS use ```language and ``` to close code blocks. Never leave code blocks open.",
                },
                {"role": "user", "content": prompt},
            ],
            temperature=0.4,
            max_tokens=1400,
        )
        answer = completion.choices[0].message.content.strip()
        return answer
    except Exception as e:
        print(f"Full document answer error: {e}")
        return "I had trouble processing the document. Please try again."


def get_score(result: Dict[str, Any]) -> float:
    """Safely extract score from result regardless of field name."""
    score_fields = ["similarity", "rerank_score", "score", "relevance_score", "keyword_score"]
    for field in score_fields:
        if field in result and result[field] is not None:
            return float(result[field])
    return 0.0


def filter_results_by_relevance(
    results: List[Dict[str, Any]], min_score: float = MIN_RELEVANCE_SCORE
) -> List[Dict[str, Any]]:
    """Filter by relevance score using get_score() for flexible field handling."""
    if not results:
        return []
    
    for r in results:
        if "extracted_score" not in r:
            r["extracted_score"] = get_score(r)
    
    filtered = [r for r in results if r.get("extracted_score", 0) >= min_score]
    
    if filtered:
        return filtered
    
    if results:
        max_score = max(r.get("extracted_score", 0) for r in results)
        print(f"📊 No results met threshold {min_score}. Max score found: {max_score:.3f}")
    
    return []


def check_pdf_quality(results: List[Dict[str, Any]], min_useful_score: float = MIN_USEFUL_PDF_SCORE) -> tuple[bool, float]:
    """Check if PDF results are actually useful."""
    if not results:
        return False, 0.0
    
    max_score = max([get_score(r) for r in results], default=0.0)
    has_useful = max_score >= min_useful_score
    
    if not has_useful and results:
        print(f"⚠️ PDF quality low (max score: {max_score:.3f} < {min_useful_score})")
    
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
            source["extracted_score"] = source["rerank_score"]
            ranked.append(source)
        return ranked or sources[:top_n]
    except Exception as e:
        print(f"Cohere rerank error: {e}")
        return sources[:top_n]


# ─────────────────────────────────────────────
# GENERATE ANSWER FOR RAG/WEB (WITH MARKDOWN)
# ─────────────────────────────────────────────

def generate_answer(question: str, sources: List[Dict], conversation_context: Optional[str] = None) -> str:
    """Generate a beautifully formatted markdown answer from PDF or web sources."""
    context_section = ""
    if conversation_context:
        context_section = f"Previous conversation:\n{conversation_context}\n\n"

    # Determine source types
    pdf_sources = [s for s in sources if s.get("source_type") == "PDF Document"]
    web_sources = [s for s in sources if s.get("source_type") == "Web Search"]
    
    has_pdf = len(pdf_sources) > 0
    has_web = len(web_sources) > 0

    if not sources:
        prompt = f"""Answer the user's question from your general knowledge.

User asked: "{question}"

FORMATTING RULES:
- Use ## headers for main sections
- Use - bullet points for lists
- Use **bold** for key terms
- Use ```language for code blocks (always close with ```)
- Keep paragraphs short (2-3 sentences)

Answer:"""
    else:
        context_parts = []

        if pdf_sources:
            context_parts.append("## 📄 From Your Documents\n")
            for source in pdf_sources[:5]:
                content = source.get("content", "")
                filename = source.get("filename", "Document")
                if len(content) > 1500:
                    content = content[:1500] + "..."
                context_parts.append(f"**Source: {filename}**\n{content}\n")

        if web_sources:
            if pdf_sources:
                context_parts.append("\n## 🌐 From Web Search\n")
            else:
                context_parts.append("## 🌐 Web Search Results\n")
            for idx, source in enumerate(web_sources[:3], 1):
                content = source.get("content", "")
                title = source.get("title", f"Source {idx}")
                if len(content) > 800:
                    content = content[:800] + "..."
                context_parts.append(f"**{title}**\n{content}\n")

        doc_context = "\n".join(context_parts)

        prompt = f"""{context_section}{doc_context}

User question: "{question}"

INSTRUCTIONS:
1. Answer clearly using the information above
2. Format with proper markdown:
   - ## headers for organization
   - - bullet points for lists
   - **bold** for emphasis
   - ```language and ``` for code blocks (MUST close properly)
3. If code is present, always specify the language (python, javascript, etc.)
4. NEVER output [object Object] - that is an error
5. End with a helpful closing note

Answer:"""

    try:
        completion = groq_client.chat.completions.create(
            model=Config.LLM_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are an AI assistant that formats responses with markdown. "
                        "CRITICAL RULES:\n"
                        "1. ALWAYS close code blocks with ``` on a new line\n"
                        "2. ALWAYS specify language after opening ``` (e.g., ```python)\n"
                        "3. NEVER output [object Object] - that is a bug\n"
                        "4. Use ## for headers\n"
                        "5. Use - for bullet points\n"
                        "6. Use **bold** for emphasis"
                    ),
                },
                {"role": "user", "content": prompt},
            ],
            temperature=0.4,
            max_tokens=1200,
        )
        answer = completion.choices[0].message.content.strip()
        
        # Fix any malformed code blocks
        lines = answer.split('\n')
        fixed_lines = []
        in_code_block = False
        for line in lines:
            if line.strip().startswith('```') and not in_code_block:
                in_code_block = True
                # Ensure language is specified
                if line.strip() == '```':
                    line = '```python'
            elif line.strip() == '```' and in_code_block:
                in_code_block = False
            fixed_lines.append(line)
        
        # If code block never closed, close it
        if in_code_block:
            fixed_lines.append('```')
        
        answer = '\n'.join(fixed_lines)
        
        return answer
    except Exception as e:
        print(f"Groq error: {e}")
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
    Agentic Hybrid RAG pipeline with proper formatting.
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

    # Override based on explicit search_type
    if search_type == "closed":
        retrieval_mode = "full_document" if intent in ("SUMMARIZE", "GENERATE_NOTES") else "rag"
    elif search_type == "open":
        retrieval_mode = "web"

    # ── Step 2: No retrieval needed (CASUAL CHAT) ──
    if retrieval_mode == "none" or intent in ("CASUAL_CHAT", "CONVERSATION_RECALL"):
        return {
            "answer": generate_conversational_answer(question, conversation_context),
            "sources": [],
            "search_type_used": "Conversation",
            "closed_source_count": 0,
            "open_source_count": 0,
            "rewritten_query": question,
        }

    # ── Step 3: Full document mode ──
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
            print("Full document fetch failed — falling back to RAG")
            retrieval_mode = "rag"

    # ── Step 4: RAG Pipeline ──
    closed_results = []
    open_results = []

    if retrieval_mode == "rag":
        try:
            closed_results = search_closed_domain(rewritten_query, user_id, top_k=8, filename=filename)
            print(f"PDF results (raw): {len(closed_results)}")
            
            for r in closed_results:
                r["extracted_score"] = get_score(r)
            
            if closed_results:
                scores = [r.get("extracted_score", 0) for r in closed_results[:5]]
                print(f"   Sample scores: {scores}")
            
            closed_results = filter_results_by_relevance(closed_results, MIN_RELEVANCE_SCORE)
            print(f"PDF results (after relevance filter): {len(closed_results)}")
            
            has_useful_pdf, max_pdf_score = check_pdf_quality(closed_results, MIN_USEFUL_PDF_SCORE)
            
            if closed_results:
                for result in closed_results[:2]:
                    print(f"   - From PDF: {result.get('filename', 'Unknown')} (score: {get_score(result):.3f})")
            
            if not has_useful_pdf:
                print(f"⚠️ No useful PDF results — clearing for web fallback")
                closed_results = []
                
        except Exception as e:
            print(f"PDF search error: {e}")

        # Web fallback if hybrid mode AND no useful PDF results
        if search_type == "hybrid" and len(closed_results) == 0:
            try:
                open_results = search_open_domain(rewritten_query, top_k=3)
                print(f"🌐 Web fallback results: {len(open_results)}")
                for r in open_results[:2]:
                    print(f"   - Web: {r.get('title', 'Untitled')[:50]}")
            except Exception as e:
                print(f"Web fallback error: {e}")

    # ── Step 5: Web search mode ──
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

    if len(all_sources) > 1:
        all_sources = _dedupe_sources(all_sources)
        all_sources = rerank_with_cohere(rewritten_query, all_sources, top_n=5)

    # ── Step 7: Generate answer with markdown ──
    answer = generate_answer(question, all_sources, conversation_context)

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
