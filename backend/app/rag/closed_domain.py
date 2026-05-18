import os
import hashlib
from typing import List, Dict, Any
from pypdf import PdfReader
from sentence_transformers import SentenceTransformer
import chromadb
from chromadb.config import Settings
from ..config import Config

# Initialize embedding model
embedding_model = SentenceTransformer(Config.EMBEDDING_MODEL)

# Initialize ChromaDB client (persistent storage)
chroma_client = chromadb.Client(Settings(
    chroma_db_impl="duckdb+parquet",
    persist_directory=Config.CHROMA_PERSIST_DIR,
    anonymized_telemetry=False
))

def get_or_create_collection(user_id: str):
    """Get or create a ChromaDB collection for a specific user"""
    collection_name = f"user_{user_id}_docs"
    
    try:
        collection = chroma_client.get_collection(name=collection_name)
    except:
        collection = chroma_client.create_collection(name=collection_name)
    
    return collection

def process_pdf(file_path: str, user_id: str) -> int:
    """
    Process a PDF file: extract text, chunk it, embed it, and store in ChromaDB
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
    
    # Create unique IDs for each chunk
    file_hash = hashlib.md5(file_path.encode()).hexdigest()[:8]
    ids = [f"{file_hash}_{i}" for i in range(len(chunks))]
    
    # Metadatas for each chunk
    metadatas = [
        {
            "filename": os.path.basename(file_path),
            "chunk_index": i,
            "user_id": user_id
        }
        for i in range(len(chunks))
    ]
    
    # Store in ChromaDB
    collection = get_or_create_collection(user_id)
    
    # Add in batches to avoid issues
    batch_size = 100
    for i in range(0, len(chunks), batch_size):
        batch_end = min(i + batch_size, len(chunks))
        collection.add(
            embeddings=embeddings[i:batch_end],
            documents=chunks[i:batch_end],
            metadatas=metadatas[i:batch_end],
            ids=ids[i:batch_end]
        )
    
    return len(chunks)

def search_closed_domain(question: str, user_id: str, top_k: int = 5) -> List[Dict[str, Any]]:
    """
    Search user's uploaded documents for relevant chunks
    Returns list of relevant chunks with metadata
    """
    collection = get_or_create_collection(user_id)
    
    # Check if collection has any documents
    try:
        count = collection.count()
        if count == 0:
            return []
    except:
        return []
    
    # Encode the question
    question_embedding = embedding_model.encode([question]).tolist()
    
    # Query ChromaDB
    results = collection.query(
        query_embeddings=question_embedding,
        n_results=min(top_k, count)
    )
    
    # Format results
    documents = []
    if results['documents'] and results['documents'][0]:
        for i, doc in enumerate(results['documents'][0]):
            documents.append({
                "content": doc,
                "score": results['distances'][0][i] if results['distances'] else 0,
                "filename": results['metadatas'][0][i].get('filename', 'unknown') if results['metadatas'] else 'unknown',
                "type": "closed_domain"
            })
    
    return documents

def delete_user_collection(user_id: str):
    """Delete a user's entire collection (when user deletes account)"""
    collection_name = f"user_{user_id}_docs"
    try:
        chroma_client.delete_collection(name=collection_name)
        return True
    except:
        return False