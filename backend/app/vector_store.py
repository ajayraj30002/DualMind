import os
import sys
from typing import List, Dict, Any
from pypdf import PdfReader
from sentence_transformers import SentenceTransformer
from supabase import create_client
from .config import Config

# ============================================
# LOAD MODEL WITHOUT TOKEN PARAMETER
# ============================================
print("🔄 Loading embedding model (paraphrase-MiniLM-L3-v2)...", flush=True)

# Load model normally - no token parameter needed for public models
embedding_model = SentenceTransformer('paraphrase-MiniLM-L3-v2')

print("✅ Small model loaded successfully", flush=True)

# Initialize Supabase client
supabase = create_client(Config.SUPABASE_URL, Config.SUPABASE_ANON_KEY)

def get_embedding(text: str) -> list:
    """Generate embedding using local sentence-transformers model"""
    try:
        # Clean text
        text = text.replace("\n", " ").strip()
        if not text:
            return None
        # Generate embedding (returns list of floats)
        embedding = embedding_model.encode(text).tolist()
        return embedding
    except Exception as e:
        print(f"❌ Embedding error: {e}", flush=True)
        return None

def process_and_store_pdf(file_path: str, user_id: str, filename: str) -> int:
    """Process PDF, chunk it, generate embeddings locally, store in Supabase"""
    
    print(f"📄 Processing PDF: {filename}", flush=True)
    
    # Extract text from PDF
    try:
        reader = PdfReader(file_path)
        text = ""
        for page_num, page in enumerate(reader.pages):
            page_text = page.extract_text()
            if page_text:
                text += page_text
                print(f"  Page {page_num + 1}: {len(page_text)} chars", flush=True)
        
        if not text.strip():
            print("❌ No text extracted from PDF", flush=True)
            return 0
        
        print(f"📝 Total text: {len(text)} chars", flush=True)
    except Exception as e:
        print(f"❌ PDF read error: {e}", flush=True)
        return 0
    
    # Split into chunks (500 chars with 100 overlap)
    chunks = []
    chunk_size = 1000
    overlap = 200
    
    for i in range(0, len(text), chunk_size - overlap):
        chunk = text[i:i + chunk_size]
        if chunk.strip():
            chunks.append(chunk)
    
    print(f"📦 Created {len(chunks)} chunks", flush=True)
    
    if not chunks:
        return 0
    
    # Process each chunk
    successful = 0
    for i, chunk in enumerate(chunks):
        print(f"  Chunk {i+1}/{len(chunks)}: {len(chunk)} chars", flush=True)
        embedding = get_embedding(chunk)
        if embedding:
            try:
                supabase.table("document_chunks").insert({
                    "user_id": user_id,
                    "filename": filename,
                    "chunk_text": chunk,
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

def search_similar_chunks(question: str, user_id: str, top_k: int = 5) -> List[Dict[str, Any]]:
    """Search for similar chunks using cosine similarity"""
    
    print(f"🔍 Searching for: {question[:50]}...", flush=True)
    
    # Generate embedding for the question
    question_embedding = get_embedding(question)
    if not question_embedding:
        print("❌ Failed to generate question embedding", flush=True)
        return []
    
    # Query Supabase for similar chunks using the match_documents function
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
