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

from ..config import Config

groq_client = Groq(api_key=Config.GROQ_API_KEY)

MAX_RERANK_CANDIDATES = int(os.getenv("MAX_RERANK_CANDIDATES", "10"))
MAX_RERANK_DOC_CHARS = int(os.getenv("MAX_RERANK_DOC_CHARS", "1200"))

# Relevance threshold for PDF search results (similarity score)
MIN_RELEVANCE_SCORE = float(os.getenv("MIN_RELEVANCE_SCORE", "0.2"))  # from 0.4 to 0.2
QUERY_INTENTS = {"conversation", "document", "web", "hybrid"}


def is_conversational_query(question: str) -> bool:
    """Fallback detector for casual conversation when LLM intent routing is unavailable."""
    import re
    
    question_lower = re.sub(r"\s+", " ", question.lower().strip())
    compact_question = re.sub(r"[^a-z0-9]", "", question_lower)

    greeting_patterns = [
        r'^(hey|hi|hello|yo|sup|hiya)(\b|[!.?]|$)',
        r'^(good morning|good afternoon|good evening)(\b|[!.?]|$)',
        r'^how are you(\b|[!.?]|$)',
        r'^(thanks|thank you|great|cool|awesome|nice)(\b|[!.?]|$)',
        r'^bye(\b|[!.?]|$)',
        r'^goodbye(\b|[!.?]|$)',
    ]
    compact_greetings = {"goodmorning", "goodafternoon", "goodevening"}

    return (
        any(re.match(pattern, question_lower) for pattern in greeting_patterns)
        or compact_question in compact_greetings
    )


def is_live_web_query(question: str) -> bool:
    """Fallback detector for questions that need current/open-web information."""
    import re

    question_lower = question.lower().strip()
    live_patterns = [
        r"\bweather\b",
        r"\btemperature\b",
        r"\bforecast\b",
        r"\bnews\b",
        r"\blatest\b",
        r"\btoday\b",
        r"\bcurrent\b",
        r"\bnow\b",
        r"\bstock\b",
        r"\bprice\b",
        r"\bscore\b",
    ]
    return any(re.search(pattern, question_lower) for pattern in live_patterns)


def is_document_query(question: str, filename: Optional[str] = None) -> bool:
    """Check if question likely refers to an uploaded document."""
    # If there's a file uploaded, treat ANY question as potentially document-related
    if filename:
        return True
    
    # Fallback: check for document-related words
    import re
    question_lower = question.lower().strip()
    return bool(re.search(r"\b(pdf|document|file|attachment|this|uploaded)\b", question_lower))


def classify_query_intent(
    question: str,
    search_type: str = "hybrid",
    filename: Optional[str] = None,
    conversation_context: Optional[str] = None,
) -> str:
    """Classify how the assistant should answer without generating the answer itself."""
    
    # CRITICAL: If a file is uploaded, automatically treat as document intent
    # This overrides any other classification - PDF takes priority
    if filename:
        print(f"📄 File uploaded: {filename} - forcing document intent")
        return "document"
    
    search_type = (search_type or "hybrid").lower()
    if search_type == "closed":
        return "document"
    if search_type == "open":
        return "web"

    trimmed_context = (conversation_context or "")[-1500:]
    prompt = f"""Classify the latest user message for an AI assistant.

Return exactly one label:
- conversation: greetings, small talk, thanks, chitchat, or meta conversation with the assistant.
- document: asks about the attached/uploaded PDF or asks for details/summary/explanation while a PDF filename is present.
- web: asks for current, latest, weather, news, prices, scores, or general internet lookup.
- hybrid: could benefit from searching both private documents and web.

Attached PDF filename: {filename or "none"}

Recent conversation:
{trimmed_context or "none"}

Latest user message:
{question}

Label only:"""

    try:
        completion = groq_client.chat.completions.create(
            model=Config.LLM_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": "You are an intent router. Return only one routing label.",
                },
                {"role": "user", "content": prompt},
            ],
            temperature=0,
            max_tokens=10,
        )
        intent = completion.choices[0].message.content.strip().lower()
        intent = intent.split()[0].strip(".,:;")
        if intent in QUERY_INTENTS:
            return intent
    except Exception as e:
        print(f"Intent routing error: {e}")

    # Fallback detectors (only used if LLM routing fails)
    if is_conversational_query(question):
        return "conversation"
    if is_live_web_query(question):
        return "web"
    if is_document_query(question, filename):
        return "document"
    return "hybrid"


