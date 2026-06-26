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
MAX_RERANK_DOC_CHARS  = int(os.getenv("MAX_RERANK_DOC_CHARS",  "1200"))
MIN_RELEVANCE_SCORE   = float(os.getenv("MIN_RELEVANCE_SCORE",  "0.2"))
MIN_USEFUL_PDF_SCORE  = float(os.getenv("MIN_USEFUL_PDF_SCORE", "0.3"))

# ─────────────────────────────────────────────
# AGENTIC ROUTER
# Single Groq call: classify intent + retrieval mode + rewrite query
# ─────────────────────────────────────────────

VALID_INTENTS = {
    "FACTUAL_LOOKUP", "SUMMARIZE", "GENERATE_NOTES",
    "COMPARE", "WEB_SEARCH", "CASUAL_CHAT", "CONVERSATION_RECALL",
    "CODE_REQUEST", "META_QUESTION", "FACTUAL_LOOKUP_WEB_FALLBACK",
}
VALID_RETRIEVAL_MODES = {"rag", "full_document", "web", "none"}


def route_query(
    question: str,
    filename: Optional[str] = None,
    conversation_context: Optional[str] = None,
    search_type: str = "hybrid",
) -> Dict[str, str]:
    """
    Agentic router — one Groq call that decides:
      1. intent
      2. retrieval_mode
      3. rewritten_query (resolves pronouns for follow-ups, short keywords for RAG)
    """
    trimmed_context = (conversation_context or "")[-3000:]
    file_info   = f"Attached file: {filename}" if filename else "No file attached."
    search_hint = ""
    if search_type == "closed":
        search_hint = "User explicitly wants document search only."
    elif search_type == "open":
        search_hint = "User explicitly wants web search only."

    prompt = f"""You are an autonomous Agentic Router for a hybrid RAG + conversational AI assistant.
Your job is to analyze the user's query, understand their goal, and select the right tool/intent to fulfill it.

Context:
- Attached file: {filename if filename else "None (User has NOT uploaded a document)"}
- Search Hint: {search_hint if search_hint else "None"}
- Recent conversation: {trimmed_context or "None"}

User's Latest Query: "{question}"

AVAILABLE INTENTS:
1. FACTUAL_LOOKUP: The user is asking a specific factual question. (Uses RAG if file attached, Web if no file).
2. SUMMARIZE: The user wants a summary or overview of the ATTACHED FILE. (Cannot be used if no file is attached).
3. GENERATE_NOTES: The user wants bullet points or notes from the ATTACHED FILE.
4. COMPARE: The user wants to compare concepts within the ATTACHED FILE.
5. WEB_SEARCH: The user is asking about a real-world topic, person, or current event, and NO file is attached.
6. CODE_REQUEST: The user wants to write, fix, or explain code.
7. CASUAL_CHAT: Greetings, thanks, or general conversation.
8. CONVERSATION_RECALL: The user is referring to something discussed earlier in this chat.
9. META_QUESTION: The user is asking what you (the AI) can do, your features, or supported formats.

AVAILABLE RETRIEVAL MODES:
- "rag": Search within the attached file (best for FACTUAL_LOOKUP or COMPARE with file).
- "full_document": Read the entire attached file (best for SUMMARIZE or GENERATE_NOTES).
- "web": Search the internet (best for WEB_SEARCH, or FACTUAL_LOOKUP with no file).
- "none": Rely entirely on your own internal knowledge or conversation history (best for CASUAL_CHAT, CONVERSATION_RECALL, META_QUESTION, CODE_REQUEST without file).

YOUR TASK (CHAIN OF THOUGHT):
1. Think step-by-step about what the user wants and what context (file) is available. Write your reasoning in the 'reasoning' field.
2. Based on your reasoning, select the most appropriate 'intent' and 'retrieval_mode'.
3. Generate a 'rewritten_query' that is optimized for the selected retrieval mode (5-12 keywords max, resolve pronouns). If mode is 'none', leave it as the original query.

CRITICAL RULES:
- If NO file is attached, you CANNOT use SUMMARIZE or GENERATE_NOTES. You must use WEB_SEARCH or FACTUAL_LOOKUP (with 'web' mode) for knowledge questions.
- Output ONLY valid JSON. No markdown, no pre-text, no post-text.

JSON Format:
{{
  "reasoning": "Step-by-step logic explaining your choice based on the context...",
  "intent": "ONE_OF_THE_AVAILABLE_INTENTS",
  "retrieval_mode": "rag|full_document|web|none",
  "rewritten_query": "Optimized query here"
}}"""

    try:
        completion = groq_client.chat.completions.create(
            model=Config.LLM_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": "You are a highly intelligent, autonomous routing agent. Analyze the context and output only valid JSON containing your reasoning, intent, retrieval mode, and rewritten query.",
                },
                {"role": "user", "content": prompt},
            ],
            temperature=0,
            max_tokens=350,
        )
        raw = completion.choices[0].message.content.strip()
        raw = raw.replace("```json", "").replace("```", "").strip()
        parsed = json.loads(raw)

        reasoning      = parsed.get("reasoning", "No reasoning provided")
        intent         = parsed.get("intent", "FACTUAL_LOOKUP").upper()
        retrieval_mode = parsed.get("retrieval_mode", "rag").lower()
        rewritten_query = parsed.get("rewritten_query", question).strip() or question

        # Trim if too long
        words = rewritten_query.split()
        if len(words) > 12 and intent not in ("CASUAL_CHAT", "CONVERSATION_RECALL", "CODE_REQUEST"):
            rewritten_query = " ".join(words[:12])

        if intent not in VALID_INTENTS:
            intent = "FACTUAL_LOOKUP"
        if retrieval_mode not in VALID_RETRIEVAL_MODES:
            retrieval_mode = "rag"

        # ── Absolute Minimum Safety Nets ──
        # Even autonomous agents need basic physical constraints

        # Casual/recall/meta must never retrieve
        if intent in ("CASUAL_CHAT", "CONVERSATION_RECALL", "META_QUESTION"):
            retrieval_mode = "none"

        # Code without file → no retrieval
        if intent == "CODE_REQUEST" and not filename:
            retrieval_mode = "none"

        print(f"🧠 Router Reason: {reasoning}")
        print(f"🧠 Router → intent:{intent} | mode:{retrieval_mode} | query:{rewritten_query[:60]}")
        return {"intent": intent, "retrieval_mode": retrieval_mode, "rewritten_query": rewritten_query}

    except Exception as e:
        print(f"Router error: {e} — using fallback")
        return _fallback_route(question, filename, search_type)


