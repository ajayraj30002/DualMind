import os
import hashlib
from typing import List, Dict, Any
from pypdf import PdfReader
from sentence_transformers import SentenceTransformer
from supabase import create_client
from ..config import Config

# Initialize embedding model
embedding_model = SentenceTransformer(Config.EMBEDDING_MODEL)

# Initialize Supabase client
supabase = create_client(Config.SUPABASE_URL, Config.SUPABASE_ANON_KEY)

def process_pdf(file_path: str, user_id: str, filename: str) -> int:
    """
    Process a PDF file: extract text, chunk it, embed it, and store in Supabase pgvector
    Returns number of chunks created
    """
    
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
    
    # Create embeddings for each chunk
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

def search_closed_domain(question: str, user_id: str, top_k: int = 5) -> List[Dict[str, Any]]:
    """
    Search user's uploaded documents for relevant chunks using pgvector
    Returns list of relevant chunks with metadata
    """
    
    # Generate embedding for the question
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
    documents = []
    if response.data:
        for row in response.data:
            documents.append({
                "content": row['chunk_text'],
                "similarity": row.get('similarity', 0),
                "filename": row['filename'],
                "type": "closed_domain"
            })
    
    return documents

def delete_user_collection(user_id: str, filename: str = None):
    """Delete a user's documents"""
    try:
        if filename:
            # Delete specific file
            supabase.table("document_chunks").delete().eq("user_id", user_id).eq("filename", filename).execute()
            supabase.table("user_documents").delete().eq("user_id", user_id).eq("filename", filename).execute()
        else:
            # Delete all user documents
            supabase.table("document_chunks").delete().eq("user_id", user_id).execute()
            supabase.table("user_documents").delete().eq("user_id", user_id).execute()
        return True
    except Exception as e:
        print(f"Error deleting: {e}")
        return False