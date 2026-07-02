import math
import os
import re
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, List, Optional

from pypdf import PdfReader
from sentence_transformers import SentenceTransformer
from supabase import create_client

from .config import Config

print("Loading embedding model (paraphrase-MiniLM-L3-v2)...", flush=True)
embedding_model = SentenceTransformer("paraphrase-MiniLM-L3-v2")
print("Small model loaded successfully", flush=True)

supabase = create_client(Config.SUPABASE_URL, Config.SUPABASE_ANON_KEY)

KEYWORD_CANDIDATE_LIMIT = int(os.getenv("KEYWORD_CANDIDATE_LIMIT", "100"))
KEYWORD_TOP_K_MULTIPLIER = int(os.getenv("KEYWORD_TOP_K_MULTIPLIER", "2"))
TOKEN_RE = re.compile(r"[a-zA-Z0-9_]+")


def get_embedding(text: str) -> Optional[list]:
    """Generate embedding using the local sentence-transformers model."""
    try:
        text = text.replace("\n", " ").strip()
        if not text:
            return None
        return embedding_model.encode(text).tolist()
    except Exception as e:
        print(f"Embedding error: {e}", flush=True)
        return None


def _tokenize(text: str) -> List[str]:
    return TOKEN_RE.findall((text or "").lower())