def _fallback_route(question: str, filename: Optional[str], search_type: str) -> Dict[str, str]:
    """Regex-based fallback when router Groq call fails."""
    import re
    q = question.lower().strip().rstrip("?!")

    # Detect meta/system questions first
    meta_patterns = [
        r'what.*(document|file|format).*(support|accept|upload|type)',
        r'what.*(type|kind).*(document|file|format)',
        r'what can (you|this|it) do',
        r'how (does|do) (this|you|it) work',
        r'what are (your|the) (feature|capabilit|function)',
        r'how (to|do i) use',
        r'what is (this|dualmind)',
        r'what.*(format|type).*(accept|support)',
        r'(supported|accepted).*(format|file|document|type)',
    ]
    if any(re.search(p, q) for p in meta_patterns):
        return {"intent": "META_QUESTION", "retrieval_mode": "none", "rewritten_query": question}

    casual = [
        r'^(hey|hi|hello|yo|sup|hiya|good morning|good afternoon|good evening)',
        r'^(thanks|thank you|great|cool|awesome|nice|bye|goodbye|ok|okay|sure)',
        r'^how are you', r'^what do you think', r'^do you',
    ]
    if any(re.match(p, q) for p in casual) or len(q.split()) <= 2:
        return {"intent": "CASUAL_CHAT", "retrieval_mode": "none", "rewritten_query": question}

    code_keywords = {"code", "algorithm", "function", "write", "implement", "program", "script", "debug", "fix", "sort", "search"}
    if any(kw in q for kw in code_keywords):
        mode = "rag" if filename else "none"
        return {"intent": "CODE_REQUEST", "retrieval_mode": mode, "rewritten_query": question}

    vague = {"whats this", "what is this", "explain", "explain this", "describe", "describe this",
             "summarize", "summarise", "what's this", "tell me about this", "what does this say",
             "overview", "give me a summary", "what is in this", "what is this about"}
    if q in vague and filename:
        return {"intent": "SUMMARIZE", "retrieval_mode": "full_document", "rewritten_query": "document overview summary main topics"}

    if search_type == "open":
        return {"intent": "WEB_SEARCH", "retrieval_mode": "web", "rewritten_query": question}

    words = re.findall(r'\b[a-zA-Z0-9]+\b', q)
    short = " ".join(words[:10]) if len(words) > 10 else " ".join(words)
    # No file attached → general knowledge question → use web
    mode = "rag" if filename else "web"
    return {"intent": "FACTUAL_LOOKUP", "retrieval_mode": mode, "rewritten_query": short}