def generate_conversational_answer(question: str, conversation_context: Optional[str] = None) -> str:
    """Let the LLM handle normal assistant conversation without retrieval."""
    context_section = ""
    if conversation_context:
        context_section = f"Recent conversation:\n{conversation_context[-2500:]}\n\n"

    prompt = f"""{context_section}The user said:
{question}

Respond as a capable, natural AI assistant. Keep it friendly and concise, but do not mention documents, web search, sources, or internal routing unless the user asks."""

    try:
        completion = groq_client.chat.completions.create(
            model=Config.LLM_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": "You are a warm, capable AI assistant. Reply naturally and helpfully.",
                },
                {"role": "user", "content": prompt},
            ],
            temperature=0.5,
            max_tokens=220,
        )
        return completion.choices[0].message.content.strip()
    except Exception as e:
        print(f"Conversation answer error: {e}")
        return "I had trouble processing that. Please try again."


def filter_results_by_relevance(results: List[Dict[str, Any]], min_score: float = MIN_RELEVANCE_SCORE) -> List[Dict[str, Any]]:
    """Filter results by relevance score threshold. Returns only high-relevance results."""
    return [r for r in results if r.get('similarity', r.get('score', 0)) >= min_score]


def rewrite_query_for_retrieval(
    question: str,
    conversation_context: Optional[str] = None,
    filename: Optional[str] = None,
    intent: str = "hybrid",
) -> str:
    """Turn a follow-up question into a standalone retrieval query."""
    if not conversation_context and not filename:
        return question

    trimmed_context = (conversation_context or "")[-3000:]
    document_instruction = ""
    if filename and intent == "document":
        document_instruction = f"""
The user has attached this PDF: {filename}
If the latest question asks for details, summary, explanation, or "this", rewrite it as a query for the attached PDF.
Ignore unrelated greetings, small talk, and prior web-search context."""

    prompt = f"""Rewrite the latest user question as a standalone search query.

Conversation:
{trimmed_context or "none"}

{document_instruction}

Latest question:
{question}

Rules:
- Preserve names, dates, document-specific terms, and user intent.
- Resolve pronouns and references using the conversation.
- Prefer the attached PDF context when the intent is document.
- Do not answer the question.
- Return only the rewritten query, under 40 words."""

    try:
        completion = groq_client.chat.completions.create(
            model=Config.LLM_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": "You rewrite follow-up questions into concise standalone retrieval queries.",
                },
                {"role": "user", "content": prompt},
            ],
            temperature=0,
            max_tokens=80,
        )
        rewritten = completion.choices[0].message.content.strip().strip('"')
        return rewritten if rewritten else question
    except Exception as e:
        print(f"Query rewrite error: {e}")
        return question


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
    """Rerank retrieved documents through Cohere without adding the Cohere SDK."""
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
                "model": getattr(
                    Config,
                    "COHERE_RERANK_MODEL",
                    os.getenv("COHERE_RERANK_MODEL", "rerank-v3.5"),
                ),
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


def generate_friendly_no_result() -> str:
    """Generate a friendly response when no relevant information is found."""
    return "I don't have that information available."


def generate_answer(question: str, sources: List[Dict], conversation_context: Optional[str] = None) -> str:
    """Generate an answer using the source type that actually supplied evidence."""
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
2. Understand the content deeply and answer the user's question in a clear, helpful, and well-structured way.
3. Use your own words to explain, summarize, or present the information — do not just copy-paste raw sentences from the document.
4. Extract and present ALL relevant details from the document that relate to the question — even if they are scattered across multiple chunks. For example, if asked about a person, include their name, role, skills, experience, contact info, goals, and any other relevant details present in the document.
5. Use bullet points or sections where it genuinely improves readability (e.g. listing skills, experience, contact details).
6. Do NOT fabricate or infer information that is not present in the document.
7. If the document truly does not contain the answer, say: "I couldn't find this information in the uploaded document."
8. Do not expose internal labels like "chunk", "PDF Document", or "source" in your answer.

Answer:"""
        else:
            prompt = f"""{context_section}Here is current information from web search:

{doc_context}

The user asked: "{question}"

INSTRUCTIONS:
1. Answer using the web search results above as your source.
2. Explain the information clearly and helpfully in your own words.
3. If the snippets lack enough detail, say what is missing.
4. Do not mention internal labels like "Web Source", "snippet", or "retrieved content" in the final answer.
5. Give a thorough, direct answer.

