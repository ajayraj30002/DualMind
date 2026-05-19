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

# CORS for frontend (Vercel)
app.add_middleware(
    CORSMiddleware,
    allow_origins=Config.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Ensure upload directory exists
os.makedirs(Config.UPLOAD_DIR, exist_ok=True)

# Create users table in Supabase if not exists (run once in Supabase SQL editor)
# SQL command will be provided separately

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
    
    # Check if user exists
    existing = supabase.table("users").select("*").eq("email", request.email).execute()
    if existing.data:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    # Hash password
    hashed_password = bcrypt.hashpw(request.password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
    
    # Create user in Supabase
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
    
    # Find user
    response = supabase.table("users").select("*").eq("email", request.email).execute()
    
    if not response.data:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    
    user = response.data[0]
    
    # Verify password
    if not bcrypt.checkpw(request.password.encode('utf-8'), user["hashed_password"].encode('utf-8')):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    
    # Create JWT token
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
    """Get current user info (protected route)"""
    return {
        "user_id": current_user["user_id"],
        "email": current_user["email"]
    }

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
    
    # Process and store in Supabase pgvector
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
    """Ask a question using hybrid RAG (protected)"""
    
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
    """Delete a specific document (TODO: Also remove from ChromaDB)"""
    try:
        supabase.table("user_documents").delete().eq("user_id", current_user["user_id"]).eq("filename", filename).execute()
        return {"message": f"Document {filename} deleted"}
    except Exception as e:
        raise HTTPException(500, f"Failed to delete: {str(e)}")
# Test trigger - delete this line    