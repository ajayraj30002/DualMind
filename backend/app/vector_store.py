import hashlib
import os
from typing import List, Dict, Any
from pypdf import PdfReader
from sentence_transformers import SentenceTransformer
from supabase import create_client
from .config import Config
 
# ============================================
# CRITICAL FIX: Load model ONCE at startup
# This prevents out-of-memory errors on Render
# ============================================
print("🔄 Loading embedding model (all-MiniLM-L6-v2)...")
embedding_model = SentenceTransformer('all-MiniLM-L6-v2')
print("✅ Model loaded and ready")

# Initialize Supabase client
supabase = create_client(Config.SUPABASE_URL, Config.SUPABASE_ANON_KEY)

def process_and_store_pdf(file_path: str, user_id: str, filename: str) -> int:
    """Process PDF, generate chunks, embed them, and store in Supabase pgvector"""
    
    # Extract text from PDF
    reader = PdfReader(file_path)
    text = ""
    for page in reader.pages:
        text += page.extract_text()
    
    if not text.strip():
        return 0
    
    # Split into chunks (500 chars with 100 char overlap)
    chunks = []
    chunk_size = 500
    overlap = 100
    
    for i in range(0, len(text), chunk_size - overlap):
        chunk = text[i:i + chunk_size]
        if chunk.strip():
            chunks.append(chunk)
    
    if not chunks:
        return 0
    
    # Generate embeddings for all chunks
    embeddings = embedding_model.encode(chunks).tolist()
    
    # Store each chunk in Supabase
    for i, (chunk, embedding) in enumerate(zip(chunks, embeddings)):
        supabase.table("document_chunks").insert({
            "user_id": user_id,
            "filename": filename,
            "chunk_text": chunk,
            "chunk_index": i,
            "embedding": embedding
        }).execute()
    
    # Also record in user_documents table
    supabase.table("user_documents").insert({
        "user_id": user_id,
        "filename": filename,
        "chunk_count": len(chunks)
    }).execute()
    
    return len(chunks)

def search_similar_chunks(question: str, user_id: str, top_k: int = 5) -> List[Dict[str, Any]]:
    """Search for similar chunks using pgvector similarity"""
    
    # Generate embedding for the question (reuses loaded model)
    question_embedding = embedding_model.encode([question]).tolist()[0]
    
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
    except Exception as e:
        print(f"Search error: {e}")
        return []
    
    # Format results
    results = []
    if response.data:
        for row in response.data:
            results.append({
                "content": row['chunk_text'],
                "similarity": row.get('similarity', 0),
                "filename": row['filename'],
                "type": "closed_domain"
            })
    
    return results

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
