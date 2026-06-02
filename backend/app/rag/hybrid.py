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


def rewrite_query_for_retrieval(question: str, conversation_context: Optional[str] = None) -> str:
    """Turn a follow-up question into a standalone retrieval query."""
    if not conversation_context:
        return question

    trimmed_context = conversation_context[-3000:]
    prompt = f"""Rewrite the latest user question as a standalone search query.

Conversation:
{trimmed_context}

Latest question:
{question}

Rules:
- Preserve names, dates, document-specific terms, and user intent.
- Resolve pronouns and references using the conversation.
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


def generate_answer(question: str, sources: List[Dict], conversation_context: Optional[str] = None) -> str:
    """Generate answer using Groq LLM. PDF content remains the primary source."""
    context_section = ""
    if conversation_context:
        context_section = f"Previous conversation:\n{conversation_context}\n\n"

    if not sources:
        prompt = f"""{context_section}The user asked: "{question}"

I have no information from any PDF documents.

Please respond: "I couldn't find any information about this in your uploaded PDF documents. Please make sure your PDF contains the relevant information or try uploading a different document."

Keep it concise and helpful."""
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
            context_parts.append("\nFROM WEB SEARCH (no PDF found):")
            for idx, source in enumerate(web_sources[:3], 1):
                content = source.get("content", "")
                if len(content) > 800:
                    content = content[:800] + "..."
                context_parts.append(f"[Web Source {idx}]\n{content}")

        doc_context = "\n\n---\n\n".join(context_parts)

        prompt = f"""{context_section}Here is information from the user's uploaded PDF documents (PRIMARY SOURCE):

{doc_context}

The user asked: "{question}"

CRITICAL INSTRUCTIONS:
1. Answer based ONLY on the PDF DOCUMENTS above when PDF sources are present.
2. If the PDF contains the answer, use it directly and quote from it.
3. If the PDF does NOT contain the answer, say: "I couldn't find this information in your uploaded PDF document."
4. Do NOT use general knowledge or make up information.
5. Be specific and cite what the PDF actually says.
6. Keep your answer concise (2-3 sentences max unless more is needed).

Your answer based on the retrieved sources:"""

    try:
        completion = groq_client.chat.completions.create(
            model=Config.LLM_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": "You are a document search assistant. Answer only from the provided retrieved content. If the answer is not there, say so directly. Be concise.",
                },
                {"role": "user", "content": prompt},
            ],
            temperature=0.2,
            max_tokens=500,
        )
        return completion.choices[0].message.content.strip()
    except Exception as e:
        print(f"Groq error: {e}")
        return "I had trouble processing your request. Please try again."


async def hybrid_search(
    question: str,
    user_id: str,
    search_type: str = "hybrid",
    conversation_context: Optional[str] = None,
    filename: Optional[str] = None,
) -> Dict[str, Any]:
    """Search PDFs first, then optional web, with query rewriting and reranking."""
    retrieval_query = rewrite_query_for_retrieval(question, conversation_context)
    if retrieval_query != question:
        print(f"Rewritten retrieval query: {retrieval_query}")

    closed_results = []
    open_results = []

    print(f"Search type: {search_type}")

    if search_type != "open":
        try:
            closed_results = search_closed_domain(retrieval_query, user_id, top_k=8, filename=filename)
            print(f"PDF results: {len(closed_results)}")
            if closed_results:
                for result in closed_results[:2]:
                    print(f"   - From PDF: {result.get('filename', 'Unknown')}")
        except Exception as e:
            print(f"PDF search error: {e}")

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
