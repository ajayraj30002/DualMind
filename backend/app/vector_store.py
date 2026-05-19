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

def lightweight_semantic_chunking(text: str, chunk_size: int = 1000, overlap: int = 150) -> List[str]:
    """
    Lightweight semantic chunking:
    - Splits by paragraphs first
    - Merges small paragraphs
    - Preserves natural boundaries
    - Memory efficient
    """
    # Split by double newlines (paragraphs)
    paragraphs = re.split(r'\n\s*\n', text)
    
    chunks = []
    current_chunk = []
    current_size = 0
    
    for para in paragraphs:
        para = para.strip()
        if not para:
            continue
        
        para_size = len(para)
        
        # If this paragraph alone exceeds chunk_size, split it
        if para_size > chunk_size:
            # Save current chunk if exists
            if current_chunk:
                chunks.append(' '.join(current_chunk))
                current_chunk = []
                current_size = 0
            
            # Split large paragraph into sentences
            sentences = re.split(r'(?<=[.!?])\s+', para)
            temp_chunk = []
            temp_size = 0
            
            for sent in sentences:
                if temp_size + len(sent) > chunk_size and temp_chunk:
                    chunks.append(' '.join(temp_chunk))
                    temp_chunk = [sent]
                    temp_size = len(sent)
                else:
                    temp_chunk.append(sent)
                    temp_size += len(sent)
            
            if temp_chunk:
                chunks.append(' '.join(temp_chunk))
        
        # Normal paragraph - try to add to current chunk
        elif current_size + para_size > chunk_size and current_chunk:
            chunks.append('\n\n'.join(current_chunk))
            current_chunk = [para]
            current_size = para_size
        else:
            current_chunk.append(para)
            current_size += para_size
    
    # Add last chunk
    if current_chunk:
        chunks.append('\n\n'.join(current_chunk))
    
    return chunks

def extract_text_simple(file_path: str) -> str:
    """Simple text extraction (memory efficient)"""
    reader = PdfReader(file_path)
    text = ""
    for page in reader.pages:
        page_text = page.extract_text()
        if page_text:
            text += page_text + "\n\n"
    return text

def get_embedding(text: str) -> list:
    """Generate embedding"""
    try:
        text = text.replace("\n", " ").strip()[:2000]
        if not text:
            return None
        embedding = embedding_model.encode(text).tolist()
        return embedding
    except Exception as e:
        print(f"❌ Embedding error: {e}", flush=True)
        return None

def process_and_store_pdf(file_path: str, user_id: str, filename: str) -> int:
    """Process PDF with lightweight semantic chunking"""
    
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
    
    # Apply lightweight semantic chunking
    chunks = lightweight_semantic_chunking(text)
    print(f"📦 Created {len(chunks)} semantic chunks", flush=True)
    
    if not chunks:
        return 0
    
    # Process chunks
    successful = 0
    for i, chunk in enumerate(chunks):
        print(f"  Chunk {i+1}/{len(chunks)}: {len(chunk)} chars", flush=True)
        
        # Free memory every 5 chunks
        if i > 0 and i % 5 == 0:
            import gc
            gc.collect()
        
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
                print(f"    ✅ Stored", flush=True)
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
    """Search for similar chunks"""
    
    print(f"🔍 Searching...", flush=True)
    
    question_embedding = get_embedding(question)
    if not question_embedding:
        return []
    
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