def _dedupe_results(results: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    seen = set()
    unique = []
    for result in results:
        key = (
            result.get("filename", ""),
            result.get("chunk_index", ""),
            result.get("content", "")[:160],
        )
        if key in seen:
            continue
        seen.add(key)
        unique.append(result)
    return unique


def process_and_store_pdf(file_path: str, user_id: str, filename: str) -> int:
    """Process PDF, chunk it, batch-generate embeddings locally, and batch-store in Supabase."""
    print(f"Processing PDF: {filename}", flush=True)

    try:
        reader = PdfReader(file_path)
        text = ""
        for page_num, page in enumerate(reader.pages):
            page_text = page.extract_text()
            if page_text:
                text += page_text
                print(f"  Page {page_num + 1}: {len(page_text)} chars", flush=True)

        if not text.strip():
            print("No text extracted from PDF", flush=True)
            return 0

        print(f"Total text: {len(text)} chars", flush=True)
    except Exception as e:
        print(f"PDF read error: {e}", flush=True)
        return 0

    chunks = []
    chunk_size = 800
    overlap = 150

    for i in range(0, len(text), chunk_size - overlap):
        chunk = text[i:i + chunk_size]
        if chunk.strip():
            chunks.append(chunk)

    print(f"Created {len(chunks)} chunks", flush=True)

    if not chunks:
        return 0

    successful = 0
    batch_size = 10

    for i in range(0, len(chunks), batch_size):
        batch_chunks = chunks[i:i + batch_size]
        print(f"  Processing batch {i // batch_size + 1} (chunks {i + 1} to {min(i + batch_size, len(chunks))}/{len(chunks)})", flush=True)

        # Batch-encode embeddings
        processed_texts = [t.replace("\n", " ").strip() for t in batch_chunks]

        try:
            embeddings = embedding_model.encode(processed_texts).tolist()
            records = []
            for j, (chunk, emb) in enumerate(zip(batch_chunks, embeddings)):
                if emb:
                    records.append(
                        {
                            "user_id": user_id,
                            "filename": filename,
                            "chunk_text": chunk,
                            "chunk_index": i + j,
                            "embedding": [float(val) for val in emb],
                        }
                    )

            if records:
                supabase.table("document_chunks").insert(records).execute()
                successful += len(records)
                print(f"    Stored {len(records)} chunks in Supabase", flush=True)
        except Exception as e:
            print(f"    Batch processing/Supabase error: {e}", flush=True)

    if successful > 0:
        try:
            # Check if document already exists
            existing = supabase.table("user_documents").select("*").eq("user_id", user_id).eq("filename", filename).execute()
            if existing.data:
                supabase.table("user_documents").update({"chunk_count": successful}).eq("user_id", user_id).eq("filename", filename).execute()
            else:
                supabase.table("user_documents").insert(
                    {
                        "user_id": user_id,
                        "filename": filename,
                        "chunk_count": successful,
                    }
                ).execute()
            print(f"Successfully stored {successful}/{len(chunks)} chunks", flush=True)
        except Exception as e:
            print(f"Failed to record document: {e}", flush=True)
    else:
        print("No chunks were successfully stored", flush=True)

    return successful


def _filter_by_filename(results: List[Dict[str, Any]], filename: Optional[str]) -> List[Dict[str, Any]]:
    if not filename:
        return results
    return [result for result in results if result.get("filename") == filename]


def search_semantic_chunks(
    question: str,
    user_id: str,
    top_k: int = 5,
    filename: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Search for similar chunks using Supabase vector similarity."""
    print(f"Semantic search for: {question[:50]}...", flush=True)

    question_embedding = get_embedding(question)
    if not question_embedding:
        print("Failed to generate question embedding", flush=True)
        return []

    try:
        response = supabase.rpc(
            "match_documents",
            {
                "query_embedding": question_embedding,
                "match_user_id": user_id,
                "match_count": top_k * 3 if filename else top_k,
            },
        ).execute()

        results = []
        if response.data:
            for row in response.data:
                similarity_score = row.get("similarity", 0.5)  # Default to 0.5 if missing
                results.append(
                    {
                        "content": row["chunk_text"],
                        "similarity": similarity_score,
                        "score": similarity_score,  # Add unified score field
                        "filename": row["filename"],
                        "chunk_index": row.get("chunk_index"),
                        "retrieval_type": "semantic",
                        "type": "closed_domain",
                    }
                )
            print(f"Semantic results: {len(results)}", flush=True)
        else:
            print("No semantic results found", flush=True)

        results = _filter_by_filename(results, filename)
        return results[:top_k]
    except Exception as e:
        print(f"Semantic search error: {e}", flush=True)
        return []


def search_keyword_chunks(
    question: str,
    user_id: str,
    top_k: int = 5,
    filename: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Lightweight BM25-style keyword search over a capped chunk set."""
    query_terms = _tokenize(question)
    if not query_terms:
        return []

    try:
        query = (
            supabase.table("document_chunks")
            .select("filename,chunk_text,chunk_index")
            .eq("user_id", user_id)
        )
        if filename:
            query = query.eq("filename", filename)
        response = query.limit(KEYWORD_CANDIDATE_LIMIT).execute()
    except Exception as e:
        print(f"Keyword fetch error: {e}", flush=True)
        return []

    rows = response.data or []
    if not rows:
        return []

    docs = []
    doc_freq = Counter()
    for row in rows:
        tokens = _tokenize(row.get("chunk_text", ""))
        token_counts = Counter(tokens)
        docs.append((row, tokens, token_counts))
        for term in set(tokens):
            doc_freq[term] += 1

    total_docs = len(docs)
    avgdl = sum(len(tokens) for _, tokens, _ in docs) / max(total_docs, 1)
    k1 = 1.2
    b = 0.75
    scores = []

    for row, tokens, token_counts in docs:
        dl = len(tokens) or 1
        score = 0.0
        for term in query_terms:
            tf = token_counts.get(term, 0)
            if tf == 0:
                continue
            idf = math.log(1 + (total_docs - doc_freq[term] + 0.5) / (doc_freq[term] + 0.5))
            denom = tf + k1 * (1 - b + b * dl / max(avgdl, 1))
            score += idf * (tf * (k1 + 1) / denom)
        if score > 0:
            scores.append((score, row))

    scores.sort(key=lambda item: item[0], reverse=True)
    results = []
    
    # Normalize keyword scores to 0-1 range for consistency
    max_score = max([s for s, _ in scores]) if scores else 1
    for score, row in scores[:top_k]:
        normalized_score = min(score / max_score, 1.0) if max_score > 0 else 0.5
        results.append(
            {
                "content": row.get("chunk_text", ""),
                "keyword_score": normalized_score,
                "similarity": normalized_score,  # Add unified field
                "score": normalized_score,      # Add unified score field
                "filename": row.get("filename", "Unknown"),
                "chunk_index": row.get("chunk_index"),
                "retrieval_type": "keyword",
                "type": "closed_domain",
            }
        )

    print(f"Keyword results: {len(results)}", flush=True)
    return results


def search_similar_chunks(
    question: str,
    user_id: str,
    top_k: int = 5,
    filename: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Hybrid PDF retrieval: semantic search plus capped keyword matching.
    
    When a specific filename is provided, uses semantic-only search (faster).
    Otherwise runs semantic and keyword searches in parallel.
    """
    print(f"\n🔍 Hybrid search for: '{question[:50]}'", flush=True)
    
    semantic_results = []
    keyword_results = []
    
    # When querying a specific file, semantic search alone is sufficient
    # This saves ~500-1000ms by skipping keyword fetch + BM25 scoring
    if filename:
        print(f"  📎 Single-doc mode (semantic only) for: {filename}", flush=True)
        try:
            semantic_results = search_semantic_chunks(question, user_id, top_k=top_k, filename=filename)
        except Exception as e:
            print(f"Semantic search failed: {e}", flush=True)
    else:
        keyword_top_k = max(top_k, top_k * KEYWORD_TOP_K_MULTIPLIER)
        
        # Run both searches concurrently — they are completely independent
        with ThreadPoolExecutor(max_workers=2) as executor:
            semantic_future = executor.submit(
                search_semantic_chunks, question, user_id, top_k=top_k, filename=filename
            )
            keyword_future = executor.submit(
                search_keyword_chunks, question, user_id, top_k=keyword_top_k, filename=filename
            )
            
            try:
                semantic_results = semantic_future.result(timeout=8)
            except Exception as e:
                print(f"Semantic search failed: {e}", flush=True)
            
            try:
                keyword_results = keyword_future.result(timeout=8)
            except Exception as e:
                print(f"Keyword search failed: {e}", flush=True)

    combined = _dedupe_results(semantic_results + keyword_results)
    
    # Ensure all results have a unified score field
    for result in combined:
        if "score" not in result:
            result["score"] = result.get("similarity", result.get("keyword_score", 0.3))
        if "similarity" not in result:
            result["similarity"] = result.get("score", 0.3)
    
    # Sort by score (higher is better)
    combined.sort(key=lambda x: x.get("score", 0), reverse=True)
    
    print(f"📄 Combined PDF results: {len(combined[:top_k])}", flush=True)
    return combined[:top_k]


def delete_user_documents(user_id: str, filename: str = None):
    """Delete a user's documents."""
    try:
        if filename:
            supabase.table("document_chunks").delete().eq("user_id", user_id).eq("filename", filename).execute()
            supabase.table("user_documents").delete().eq("user_id", user_id).eq("filename", filename).execute()
        else:
            supabase.table("document_chunks").delete().eq("user_id", user_id).execute()
            supabase.table("user_documents").delete().eq("user_id", user_id).execute()
        return True
    except Exception as e:
        print(f"Error deleting: {e}")
        return False
