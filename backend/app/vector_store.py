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

def semantic_chunking(text: str, max_chunk_size: int = 1500) -> List[str]:
    """
    Split text semantically by paragraphs and sections.
    Preserves natural boundaries instead of arbitrary character splits.
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
        
        # If single paragraph is too large, split it
        if para_size > max_chunk_size:
            # Split long paragraph into sentences
            sentences = re.split(r'(?<=[.!?])\s+', para)
            for sentence in sentences:
                if current_size + len(sentence) > max_chunk_size and current_chunk:
                    chunks.append(' '.join(current_chunk))
                    current_chunk = [sentence]
                    current_size = len(sentence)
                else:
                    current_chunk.append(sentence)
                    current_size += len(sentence)
        else:
            # Add paragraph to current chunk
            if current_size + para_size > max_chunk_size and current_chunk:
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

def extract_structured_text(file_path: str) -> str:
    """Extract text from PDF while preserving structure"""
    reader = PdfReader(file_path)
    text = ""
    
    for page_num, page in enumerate(reader.pages):
        try:
            # Try to extract with layout preservation
            page_text = page.extract_text(extraction_mode="layout")
            if not page_text:
                page_text = page.extract_text()
            text += f"\n--- Page {page_num + 1} ---\n"
            text += page_text
        except:
            # Fallback to simple extraction
            text += page.extract_text()
    
    return text

def get_embedding(text: str) -> list:
    """Generate embedding using local sentence-transformers model"""
    try:
        # Clean text
        text = text.replace("\n", " ").strip()
        if not text:
            return None
        # Generate embedding
        embedding = embedding_model.encode(text).tolist()
        return embedding
    except Exception as e:
        print(f"❌ Embedding error: {e}", flush=True)
        return None

def process_and_store_pdf(file_path: str, user_id: str, filename: str) -> int:
    """Process PDF with semantic chunking and store in Supabase"""
    
    print(f"📄 Processing PDF: {filename}", flush=True)
    
    # Extract structured text
    try:
        text = extract_structured_text(file_path)
        
        if not text.strip():
            print("❌ No text extracted from PDF", flush=True)
            return 0
        
        print(f"📝 Total text: {len(text)} chars", flush=True)
    except Exception as e:
        print(f"❌ PDF read error: {e}", flush=True)
        return 0
    
    # Use semantic chunking instead of fixed-size chunks
    chunks = semantic_chunking(text)
    print(f"📦 Created {len(chunks)} semantic chunks", flush=True)
    
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
    
    # Query Supabase for similar chunks
    try:
        response = supabase.rpc(
            'match_documents',
            {
                'query_embedding': question_embedding,
                'match_user_id': user_id,
                'match_count': top_k * 2  # Get more for reranking
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
