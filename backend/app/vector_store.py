import hashlib
from typing import List, Dict, Any
from pypdf import PdfReader
from sentence_transformers import SentenceTransformer
from supabase import create_client
from .config import Config

# Initialize embedding model (smaller model for lower RAM)
model = SentenceTransformer('all-MiniLM-L6-v2')

# Initialize Supabase client
supabase = create_client(Config.SUPABASE_URL, Config.SUPABASE_ANON_KEY)

def process_and_store_pdf(file_path: str, user_id: str, filename: str) -> int:
    """Process PDF, generate chunks, embed them, and store in Supabase"""
    
    # Extract text from PDF
    reader = PdfReader(file_path)
    text = ""
    for page in reader.pages:
        text += page.extract_text()
    
    if not text.strip():
        return 0
    
    # Split into chunks (500 chars with 100 overlap)
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
    embeddings = model.encode(chunks).tolist()
    
    # Store each chunk in Supabase
    for i, (chunk, embedding) in enumerate(zip(chunks, embeddings)):
        supabase.table("document_chunks").insert({
            "user_id": user_id,
            "filename": filename,
            "chunk_text": chunk,
            "chunk_index": i,
            "embedding": embedding
        }).execute()
    
    return len(chunks)

def search_similar_chunks(question: str, user_id: str, top_k: int = 5) -> List[Dict[str, Any]]:
    """Search for similar chunks using pgvector similarity"""
    
    # Generate embedding for the question
    question_embedding = model.encode([question]).tolist()[0]
    
    # Query Supabase for similar chunks
    response = supabase.rpc(
        'match_documents',
        {
            'query_embedding': question_embedding,
            'match_user_id': user_id,
            'match_count': top_k
        }
    ).execute()
    
    results = []
    for row in response.data:
        results.append({
            "content": row['chunk_text'],
            "filename": row['filename'],
            "similarity": row['similarity'],
            "type": "closed_domain"
        })
    
    return results