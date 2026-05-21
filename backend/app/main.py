from fastapi import FastAPI, UploadFile, File, HTTPException, Depends, status
from fastapi.middleware.cors import CORSMiddleware
from .rag.hybrid import hybrid_search
import os
import shutil
from .vector_store import process_and_store_pdf
from supabase import create_client, Client
import bcrypt
from .config import Config
from .models.schemas import (
    SignUpRequest, SignUpResponse, 
    SignInRequest, SignInResponse,
    QueryRequest, QueryResponse, 
    UploadResponse
)
from .auth import create_access_token, get_current_user, supabase

app = FastAPI(title="DualMind API", version="1.0.0")

# Configure CORS properly
app.add_middleware(
    CORSMiddleware,
    allow_origins=Config.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["*"],
)

# Ensure upload directory exists
os.makedirs(Config.UPLOAD_DIR, exist_ok=True)

# ========== HEALTH CHECK ==========
@app.get("/")
def root():
    return {"message": "DualMind API is running", "status": "healthy"}

@app.get("/health")
def health_check():
    return {"status": "ok"}

# ========== AUTH ENDPOINTS ==========
@app.post("/auth/signup", response_model=SignUpResponse)
async def signup(request: SignUpRequest):
    """User signup with email and password"""
    
    existing = supabase.table("users").select("*").eq("email", request.email).execute()
    if existing.data:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    hashed_password = bcrypt.hashpw(request.password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
    
    try:
        response = supabase.table("users").insert({
            "email": request.email,
            "hashed_password": hashed_password,
            "full_name": request.full_name,
            "created_at": "now()"
        }).execute()
        
        user = response.data[0]
        
        return SignUpResponse(
            message="User created successfully",
            user_id=user["id"],
            email=user["email"]
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Signup failed: {str(e)}")

@app.post("/auth/signin", response_model=SignInResponse)
async def signin(request: SignInRequest):
    """User signin with email and password"""
    
    response = supabase.table("users").select("*").eq("email", request.email).execute()
    
    if not response.data:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    
    user = response.data[0]
    
    if not bcrypt.checkpw(request.password.encode('utf-8'), user["hashed_password"].encode('utf-8')):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    
    access_token = create_access_token(
        data={"sub": user["id"], "email": user["email"]}
    )
    
    return SignInResponse(
        message="Login successful",
        access_token=access_token,
        user_id=user["id"],
        email=user["email"]
    )

@app.get("/auth/me")
async def get_me(current_user: dict = Depends(get_current_user)):
    """Get current user info"""
    return {
        "user_id": current_user["user_id"],
        "email": current_user["email"]
    }

# ========== CHAT SESSION ENDPOINTS ==========

@app.get("/chat/sessions")
async def get_sessions(current_user: dict = Depends(get_current_user)):
    """Get all chat sessions for current user"""
    try:
        response = supabase.table("chat_sessions")\
            .select("*")\
            .eq("user_id", current_user["user_id"])\
            .order("updated_at", desc=True)\
            .execute()
        return {"sessions": response.data}
    except Exception as e:
        raise HTTPException(500, f"Failed to get sessions: {str(e)}")

@app.post("/chat/sessions")
async def create_session(current_user: dict = Depends(get_current_user)):
    """Create a new chat session"""
    try:
        response = supabase.table("chat_sessions").insert({
            "user_id": current_user["user_id"],
            "title": "New Chat",
            "created_at": "now()",
            "updated_at": "now()"
        }).execute()
        return {"session": response.data[0]}
    except Exception as e:
        raise HTTPException(500, f"Failed to create session: {str(e)}")

@app.put("/chat/sessions/{session_id}")
async def rename_session(session_id: str, title: str, current_user: dict = Depends(get_current_user)):
    """Rename a chat session"""
    try:
        supabase.table("chat_sessions")\
            .update({"title": title, "updated_at": "now()"})\
            .eq("id", session_id)\
            .eq("user_id", current_user["user_id"])\
            .execute()
        return {"message": "Session renamed"}
    except Exception as e:
        raise HTTPException(500, f"Failed to rename session: {str(e)}")

@app.delete("/chat/sessions/{session_id}")
async def delete_session(session_id: str, current_user: dict = Depends(get_current_user)):
    """Delete a chat session and its messages"""
    try:
        supabase.table("chat_messages").delete().eq("session_id", session_id).execute()
        supabase.table("chat_sessions").delete().eq("id", session_id).eq("user_id", current_user["user_id"]).execute()
        return {"message": "Session deleted"}
    except Exception as e:
        raise HTTPException(500, f"Failed to delete session: {str(e)}")

@app.get("/chat/sessions/{session_id}/messages")
async def get_messages(session_id: str, current_user: dict = Depends(get_current_user)):
    """Get all messages for a session"""
    try:
        session = supabase.table("chat_sessions")\
            .select("*")\
            .eq("id", session_id)\
            .eq("user_id", current_user["user_id"])\
            .execute()
        if not session.data:
            raise HTTPException(404, "Session not found")
        
        response = supabase.table("chat_messages")\
            .select("*")\
            .eq("session_id", session_id)\
            .order("created_at", asc=True)\
            .execute()
        return {"messages": response.data}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Failed to get messages: {str(e)}")

@app.post("/chat/sessions/{session_id}/messages")
async def send_message(
    session_id: str,
    request: QueryRequest,
    current_user: dict = Depends(get_current_user)
):
    """Send a message and get AI response with conversation context"""
    
    session = supabase.table("chat_sessions")\
        .select("*")\
        .eq("id", session_id)\
        .eq("user_id", current_user["user_id"])\
        .execute()
    if not session.data:
        raise HTTPException(404, "Session not found")
    
    # Save user message
    supabase.table("chat_messages").insert({
        "session_id": session_id,
        "role": "user",
        "content": request.question
    }).execute()
    
    # Get previous messages for context
    previous = supabase.table("chat_messages")\
        .select("*")\
        .eq("session_id", session_id)\
        .order("created_at", desc=True)\
        .limit(10)\
        .execute()
    
    # Build conversation context
    conversation = []
    for msg in reversed(previous.data):
        conversation.append(f"{msg['role'].upper()}: {msg['content']}")
    conversation_context = "\n".join(conversation)
    
    # Hybrid search with conversation context
    result = await hybrid_search(
        question=request.question,
        user_id=current_user["user_id"],
        search_type=request.search_type,
        conversation_context=conversation_context
    )
    
    # Save assistant message
    supabase.table("chat_messages").insert({
        "session_id": session_id,
        "role": "assistant",
        "content": result["answer"],
        "sources": result.get("sources")
    }).execute()
    
    # Update session updated_at
    supabase.table("chat_sessions")\
        .update({"updated_at": "now()"})\
        .eq("id", session_id)\
        .execute()
    
    return QueryResponse(
        answer=result["answer"],
        sources=result.get("sources"),
        search_type_used=result["search_type_used"]
    )

@app.post("/chat/sessions/{session_id}/attach")
async def attach_document(
    session_id: str,
    filename: str,
    current_user: dict = Depends(get_current_user)
):
    """Attach an existing document to a chat session"""
    try:
        doc = supabase.table("user_documents")\
            .select("id")\
            .eq("user_id", current_user["user_id"])\
            .eq("filename", filename)\
            .execute()
        if not doc.data:
            raise HTTPException(404, "Document not found")
        
        supabase.table("session_documents").insert({
            "session_id": session_id,
            "document_id": doc.data[0]["id"]
        }).execute()
        
        return {"message": f"Document {filename} attached"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Failed to attach document: {str(e)}")

# ========== DOCUMENT ENDPOINTS ==========

@app.post("/upload")
async def upload_pdf(
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user)
):
    if not file.filename.endswith('.pdf'):
        raise HTTPException(400, "Only PDF files are supported")
    
    user_folder = os.path.join(Config.UPLOAD_DIR, current_user["user_id"])
    os.makedirs(user_folder, exist_ok=True)
    
    file_path = os.path.join(user_folder, file.filename)
    
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    
    chunk_count = process_and_store_pdf(file_path, current_user["user_id"], file.filename)
    
    return UploadResponse(
        message="File uploaded and processed successfully",
        filename=file.filename,
        chunk_count=chunk_count
    )

@app.post("/query", response_model=QueryResponse)
async def query(
    request: QueryRequest,
    current_user: dict = Depends(get_current_user)
):
    """Ask a question using hybrid RAG"""
    
    result = await hybrid_search(
        question=request.question,
        user_id=current_user["user_id"],
        search_type=request.search_type
    )
    
    return QueryResponse(
        answer=result["answer"],
        sources=result["sources"],
        search_type_used=result["search_type_used"]
    )

@app.get("/documents")
async def list_documents(current_user: dict = Depends(get_current_user)):
    """List all uploaded documents for the current user"""
    try:
        response = supabase.table("user_documents").select("*").eq("user_id", current_user["user_id"]).execute()
        return {"documents": response.data}
    except Exception as e:
        return {"documents": [], "error": str(e)}

@app.delete("/documents/{filename}")
async def delete_document(filename: str, current_user: dict = Depends(get_current_user)):
    """Delete a specific document"""
    try:
        supabase.table("user_documents").delete().eq("user_id", current_user["user_id"]).eq("filename", filename).execute()
        return {"message": f"Document {filename} deleted"}
    except Exception as e:
        raise HTTPException(500, f"Failed to delete: {str(e)}")