# ─────────────────────────────────────────────
# FULL DOCUMENT FETCH
# ─────────────────────────────────────────────

def fetch_full_document(user_id: str, filename: str) -> str:
    """Fetch all chunks in order and reconstruct full document text."""
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
            print("fetch_full_document: no supabase client")
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
        print(f"📄 Full doc: {len(response.data)} chunks, {len(full_text)} chars")

        if len(full_text) > 14000:
            full_text = full_text[:14000] + "\n...[document truncated]"
        return full_text

    except Exception as e:
        print(f"fetch_full_document error: {e}")
        return ""


# ─────────────────────────────────────────────
# ANSWER GENERATORS
# ─────────────────────────────────────────────

def generate_conversational_answer(
    question: str,
    conversation_context: Optional[str] = None,
    intent: str = "CASUAL_CHAT",
) -> str:
    """
    Handles: CASUAL_CHAT, CONVERSATION_RECALL, CODE_REQUEST (no file), general follow-ups.
    Uses conversation history for context — no retrieval.
    """
    context_section = ""
    if conversation_context:
        context_section = f"Conversation so far:\n{conversation_context[-3000:]}\n\n"

    if intent == "CODE_REQUEST":
        task = f"""The user wants help with code or an algorithm.

User request: "{question}"

INSTRUCTIONS:
1. Understand what the user wants to build or fix.
2. Write clean, correct, well-commented code.
3. Provide the algorithm/approach BEFORE the code, briefly.
4. If the language isn't specified, use the most appropriate one (Python preferred for algorithms).
5. Handle edge cases and explain any important decisions.
6. If this is a follow-up to earlier code in the conversation, reference and improve that code.

FORMATTING:
- Use ## Algorithm section with numbered steps before the code
- Use a code block (```language) for the actual code
- Use ## Explanation section after for key points
- Use ## Example if showing usage helps
- Keep explanations concise — code should speak for itself
- NEVER use single # for headings — always use ## or ### minimum

Answer:"""
    elif intent == "META_QUESTION":
        task = f"""The user is asking about this AI system's capabilities or features.

User: "{question}"

INSTRUCTIONS:
- You are DualMind, a hybrid AI assistant that combines document analysis with web search.
- Answer from your knowledge about the system's capabilities:
  - Supported file formats: PDF documents
  - Search modes: Hybrid (PDF + Web), Web-only
  - Features: Upload PDFs for analysis, ask questions about documents, web search for current info, code generation, general conversation
  - Document features: summarize, extract key points, generate notes, compare sections, answer specific questions
- Be helpful and informative about what you can do
- Do NOT search uploaded documents — answer from system knowledge
- NEVER use single # for headings — always use ## or ### minimum

Answer:"""
    elif intent == "CONVERSATION_RECALL":
        task = f"""The user is asking about something from our earlier conversation.

User: "{question}"

INSTRUCTIONS:
- Look at the conversation history above carefully
- Answer directly based on what was discussed
- If it wasn't discussed, say so honestly — do not invent
- Keep it conversational and natural

Answer:"""
    else:
        task = f"""The user said: "{question}"

INSTRUCTIONS:
- Respond naturally and helpfully as a warm AI assistant
- If this is a follow-up question, use the conversation context above to give a relevant, connected answer
- Do NOT search for documents or web — answer from conversation context and general knowledge
- Be precise — do not hallucinate facts you are not sure about
- If unsure about something specific, say "I'm not certain, but..." rather than inventing
- Keep responses focused and appropriately concise

FORMATTING:
- For simple conversational replies: plain prose is fine
- For explanations with multiple points: use ## headers and - bullets
- Never write a wall of text when structure helps
- NEVER use single # for headings — always use ## or ### minimum

Answer:"""

    prompt = context_section + task

    try:
        completion = groq_client.chat.completions.create(
            model=Config.LLM_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are an intelligent, precise AI assistant with strong conversational ability. "
                        "You remember the conversation history and give connected, relevant responses. "
                        "You NEVER hallucinate facts — if unsure, you say so. "
                        "For code requests, you write clean, correct, well-commented code with a brief algorithm. "
                        "For conversation, you respond naturally. "
                        "Use markdown formatting (## headers, - bullets, code blocks) when it helps clarity."
                    ),
                },
                {"role": "user", "content": prompt},
            ],
            temperature=0.4,
            max_tokens=1400,
        )
        return completion.choices[0].message.content.strip()
    except Exception as e:
        print(f"Conversational answer error: {e}")
        return "I had trouble with that. Please try again."


