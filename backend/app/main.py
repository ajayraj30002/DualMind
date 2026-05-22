from fastapi import FastAPI, UploadFile, File, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from .rag.hybrid import hybrid_search
import os
import shutil
from .vector_store import process_and_store_pdf
from supabase import create_client
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

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=Config.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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
    existing = supabase.table("users").select("*").eq("email", request.email).execute()
    if existing.data:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    hashed_password = bcrypt.hashpw(request.password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
    
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

@app.post("/auth/signin", response_model=SignInResponse)
async def signin(request: SignInRequest):
    response = supabase.table("users").select("*").eq("email", request.email).execute()
    if not response.data:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    
    user = response.data[0]
    if not bcrypt.checkpw(request.password.encode('utf-8'), user["hashed_password"].encode('utf-8')):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    
    access_token = create_access_token(data={"sub": user["id"], "email": user["email"]})
    return SignInResponse(
        message="Login successful",
        access_token=access_token,
        user_id=user["id"],
        email=user["email"]
    )

@app.get("/auth/me")
async def get_me(current_user: dict = Depends(get_current_user)):
    return {"user_id": current_user["user_id"], "email": current_user["email"]}

# ========== CHAT SESSION ENDPOINTS ==========
@app.get("/chat/sessions")
async def get_sessions(current_user: dict = Depends(get_current_user)):
    response = supabase.table("chat_sessions")\
        .select("*")\
        .eq("user_id", current_user["user_id"])\
        .order("updated_at", desc=True)\
        .execute()
    return {"sessions": response.data}

@app.post("/chat/sessions")
async def create_session(current_user: dict = Depends(get_current_user)):
    response = supabase.table("chat_sessions").insert({
        "user_id": current_user["user_id"],
        "title": "New Chat",
        "created_at": "now()",
        "updated_at": "now()"
    }).execute()
    return {"session": response.data[0]}

@app.put("/chat/sessions/{session_id}")
async def rename_session(session_id: str, title: str, current_user: dict = Depends(get_current_user)):
    supabase.table("chat_sessions")\
        .update({"title": title, "updated_at": "now()"})\
        .eq("id", session_id)\
        .eq("user_id", current_user["user_id"])\
        .execute()
    return {"message": "Session renamed"}

@app.delete("/chat/sessions/{session_id}")
async def delete_session(session_id: str, current_user: dict = Depends(get_current_user)):
    supabase.table("chat_messages").delete().eq("session_id", session_id).execute()
    supabase.table("chat_sessions").delete().eq("id", session_id).eq("user_id", current_user["user_id"]).execute()
    return {"message": "Session deleted"}

@app.get("/chat/sessions/{session_id}/messages")
async def get_messages(session_id: str, current_user: dict = Depends(get_current_user)):
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
        .execute()
    
    messages = response.data if response.data else []
    messages.sort(key=lambda x: x.get('created_at', ''))
    return {"messages": messages}

# ========== CRITICAL: SEND MESSAGE ENDPOINT ==========
@app.post("/chat/sessions/{session_id}/messages")
async def send_message(
    session_id: str,
    request: QueryRequest,
    current_user: dict = Depends(get_current_user)
):
    # Verify session belongs to user
    session = supabase.table("chat_sessions")\
        .select("*")\
        .eq("id", session_id)\
        .eq("user_id", current_user["user_id"])\
        .execute()
    if not session.data:
        raise HTTPException(404, "Session not found")
    
    # Save user message
    user_message = {
        "session_id": session_id,
        "role": "user",
        "content": request.question
    }
    if request.uploaded_document:
        user_message["metadata"] = {"filename": request.uploaded_document}
    supabase.table("chat_messages").insert(user_message).execute()
    
    # Get previous messages for context
    previous = supabase.table("chat_messages")\
        .select("*")\
        .eq("session_id", session_id)\
        .execute()
    prev_list = previous.data if previous.data else []
    prev_list.sort(key=lambda x: x.get('created_at', ''))
    context_messages = prev_list[-10:] if len(prev_list) > 10 else prev_list
    
    # Build conversation context
    conversation = []
    for msg in context_messages:
        if msg['role'] == 'user':
            conversation.append(f"USER: {msg['content']}")
        else:
            conversation.append(f"ASSISTANT: {msg['content']}")
    conversation_context = "\n".join(conversation) if conversation else None
    
    # CRITICAL FIX: If a file was uploaded, ALWAYS use 'closed' mode
    # This forces the system to ONLY search the PDF
    effective_search_type = 'closed' if request.uploaded_document else request.search_type
    print(f"🔍 Search mode: {effective_search_type} (Document attached: {request.uploaded_document is not None})")
    
    # Perform hybrid search with forced closed mode if PDF attached
    result = await hybrid_search(
        question=request.question,
        user_id=current_user["user_id"],
        search_type=effective_search_type,
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

# ========== DOCUMENT ENDPOINTS ==========
@app.post("/upload")
async def upload_pdf(
    file: UploadFile = File(...),
    session_id: str = None,
    current_user: dict = Depends(get_current_user)
):
    if not file.filename.endswith('.pdf'):
        raise HTTPException(400, "Only PDF files are supported")
    
    user_folder = os.path.join(Config.UPLOAD_DIR, current_user["user_id"])
    os.makedirs(user_folder, exist_ok=True)
    
    file_path = os.path.join(user_folder, file.filename)
    
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    
    # Process and store in vector DB
    chunk_count = process_and_store_pdf(file_path, current_user["user_id"], file.filename)
    
    # Auto-attach to session if provided
    if session_id:
        doc_result = supabase.table("user_documents")\
            .select("id")\
            .eq("user_id", current_user["user_id"])\
            .eq("filename", file.filename)\
            .execute()
        
        if doc_result.data:
            existing = supabase.table("session_documents")\
                .select("*")\
                .eq("session_id", session_id)\
                .eq("document_id", doc_result.data[0]["id"])\
                .execute()
            
            if not existing.data:
                supabase.table("session_documents").insert({
                    "session_id": session_id,
                    "document_id": doc_result.data[0]["id"]
                }).execute()
    
    return UploadResponse(
        message="File uploaded and processed successfully",
        filename=file.filename,
        chunk_count=chunk_count
    )

@app.get("/chat/sessions/{session_id}/documents")
async def get_session_documents(session_id: str, current_user: dict = Depends(get_current_user)):
    session = supabase.table("chat_sessions")\
        .select("*")\
        .eq("id", session_id)\
        .eq("user_id", current_user["user_id"])\
        .execute()
    if not session.data:
        raise HTTPException(404, "Session not found")
    
    response = supabase.table("session_documents")\
        .select("document_id, user_documents(filename, id)")\
        .eq("session_id", session_id)\
        .execute()
    
    documents = []
    if response.data:
        for item in response.data:
            if item.get('user_documents'):
                documents.append({
                    "id": item['user_documents']['id'],
                    "filename": item['user_documents']['filename']
                })
    return {"documents": documents}

@app.get("/documents")
async def list_documents(current_user: dict = Depends(get_current_user)):
    response = supabase.table("user_documents").select("*").eq("user_id", current_user["user_id"]).execute()
    return {"documents": response.data}

@app.post("/query")
async def query(request: QueryRequest, current_user: dict = Depends(get_current_user)):
    result = await hybrid_search(
        question=request.question,
        user_id=current_user["user_id"],
        search_type=request.search_type
    )
    return QueryResponse(
        answer=result["answer"],
        sources=result.get("sources"),
        search_type_used=result["search_type_used"]
    )
