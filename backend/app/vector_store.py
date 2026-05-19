import os
from typing import List, Dict, Any
from pypdf import PdfReader
from groq import Groq
from supabase import create_client
from .config import Config

# Initialize Groq client
groq_client = Groq(api_key=Config.GROQ_API_KEY)

# Initialize Supabase client
supabase = create_client(Config.SUPABASE_URL, Config.SUPABASE_ANON_KEY)

def get_embedding(text: str) -> list:
    """Get embedding from Groq API using nomic-embed-text model"""
    try:
        # Clean the text - remove newlines and extra spaces
        text = text.replace("\n", " ").strip()
        
        # Call Groq's embeddings API
        response = groq_client.embeddings.create(
            model="nomic-embed-text-v1.5",  # Groq's embedding model
            input=text,
            encoding_format="float"
        )
        return response.data[0].embedding
    except Exception as e:
        print(f"Embedding error for text '{text[:50]}...': {e}")
        return None

def process_and_store_pdf(file_path: str, user_id: str, filename: str) -> int:
    """Process PDF, chunk it, get embeddings via Groq API, store in Supabase"""
    
    # Extract text from PDF
    reader = PdfReader(file_path)
    text = ""
    for page in reader.pages:
        page_text = page.extract_text()
        if page_text:
            text += page_text
    
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
    
    # Get embeddings for each chunk via Groq API
    successful_chunks = 0
    for i, chunk in enumerate(chunks):
        print(f"Processing chunk {i+1}/{len(chunks)}...")
        embedding = get_embedding(chunk)
        if embedding:
            supabase.table("document_chunks").insert({
                "user_id": user_id,
                "filename": filename,
                "chunk_text": chunk,
                "chunk_index": i,
                "embedding": embedding
            }).execute()
            successful_chunks += 1
    
    # Record in user_documents table
    supabase.table("user_documents").insert({
        "user_id": user_id,
        "filename": filename,
        "chunk_count": successful_chunks
    }).execute()
    
    return successful_chunks

def search_similar_chunks(question: str, user_id: str, top_k: int = 5) -> List[Dict[str, Any]]:
    """Search for similar chunks using Groq API for question embedding"""
    
    # Get embedding for the question via Groq API
    question_embedding = get_embedding(question)
    if not question_embedding:
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
