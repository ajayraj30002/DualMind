import os
import sys
import re
from typing import List, Dict, Any
from pypdf import PdfReader
import cohere
from supabase import create_client
from .config import Config

# Initialize clients
print("🔄 Initializing Cohere API client...", flush=True)
cohere_client = cohere.Client(api_key=Config.COHERE_API_KEY)
print("✅ Cohere client ready", flush=True)

supabase = create_client(Config.SUPABASE_URL, Config.SUPABASE_ANON_KEY)

def get_embedding(text: str) -> list:
    """Get embedding from Cohere API"""
    try:
        text = text.replace("\n", " ").strip()[:2000]
        if not text:
            return None
        
        response = cohere_client.embed(
            texts=[text],
            model="embed-english-v3.0",
            input_type="search_document"
        )
        
        return response.embeddings[0]
    except Exception as e:
        print(f"❌ Cohere error: {e}", flush=True)
        return None

def process_pdf_in_chunks(file_path: str, user_id: str, filename: str) -> int:
    """Process PDF page by page to save memory"""
    
    print(f"📄 Processing: {filename}", flush=True)
    
    successful = 0
    chunk_index = 0
    
    try:
        # Read PDF page by page (not all at once)
        reader = PdfReader(file_path)
        total_pages = len(reader.pages)
        print(f"📄 Total pages: {total_pages}", flush=True)
        
        for page_num, page in enumerate(reader.pages):
            print(f"  Page {page_num + 1}/{total_pages}", flush=True)
            
            # Extract text from single page
            page_text = page.extract_text()
            if not page_text:
                continue
            
            # Split page into smaller chunks (300 chars for memory)
            page_chunks = []
            chunk_size = 500
            overlap = 50
            
            for i in range(0, len(page_text), chunk_size - overlap):
                chunk = page_text[i:i + chunk_size]
                if chunk.strip():
                    page_chunks.append(chunk.strip())
            
            # Process each chunk
            for chunk in page_chunks:
                print(f"    Chunk {chunk_index + 1}: {len(chunk)} chars", flush=True)
                
                embedding = get_embedding(chunk)
                if embedding:
                    try:
                        supabase.table("document_chunks").insert({
                            "user_id": user_id,
                            "filename": filename,
                            "chunk_text": chunk[:800],
                            "chunk_index": chunk_index,
                            "embedding": embedding
                        }).execute()
                        successful += 1
                        chunk_index += 1
                        print(f"      ✅ Stored", flush=True)
                    except Exception as e:
                        print(f"      ❌ DB error: {e}", flush=True)
                
                # Force garbage collection every 10 chunks
                if chunk_index % 10 == 0:
                    import gc
                    gc.collect()
            
            # Clear page from memory
            del page
            import gc
            gc.collect()
    
    except Exception as e:
        print(f"❌ PDF error: {e}", flush=True)
        return 0
    
    # Record in user_documents
    if successful > 0:
        try:
            supabase.table("user_documents").insert({
                "user_id": user_id,
                "filename": filename,
                "chunk_count": successful
            }).execute()
            print(f"✅ Stored {successful} chunks", flush=True)
        except Exception as e:
            print(f"❌ Record error: {e}", flush=True)
    
    return successful

# Alias for compatibility
process_and_store_pdf = process_pdf_in_chunks

def search_similar_chunks(question: str, user_id: str, top_k: int = 4) -> List[Dict[str, Any]]:
    """Search for similar chunks"""
    
    print(f"🔍 Searching...", flush=True)
    
    try:
        response = cohere_client.embed(
            texts=[question],
            model="embed-english-v3.0",
            input_type="search_query"
        )
        question_embedding = response.embeddings[0]
    except Exception as e:
        print(f"❌ Query error: {e}", flush=True)
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
        print(f"Error: {e}")
        return False