def generate_full_document_answer(
    question: str,
    full_text: str,
    filename: str,
    intent: str,
    conversation_context: Optional[str] = None,
) -> str:
    """Full document LLM answer — for SUMMARIZE, GENERATE_NOTES, COMPARE."""
    context_section = ""
    if conversation_context:
        context_section = f"Previous conversation:\n{conversation_context[-1500:]}\n\n"

    if intent == "GENERATE_NOTES":
        task = """TASK: Generate clean structured notes.

FORMATTING:
- ## header for each major topic/section
- - bullet points for key points (complete sentences)
- Preserve numbering if present (PO1, PO2, etc.) as **PO1:** description
- Blank line between sections
- End with ## Key Takeaways (3-5 most important points)
- NEVER use single # for headings — always use ## or ### minimum"""

    elif intent == "COMPARE":
        task = """TASK: Compare and contrast what the user asked about.

FORMATTING:
- ## header for each item being compared
- - bullets for attributes under each
- ## Summary of Differences at the end"""

    else:  # SUMMARIZE
        task = """TASK: Summarize and explain this document clearly and completely.

FORMATTING:
- 1-2 sentence intro describing what this document is
- ## headers for major sections/categories found in the document
- - bullet points for key details under each header
- Preserve numbering if present (**PO1:** description, **PSO1:** description)
- Blank line between sections
- ## Summary section at the end (2-3 sentences)
- NEVER use single # for headings — always use ## or ### minimum"""

    prompt = f"""{context_section}Document "{filename}":

---
{full_text}
---

User asked: "{question}"

{task}

RULES:
- Use ONLY information from the document above — do not fabricate
- Do not mention "chunk", "PDF", or internal labels
- If the document has limited info, present what IS there clearly

Answer:"""

    try:
        completion = groq_client.chat.completions.create(
            model=Config.LLM_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are an AI that reads documents carefully and presents information "
                        "in clean, well-structured markdown. Use ## headers and - bullets. "
                        "Never write walls of text. Never fabricate."
                    ),
                },
                {"role": "user", "content": prompt},
            ],
            temperature=0.3,
            max_tokens=1400,
        )
        return completion.choices[0].message.content.strip()
    except Exception as e:
        print(f"Full document answer error: {e}")
        return "I had trouble processing the document. Please try again."


