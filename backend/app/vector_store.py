import os
import sys
import re
import gc
from typing import List, Dict, Any
import pypdfium2 as pdfium
import cohere
from supabase import create_client
from .config import Config

# ============================================
# INITIALIZE COHERE CLIENT
# ============================================
print("🔄 Initializing Cohere API client...", flush=True)
cohere_client = cohere.Client(api_key=Config.COHERE_API_KEY)
print("✅ Cohere client ready", flush=True)

# Initialize Supabase client
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

def extract_text_with_pypdfium2(file_path: str) -> str:
    """
    Extract text using pypdfium2 - LOW MEMORY USAGE
    """
    text = ""
    pdf = None
    
    try:
        pdf = pdfium.PdfDocument(file_path)
        total_pages = len(pdf)
        print(f"📄 PDF has {total_pages} pages", flush=True)
        
        for page_num in range(total_pages):
            page = pdf[page_num]
            
            # Extract text as plain text
            text_page = page.get_textpage()
            text += text_page.get_text_range() + "\n\n"
            
            # Clean up page objects immediately
            del page
            del text_page
            
            if page_num % 5 == 0 and page_num > 0:
                gc.collect()
            
            if (page_num + 1) % 10 == 0:
                print(f"  Processed {page_num + 1}/{total_pages} pages", flush=True)
        
        return text
        
    except Exception as e:
        print(f"❌ pypdfium2 error: {e}", flush=True)
        return ""
        
    finally:
        if pdf:
            pdf.close()
        gc.collect()

def chunk_text(text: str, chunk_size: int = 600, overlap: int = 80) -> List[str]:
    """Memory-efficient text chunking"""
    chunks = []
    start = 0
    text_length = len(text)
    
    while start < text_length:
        end = min(start + chunk_size, text_length)
        chunk = text[start:end]
        
        if end < text_length:
            last_boundary = max(
                chunk.rfind('.'),
                chunk.rfind('?'),
                chunk.rfind('!'),
                chunk.rfind('\n')
            )
            if last_boundary > chunk_size // 2:
                end = start + last_boundary + 1
                chunk = text[start:end]
        
        if chunk.strip():
            chunks.append(chunk.strip())
        
        start = end - overlap
    
    return chunks

def process_and_store_pdf(file_path: str, user_id: str, filename: str) -> int:
    """Process PDF using pypdfium2"""
    
    print(f"📄 Processing PDF: {filename}", flush=True)
    
    text = extract_text_with_pypdfium2(file_path)
    
    if not text.strip():
        print("❌ No text extracted", flush=True)
        return 0
    
    print(f"📝 Total text: {len(text)} chars", flush=True)
    
    chunks = chunk_text(text)
    print(f"📦 Created {len(chunks)} chunks", flush=True)
    
    if not chunks:
        return 0
    
    successful = 0
    for i, chunk in enumerate(chunks):
        print(f"  Chunk {i+1}/{len(chunks)}: {len(chunk)} chars", flush=True)
        
        embedding = get_embedding(chunk)
        if embedding:
            try:
                supabase.table("document_chunks").insert({
                    "user_id": user_id,
                    "filename": filename,
                    "chunk_text": chunk[:800],
                    "chunk_index": i,
                    "embedding": embedding
                }).execute()
                successful += 1
                print(f"    ✅ Stored", flush=True)
            except Exception as e:
                print(f"    ❌ DB error: {e}", flush=True)
        
        del embedding
        gc.collect()
        
        if (i + 1) % 5 == 0:
            try:
                import psutil
                process = psutil.Process()
                mem_mb = process.memory_info().rss / 1024 / 1024
                print(f"  📊 Memory: {mem_mb:.0f} MB", flush=True)
            except:
                pass
    
    gc.collect()
    
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
