import os
import sys
import re
from typing import List, Dict, Any
from pypdf import PdfReader
import cohere
from supabase import create_client
from .config import Config

# ============================================
# INITIALIZE COHERE CLIENT (Cloud API - no local model!)
# ============================================
print("🔄 Initializing Cohere API client...", flush=True)
cohere_client = cohere.Client(api_key=Config.COHERE_API_KEY)
print("✅ Cohere client ready (using cloud embeddings)", flush=True)

# Initialize Supabase client
supabase = create_client(Config.SUPABASE_URL, Config.SUPABASE_ANON_KEY)

def get_embedding(text: str) -> list:
    """Get embedding from Cohere API (cloud, no RAM usage)"""
    try:
        # Clean and truncate text (Cohere has 512 token limit)
        text = text.replace("\n", " ").strip()[:2000]
        if not text:
            return None
        
        # Call Cohere API
        response = cohere_client.embed(
            texts=[text],
            model="embed-english-v4.0",
            input_type="search_document"  # For documents being indexed
        )
        
        embedding = response.embeddings[0]
        print(f"✅ Got embedding (dimensions: {len(embedding)})", flush=True)
        return embedding
    except Exception as e:
        print(f"❌ Cohere embedding error: {e}", flush=True)
        return None

def chunk_text(text: str, chunk_size: int = 1000, overlap: int = 150) -> List[str]:
    """Simple, memory-efficient chunking"""
    chunks = []
    start = 0
    
    while start < len(text):
        end = min(start + chunk_size, len(text))
        chunk = text[start:end]
        
        # Try to break at a sentence boundary
        if end < len(text):
            last_period = chunk.rfind('.')
            if last_period > chunk_size // 2:
                end = start + last_period + 1
                chunk = text[start:end]
        
        if chunk.strip():
            chunks.append(chunk.strip())
        
        start = end - overlap
    
    return chunks

def extract_text_simple(file_path: str) -> str:
    """Simple text extraction"""
    reader = PdfReader(file_path)
    text = ""
    for page in reader.pages:
        page_text = page.extract_text()
        if page_text:
            text += page_text + "\n\n"
    return text

def process_and_store_pdf(file_path: str, user_id: str, filename: str) -> int:
    """Process PDF using Cohere API for embeddings"""
    
    print(f"📄 Processing PDF: {filename}", flush=True)
    
    # Extract text
    try:
        text = extract_text_simple(file_path)
        if not text.strip():
            print("❌ No text extracted", flush=True)
            return 0
        print(f"📝 Total text: {len(text)} chars", flush=True)
    except Exception as e:
        print(f"❌ PDF read error: {e}", flush=True)
        return 0
    
    # Chunk text
    chunks = chunk_text(text)
    print(f"📦 Created {len(chunks)} chunks", flush=True)
    
    if not chunks:
        return 0
    
    # Process chunks one by one
    successful = 0
    for i, chunk in enumerate(chunks):
        print(f"  Chunk {i+1}/{len(chunks)}: {len(chunk)} chars", flush=True)
        
        # Get embedding from Cohere API
        embedding = get_embedding(chunk)
        if embedding:
            try:
                supabase.table("document_chunks").insert({
                    "user_id": user_id,
                    "filename": filename,
                    "chunk_text": chunk[:1000],
                    "chunk_index": i,
                    "embedding": embedding
                }).execute()
                successful += 1
                print(f"    ✅ Stored in Supabase", flush=True)
            except Exception as e:
                print(f"    ❌ DB error: {e}", flush=True)
    
    # Record in user_documents
    if successful > 0:
        try:
            supabase.table("user_documents").insert({
                "user_id": user_id,
                "filename": filename,
                "chunk_count": successful
            }).execute()
            print(f"✅ Stored {successful}/{len(chunks)} chunks", flush=True)
        except Exception as e:
            print(f"❌ Record error: {e}", flush=True)
    
    return successful

def search_similar_chunks(question: str, user_id: str, top_k: int = 5) -> List[Dict[str, Any]]:
    """Search using Cohere API for query embedding"""
    
    print(f"🔍 Searching: {question[:50]}...", flush=True)
    
    # Get embedding for question (using search_query type)
    try:
        response = cohere_client.embed(
            texts=[question],
            model="embed-english-v4.0",
            input_type="search_query"
        )
        question_embedding = response.embeddings[0]
    except Exception as e:
        print(f"❌ Query embedding error: {e}", flush=True)
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
        
        return results
    except Exception as e:
        print(f"❌ Search error: {e}", flush=True)
        return []

def delete_user_documents(user_id: str, filename: str = None):
    """Delete documents"""
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