Answer:"""

    try:
        completion = groq_client.chat.completions.create(
            model=Config.LLM_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are an intelligent AI assistant. When given document content, "
                        "you read it carefully, understand it fully, and answer the user's question "
                        "in a clear, well-structured, and informative way — like a knowledgeable human would. "
                        "Never blindly copy-paste document text. Never fabricate information. "
                        "Present extracted details in a readable format using bullet points or sections when helpful."
                    ),
                },
                {"role": "user", "content": prompt},
            ],
            temperature=0.4,
            max_tokens=900,
        )
        return completion.choices[0].message.content.strip()
    except Exception as e:
        print(f"Groq error: {e}")
        return "I had trouble processing your request. Please try again."


def sanitize_verbose_response(answer: str, is_conversational: bool = False) -> str:
    """Clean up verbose no-match responses for better UX."""
    import re
    
    # If it's a conversational query and no match, use simple friendly response
    if is_conversational and "couldn't find" in answer.lower():
        return "I don't see that in your documents."
    
    # Remove verbose source listings
    patterns = [
        r"The provided PDFs contain.*?(?:but|and) none of them",
        r"The documents appear to contain.*?but none of them",
        r"I couldn't find any relevant information related to .* in your uploaded PDF documents\.",
        r"Please make sure your PDF contains the relevant information or try uploading a different document\.",
    ]
    
    result = answer
    for pattern in patterns:
        result = re.sub(pattern, "", result, flags=re.IGNORECASE)
    
    # Clean extra whitespace
    result = re.sub(r'\s+', ' ', result).strip()
    
    return result if result else "I don't have that information available."


async def hybrid_search(
    question: str,
    user_id: str,
    search_type: str = "hybrid",
    conversation_context: Optional[str] = None,
    filename: Optional[str] = None,
) -> Dict[str, Any]:
    """Search PDFs first, then optional web, with smart fallback and conversation awareness."""
    search_type = (search_type or "hybrid").lower()
    if search_type not in {"closed", "open", "hybrid"}:
        search_type = "hybrid"

    intent = classify_query_intent(
        question=question,
        search_type=search_type,
        filename=filename,
        conversation_context=conversation_context,
    )
    print(f"Query intent: {intent}")

    if intent == "conversation":
        return {
            "answer": generate_conversational_answer(question, conversation_context),
            "sources": [],
            "search_type_used": "Conversation",
            "closed_source_count": 0,
            "open_source_count": 0,
            "rewritten_query": question,
        }

    if intent == "document":
        search_type = "closed"
    elif intent == "web":
        search_type = "open"
    
    retrieval_query = rewrite_query_for_retrieval(
        question,
        conversation_context,
        filename=filename,
        intent=intent,
    )
    if retrieval_query != question:
        print(f"Rewritten retrieval query: {retrieval_query}")

    closed_results = []
    open_results = []

    print(f"Search type: {search_type}")

    if search_type != "open":
        try:
            closed_results = search_closed_domain(retrieval_query, user_id, top_k=8, filename=filename)
            print(f"PDF results (before relevance filter): {len(closed_results)}")
            
            # Filter by relevance threshold
            closed_results = filter_results_by_relevance(closed_results, MIN_RELEVANCE_SCORE)
            print(f"PDF results (after relevance filter): {len(closed_results)}")
            
            if closed_results:
                for result in closed_results[:2]:
                    print(f"   - From PDF: {result.get('filename', 'Unknown')} (score: {result.get('similarity', 0):.2f})")
        except Exception as e:
            print(f"PDF search error: {e}")

    # Fall back to web search if: open search type OR (hybrid mode AND no good PDF results)
    if search_type == "open" or (search_type == "hybrid" and len(closed_results) == 0):
        try:
            open_results = search_open_domain(retrieval_query, top_k=3)
            print(f"Web results: {len(open_results)}")
        except Exception as e:
            print(f"Web search error: {e}")

    all_sources = []
    for result in closed_results:
        result["source_type"] = "PDF Document"
        all_sources.append(result)
    for result in open_results:
        result["source_type"] = "Web Search"
        all_sources.append(result)

    all_sources = _dedupe_sources(all_sources)
    all_sources = rerank_with_cohere(retrieval_query, all_sources, top_n=5)

    answer = generate_answer(question, all_sources, conversation_context)
    
    # Clean up verbose responses for better UX
    answer = sanitize_verbose_response(answer, is_conversational=False)

    # Determine what sources to show
    response_sources = []
    
    for source in all_sources[:3]:
        if source.get("source_type") == "PDF Document":
            display_name = source.get("filename", "PDF Document")[:40]
        else:
            display_name = source.get("title", "Web Result")[:40]

        response_sources.append(
            {
                "type": source.get("source_type"),
                "title": display_name,
                "content": source.get("content", "")[:200],
                "url": source.get("url", ""),
            }
        )

    mode_used = "PDF Document" if closed_results else ("Web Search" if open_results else "No results")

    return {
        "answer": answer,
        "sources": response_sources,
        "search_type_used": mode_used,
        "closed_source_count": len(closed_results),
        "open_source_count": len(open_results),
        "rewritten_query": retrieval_query,
    }
