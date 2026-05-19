import os
import sys
import re
from typing import List, Dict, Any
from pypdf import PdfReader
from sentence_transformers import SentenceTransformer
from supabase import create_client
from .config import Config

# ============================================
# LOAD MODEL
# ============================================
print("🔄 Loading embedding model (paraphrase-MiniLM-L3-v2)...", flush=True)
embedding_model = SentenceTransformer('paraphrase-MiniLM-L3-v2')
print("✅ Model loaded successfully", flush=True)

# Initialize Supabase client
supabase = create_client(Config.SUPABASE_URL, Config.SUPABASE_ANON_KEY)

def chunk_text(text: str, chunk_size: int = 800, overlap: int = 100) -> List[str]:
    """
    Memory-efficient text chunking with smaller chunk size
    """
    chunks = []
    start = 0
    text_length = len(text)
    
    while start < text_length:
        end = min(start + chunk_size, text_length)
        chunk = text[start:end]
        
        # Try to break at a sentence boundary
        if end < text_length:
            last_period = chunk.rfind('.')
            last_newline = chunk.rfind('\n')
            break_point = max(last_period, last_newline)
            if break_point > chunk_size // 2:
                end = start + break_point + 1
                chunk = text[start:end]
        
        if chunk.strip():
            chunks.append(chunk.strip())
        
        start = end - overlap
    
    return chunks

def extract_text_simple(file_path: str) -> str:
    """Simple text extraction (memory efficient)"""
    reader = PdfReader(file_path)
    text = ""
    for page in reader.pages:
        page_text = page.extract_text()
        if page_text:
            text += page_text + "\n"
    return text

def get_embedding(text: str) -> list:
    """Generate embedding using local sentence-transformers model"""
    try:
        # Limit text length to prevent memory spikes
        text = text.replace("\n", " ").strip()[:2000]
        if not text:
            return None
        embedding = embedding_model.encode(text).tolist()
        return embedding
    except Exception as e:
        print(f"❌ Embedding error: {e}", flush=True)
        return None

def process_and_store_pdf(file_path: str, user_id: str, filename: str) -> int:
    """Process PDF with memory-efficient settings"""
    
    print(f"📄 Processing PDF: {filename}", flush=True)
    
    # Extract text simply (no layout preservation)
    try:
        text = extract_text_simple(file_path)
        
        if not text.strip():
            print("❌ No text extracted from PDF", flush=True)
            return 0
        
        print(f"📝 Total text: {len(text)} chars", flush=True)
    except Exception as e:
        print(f"❌ PDF read error: {e}", flush=True)
        return 0
    
    # Use smaller chunk size
    chunks = chunk_text(text, chunk_size=800, overlap=100)
    print(f"📦 Created {len(chunks)} chunks", flush=True)
    
    if not chunks:
        return 0
    
    # Process each chunk one by one (not all at once)
    successful = 0
    for i, chunk in enumerate(chunks):
        print(f"  Chunk {i+1}/{len(chunks)}: {len(chunk)} chars", flush=True)
        
        # Clear memory occasionally
        if i % 5 == 0 and i > 0:
            import gc
            gc.collect()
        
        embedding = get_embedding(chunk)
        if embedding:
            try:
                supabase.table("document_chunks").insert({
                    "user_id": user_id,
                    "filename": filename,
                    "chunk_text": chunk[:1000],  # Store limited text
                    "chunk_index": i,
                    "embedding": embedding
                }).execute()
                successful += 1
                print(f"    ✅ Stored in Supabase", flush=True)
            except Exception as e:
                print(f"    ❌ Supabase error: {e}", flush=True)
        else:
            print(f"    ❌ Embedding failed", flush=True)
    
    # Record in user_documents
    if successful > 0:
        try:
            supabase.table("user_documents").insert({
                "user_id": user_id,
                "filename": filename,
                "chunk_count": successful
            }).execute()
            print(f"✅ Successfully stored {successful}/{len(chunks)} chunks", flush=True)
        except Exception as e:
            print(f"❌ Failed to record document: {e}", flush=True)
    else:
        print("❌ No chunks were successfully stored", flush=True)
    
    return successful

def search_similar_chunks(question: str, user_id: str, top_k: int = 4) -> List[Dict[str, Any]]:
    """Search for similar chunks (reduced top_k for memory)"""
    
    print(f"🔍 Searching for: {question[:50]}...", flush=True)
    
    # Generate embedding for the question
    question_embedding = get_embedding(question)
    if not question_embedding:
        print("❌ Failed to generate question embedding", flush=True)
        return []
    
    # Query Supabase
    try:
        response = supabase.rpc(
            'match_documents',
            {
                'query_embedding': question_embedding,
                'match_user_id': user_id,
                'match_count': top_k
            }
        ).execute()
        
        results = []
        if response.data:
            for row in response.data:
                results.append({
                    "content": row['chunk_text'],
                    "similarity": row.get('similarity', 0),
                    "filename": row['filename'],
                    "type": "closed_domain"
                })
            print(f"✅ Found {len(results)} results", flush=True)
        else:
            print("❌ No results found", flush=True)
        
        return results
    except Exception as e:
        print(f"❌ Search error: {e}", flush=True)
        return []

def delete_user_documents(user_id: str, filename: str = None):
    """Delete a user's documents"""
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