def generate_answer(
    question: str,
    sources: List[Dict],
    conversation_context: Optional[str] = None,
    intent: str = "FACTUAL_LOOKUP",
) -> str:
    """
    RAG answer generator — for PDF chunks and web search results.
    Handles: FACTUAL_LOOKUP, COMPARE, CODE_REQUEST (with file), WEB_SEARCH.
    """
    context_section = ""
    if conversation_context:
        context_section = f"Previous conversation:\n{conversation_context[-2000:]}\n\n"

    if not sources:
        # No sources found — answer from knowledge but be honest
        prompt = f"""{context_section}User asked: "{question}"

No relevant sources were found. Answer from your general knowledge if you can.
Be honest — if you are not certain, say so clearly. Do not hallucinate.
If this is a follow-up question, use the conversation context above.

FORMATTING: Use ## headers and - bullets if the answer has multiple sections.

Answer:"""
    else:
        pdf_sources = [s for s in sources if s.get("source_type") == "PDF Document"]
        web_sources = [s for s in sources if s.get("source_type") == "Web Search"]

        context_parts = []
        if pdf_sources:
            context_parts.append("FROM UPLOADED DOCUMENT(S):")
            for s in pdf_sources[:5]:
                content = (s.get("content") or "")[:1500]
                fname = s.get("filename", "Document")
                context_parts.append(f"[{fname}]\n{content}")

        if web_sources:
            label = "ADDITIONAL WEB INFO:" if pdf_sources else "FROM WEB SEARCH:"
            context_parts.append(label)
            for i, s in enumerate(web_sources[:3], 1):
                content = (s.get("content") or "")[:800]
                title = s.get("title", f"Source {i}")
                context_parts.append(f"[{title}]\n{content}")

        doc_context = "\n\n---\n\n".join(context_parts)

        if intent == "CODE_REQUEST":
            prompt = f"""{context_section}Relevant context from document(s):

{doc_context}

User request: "{question}"

INSTRUCTIONS:
1. Use the document context above as reference for the code request
2. Write clean, correct, well-commented code
3. Provide the algorithm/approach briefly BEFORE the code
4. Handle edge cases

FORMATTING:
- ## Algorithm — numbered steps
- Code block (```language) for the code
- ## Explanation — key decisions
- ## Example — if helpful

Answer:"""

        elif pdf_sources and not web_sources:
            prompt = f"""{context_section}FROM DOCUMENT:

{doc_context}

User asked: "{question}"

INSTRUCTIONS:
1. Answer using ONLY the document content above
2. Be precise and complete — extract all relevant details
3. Resolve pronouns using conversation context if this is a follow-up
4. Do NOT fabricate — if the document doesn't contain the answer, say so clearly
5. Do not mention "chunk", "PDF Document", or internal labels

FORMATTING:
- ## headers for major sections
- - bullets for key points
- **bold** for important terms
- Numbered lists for sequences or steps
- Blank lines between sections
- NEVER use single # for headings — always use ## or ### minimum

Answer:"""

        elif intent == "FACTUAL_LOOKUP_WEB_FALLBACK":
            # PDF had no relevant info — fell back to web — tell user clearly
            prompt = f"""{context_section}{doc_context}

User asked: "{question}"

INSTRUCTIONS:
1. Start your answer with this exact prefix on its own line:
   "I couldn't find anything about this in your uploaded document(s). Here's what I found from the web:"
2. Then answer the question fully using the web sources above
3. Be accurate — only state what the web sources say
4. Do NOT fabricate anything not in the sources

FORMATTING:
- ## headers for major sections
- - bullets for key points
- **bold** for important names/terms
- NEVER use single # for headings

Answer:"""

        else:
            prompt = f"""{context_section}{doc_context}

User asked: "{question}"

INSTRUCTIONS:
1. Answer clearly and accurately using the sources above
2. If both PDF and web sources exist, prioritize PDF but supplement with web
3. Resolve pronouns and follow-up references from conversation context
4. Do NOT fabricate — only state what the sources say
5. Do not mention source labels in the answer

FORMATTING:
- ## headers to separate major topics
- - bullets for lists and key facts
- Keep paragraphs short (2-3 sentences)
- **bold** for important terms or names
- Blank lines between sections
- NEVER use single # for headings — always use ## or ### minimum

Answer:"""

    try:
        completion = groq_client.chat.completions.create(
            model=Config.LLM_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a precise, intelligent AI assistant. "
                        "You answer questions accurately using provided sources. "
                        "You NEVER hallucinate or invent facts — if unsure, say so. "
                        "You format responses in clean markdown with ## headers and - bullets. "
                        "For code, you write correct, commented code with a brief algorithm. "
                        "You handle follow-up questions by using conversation context."
                    ),
                },
                {"role": "user", "content": prompt},
            ],
            temperature=0.35,
            max_tokens=1400,
        )
        return completion.choices[0].message.content.strip()
    except Exception as e:
        print(f"Generate answer error: {e}")
        return "I had trouble processing your request. Please try again."


# ─────────────────────────────────────────────
# SCORING HELPERS
# ─────────────────────────────────────────────

def get_score(result: Dict[str, Any]) -> float:
    for field in ["similarity", "rerank_score", "score", "relevance_score", "keyword_score"]:
        if field in result and result[field] is not None:
            return float(result[field])
    return 0.0


def filter_results_by_relevance(
    results: List[Dict[str, Any]], min_score: float = MIN_RELEVANCE_SCORE
) -> List[Dict[str, Any]]:
    if not results:
        return []
    for r in results:
        if "extracted_score" not in r:
            r["extracted_score"] = get_score(r)
    filtered = [r for r in results if r.get("extracted_score", 0) >= min_score]
    if not filtered:
        max_score = max((r.get("extracted_score", 0) for r in results), default=0)
        print(f"📊 No results met threshold {min_score}. Max score: {max_score:.3f}")
        # Return empty — let web fallback handle it instead of returning garbage
        return []
    return filtered


def check_pdf_quality(
    results: List[Dict[str, Any]], min_useful_score: float = MIN_USEFUL_PDF_SCORE
) -> tuple:
    if not results:
        return False, 0.0
    max_score = max((get_score(r) for r in results), default=0.0)
    has_useful = len(results) >= 1
    return has_useful, max_score


def _dedupe_sources(sources: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    seen, unique = set(), []
    for s in sources:
        key = (s.get("filename", ""), s.get("url", ""), (s.get("content") or "")[:160])
        if key not in seen:
            seen.add(key)
            unique.append(s)
    return unique


def rerank_with_cohere(query: str, sources: List[Dict[str, Any]], top_n: int = 5) -> List[Dict[str, Any]]:
    api_key = getattr(Config, "COHERE_API_KEY", None) or os.getenv("COHERE_API_KEY")
    if not api_key or len(sources) <= 1:
        return sources[:top_n]
    candidates = sources[:MAX_RERANK_CANDIDATES]
    documents  = [(s.get("content") or "")[:MAX_RERANK_DOC_CHARS] for s in candidates]
    try:
        resp = httpx.post(
            "https://api.cohere.com/v2/rerank",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "model": getattr(Config, "COHERE_RERANK_MODEL", os.getenv("COHERE_RERANK_MODEL", "rerank-v3.5")),
                "query": query, "documents": documents, "top_n": min(top_n, len(candidates)),
            },
            timeout=6.0,
        )
        resp.raise_for_status()
        ranked = []
        for item in resp.json().get("results", []):
            idx = item.get("index")
            if idx is None or idx >= len(candidates):
                continue
            s = dict(candidates[idx])
            s["rerank_score"] = item.get("relevance_score", 0)
            s["extracted_score"] = s["rerank_score"]
            ranked.append(s)
        return ranked or sources[:top_n]
    except Exception as e:
        print(f"Cohere rerank error: {e}")
        return sources[:top_n]


def sanitize_verbose_response(answer: str) -> str:
    import re
    patterns = [
        r"The provided PDFs contain.*?(?:but|and) none of them",
        r"The documents appear to contain.*?but none of them",
        r"I couldn't find any relevant information related to .* in your uploaded PDF documents\.",
        r"Please make sure your PDF contains the relevant information.*?\.",
    ]
    result = answer
    for p in patterns:
        result = re.sub(p, "", result, flags=re.IGNORECASE)
    result = re.sub(r'\s+', ' ', result).strip()
    return result if result else "I don't have that information available."


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

    Steps:
      1. route_query()               → intent + retrieval_mode + rewritten_query  [Groq call 1]
      2. Route to correct handler
      3. generate_*_answer()                                                       [Groq call 2]
    """
    search_type = (search_type or "hybrid").lower()
    if search_type not in {"closed", "open", "hybrid"}:
        search_type = "hybrid"

    print(f"\n{'='*50}\n📝 Query: {question[:80]}\n📎 File: {filename or 'None'}\n{'='*50}")

    # ── Step 1: Route ──
    route = route_query(
        question=question,
        filename=filename,
        conversation_context=conversation_context,
        search_type=search_type,
    )
    intent          = route["intent"]
    retrieval_mode  = route["retrieval_mode"]
    rewritten_query = route["rewritten_query"]
    print(f"🎯 Intent:{intent} | Mode:{retrieval_mode} | Query:{rewritten_query[:60]}")

    # Frontend mode overrides
    if search_type == "closed":
        retrieval_mode = "full_document" if intent in ("SUMMARIZE", "GENERATE_NOTES") else "rag"
    elif search_type == "open":
        retrieval_mode = "web"

    # ── Step 2a: No retrieval — conversational / code from knowledge / meta ──
    if retrieval_mode == "none" or intent in ("CASUAL_CHAT", "CONVERSATION_RECALL", "META_QUESTION"):
        return {
            "answer": generate_conversational_answer(question, conversation_context, intent),
            "sources": [],
            "search_type_used": "Conversation",
            "closed_source_count": 0,
            "open_source_count": 0,
            "rewritten_query": question,
        }

    # ── Step 2b: Full document mode ──
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
                "sources": [{"type": "PDF Document", "title": filename[:40], "content": full_text[:200], "url": ""}],
                "search_type_used": "PDF Document",
                "closed_source_count": 1,
                "open_source_count": 0,
                "rewritten_query": rewritten_query,
            }
        print("Full document fetch failed — falling back to RAG")
        retrieval_mode = "rag"

    # ── Step 2c: RAG pipeline ──
    closed_results, open_results = [], []

    if retrieval_mode == "rag":
        has_useful, max_score = False, 0.0
        try:
            closed_results = search_closed_domain(rewritten_query, user_id, top_k=8, filename=filename)
            print(f"PDF raw: {len(closed_results)}")
            for r in closed_results:
                r["extracted_score"] = get_score(r)
            if closed_results:
                print(f"   Scores: {[round(r['extracted_score'],3) for r in closed_results[:5]]}")
            closed_results = filter_results_by_relevance(closed_results, MIN_RELEVANCE_SCORE)
            print(f"PDF filtered: {len(closed_results)}")
            has_useful, max_score = check_pdf_quality(closed_results, MIN_USEFUL_PDF_SCORE)
        except Exception as e:
            print(f"PDF search error: {e}")

        # Web fallback if hybrid and PDF results are low quality or empty
        if search_type == "hybrid" and (not closed_results or not has_useful or max_score < MIN_USEFUL_PDF_SCORE):
            print(f"📄 No useful PDF results — falling back to web search")
            try:
                open_results = search_open_domain(rewritten_query, top_k=3)
                print(f"🌐 Web fallback: {len(open_results)}")
            except Exception as e:
                print(f"Web fallback error: {e}")
            # Flag that we fell back so the answer generator knows
            if open_results:
                intent = "FACTUAL_LOOKUP_WEB_FALLBACK"

    # ── Step 2d: Web search mode ──
    elif retrieval_mode == "web":
        try:
            open_results = search_open_domain(rewritten_query, top_k=3)
            print(f"🌐 Web: {len(open_results)}")
        except Exception as e:
            print(f"Web search error: {e}")

    # ── Step 3: Assemble sources ──
    all_sources = []
    for r in closed_results:
        r["source_type"] = "PDF Document"
        all_sources.append(r)
    for r in open_results:
        r["source_type"] = "Web Search"
        all_sources.append(r)

    if len(all_sources) > 1:
        all_sources = _dedupe_sources(all_sources)
        all_sources = rerank_with_cohere(rewritten_query, all_sources, top_n=5)

    # ── Step 4: Generate answer ──
    answer = generate_answer(question, all_sources, conversation_context, intent)
    answer = sanitize_verbose_response(answer)

    # ── Step 5: Build response sources ──
    response_sources = []
    for s in all_sources[:3]:
        name = s.get("filename", "PDF")[:40] if s.get("source_type") == "PDF Document" else s.get("title", "Web")[:40]
        response_sources.append({
            "type": s.get("source_type"),
            "title": name,
            "content": (s.get("content") or "")[:200],
            "url": s.get("url", ""),
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
