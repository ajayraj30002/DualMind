from fastapi import FastAPI, UploadFile, File, HTTPException, Depends, status
from fastapi.middleware.cors import CORSMiddleware
import os
import shutil
import bcrypt
from typing import Optional, List, Dict, Any
from pydantic import BaseModel
from datetime import datetime, timedelta
import jwt
from supabase import create_client, Client
import uuid

# Initialize FastAPI
app = FastAPI(title="DualMind API", version="1.0.0")

# Configuration - Load from environment variables
class Config:
    # Supabase Configuration - Set these as environment variables
    SUPABASE_URL = os.getenv("SUPABASE_URL", "")
    SUPABASE_KEY = os.getenv("SUPABASE_KEY", "")
    SECRET_KEY = os.getenv("SECRET_KEY", "your-secret-key-change-this-in-production")
    ALGORITHM = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES = 30
    UPLOAD_DIR = os.getenv("UPLOAD_DIR", "uploads")
    ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "*").split(",")

# Validate configuration
if not Config.SUPABASE_URL or not Config.SUPABASE_KEY:
    print("WARNING: SUPABASE_URL or SUPABASE_KEY not set in environment variables!")
    print("Please set these before running the app.")
    # For development only - remove in production
    Config.SUPABASE_URL = "https://your-project.supabase.co"  # Replace with your URL
    Config.SUPABASE_KEY = "your-anon-key"  # Replace with your key

# Initialize Supabase
try:
    supabase: Client = create_client(Config.SUPABASE_URL, Config.SUPABASE_KEY)
    print(f"Successfully connected to Supabase at {Config.SUPABASE_URL}")
except Exception as e:
    print(f"Failed to connect to Supabase: {str(e)}")
    supabase = None

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for development
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Ensure upload directory exists
os.makedirs(Config.UPLOAD_DIR, exist_ok=True)

# ========== SCHEMAS ==========
class SignUpRequest(BaseModel):
    email: str
    password: str
    full_name: Optional[str] = None

class SignUpResponse(BaseModel):
    message: str
    user_id: str
    email: str

class SignInRequest(BaseModel):
    email: str
    password: str

class SignInResponse(BaseModel):
    message: str
    access_token: str
    user_id: str
    email: str

class QueryRequest(BaseModel):
    question: str
    search_type: str = "hybrid"
    include_sources: bool = False

class QueryResponse(BaseModel):
    answer: str
    sources: Optional[List[str]] = None
    search_type_used: str

class UploadResponse(BaseModel):
    message: str
    filename: str
    chunk_count: int

class RenameSessionRequest(BaseModel):
    title: str

# ========== AUTH FUNCTIONS ==========
def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=Config.ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, Config.SECRET_KEY, algorithm=Config.ALGORITHM)
    return encoded_jwt

async def get_current_user(authorization: Optional[str] = None):
    """Extract current user from JWT token"""
    # This is a simplified version - you'll need to extract from headers properly
    # For now, return a test user
    return {"user_id": "test-user", "email": "test@example.com"}

# ========== MOCK HYBRID SEARCH ==========
async def hybrid_search(question: str, user_id: str, search_type: str = "hybrid", conversation_context: str = ""):
    """Mock implementation - replace with your actual hybrid search"""
    return {
        "answer": f"This is a response to: {question}\n\nBased on the conversation context and your documents.",
        "sources": ["document1.pdf", "document2.pdf"],
        "search_type_used": search_type
    }

def process_and_store_pdf(file_path: str, user_id: str, filename: str):
    """Mock implementation - replace with your actual PDF processing"""
    print(f"Processing PDF: {file_path} for user {user_id}")
    return 10  # Return chunk count

# ========== HEALTH CHECK ==========
@app.get("/")
def root():
    return {"message": "DualMind API is running", "status": "healthy"}

@app.get("/health")
def health_check():
    if supabase is None:
        return {"status": "degraded", "error": "Supabase not connected"}
    return {"status": "ok", "supabase": "connected"}

# ========== AUTH ENDPOINTS ==========
@app.post("/auth/signup", response_model=SignUpResponse)
async def signup(request: SignUpRequest):
    """User signup with email and password"""
    if supabase is None:
        raise HTTPException(status_code=500, detail="Database not connected")
    
    try:
        # Check if user exists
        existing = supabase.table("users").select("*").eq("email", request.email).execute()
        if existing.data:
            raise HTTPException(status_code=400, detail="Email already registered")
        
        # Hash password
        hashed_password = bcrypt.hashpw(request.password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
        
        # Insert user
        response = supabase.table("users").insert({
            "email": request.email,
            "hashed_password": hashed_password,
            "full_name": request.full_name,
            "created_at": datetime.utcnow().isoformat()
        }).execute()
        
        user = response.data[0]
        
        return SignUpResponse(
            message="User created successfully",
            user_id=user["id"],
            email=user["email"]
        )
    except HTTPException:
        raise
    except Exception as e:
        print(f"Signup error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Signup failed: {str(e)}")

@app.post("/auth/signin", response_model=SignInResponse)
async def signin(request: SignInRequest):
    """User signin with email and password"""
    if supabase is None:
        raise HTTPException(status_code=500, detail="Database not connected")
    
    try:
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
    except HTTPException:
        raise
    except Exception as e:
        print(f"Signin error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Login failed: {str(e)}")

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
    if supabase is None:
        raise HTTPException(status_code=500, detail="Database not connected")
    
    try:
        print(f"Fetching sessions for user: {current_user['user_id']}")
        
        response = supabase.table("chat_sessions")\
            .select("*")\
            .eq("user_id", current_user["user_id"])\
            .order("updated_at", desc=True)\
            .execute()
        
        print(f"Found {len(response.data)} sessions")
        return {"sessions": response.data}
    except Exception as e:
        print(f"Error getting sessions: {str(e)}")
        raise HTTPException(500, detail=f"Failed to get sessions: {str(e)}")

@app.post("/chat/sessions")
async def create_session(current_user: dict = Depends(get_current_user)):
    """Create a new chat session"""
    if supabase is None:
        raise HTTPException(status_code=500, detail="Database not connected")
    
    try:
        print(f"Creating new session for user: {current_user['user_id']}")
        
        response = supabase.table("chat_sessions").insert({
            "user_id": current_user["user_id"],
            "title": "New Chat",
            "created_at": datetime.utcnow().isoformat(),
            "updated_at": datetime.utcnow().isoformat()
        }).execute()
        
        return {"session": response.data[0]}
    except Exception as e:
        print(f"Error creating session: {str(e)}")
        raise HTTPException(500, detail=f"Failed to create session: {str(e)}")

@app.put("/chat/sessions/{session_id}")
async def rename_session(
    session_id: str, 
    request: RenameSessionRequest,
    current_user: dict = Depends(get_current_user)
):
    """Rename a chat session"""
    if supabase is None:
        raise HTTPException(status_code=500, detail="Database not connected")
    
    try:
        print(f"Renaming session {session_id} to: {request.title}")
        
        supabase.table("chat_sessions")\
            .update({"title": request.title, "updated_at": datetime.utcnow().isoformat()})\
            .eq("id", session_id)\
            .eq("user_id", current_user["user_id"])\
            .execute()
        
        return {"message": "Session renamed"}
    except Exception as e:
        print(f"Error renaming session: {str(e)}")
        raise HTTPException(500, detail=f"Failed to rename session: {str(e)}")

@app.delete("/chat/sessions/{session_id}")
async def delete_session(session_id: str, current_user: dict = Depends(get_current_user)):
    """Delete a chat session and its messages"""
    if supabase is None:
        raise HTTPException(status_code=500, detail="Database not connected")
    
    try:
        print(f"Deleting session {session_id}")
        
        # Delete messages first
        supabase.table("chat_messages").delete().eq("session_id", session_id).execute()
        # Delete session
        supabase.table("chat_sessions").delete().eq("id", session_id).eq("user_id", current_user["user_id"]).execute()
        
        return {"message": "Session deleted"}
    except Exception as e:
        print(f"Error deleting session: {str(e)}")
        raise HTTPException(500, detail=f"Failed to delete session: {str(e)}")

@app.get("/chat/sessions/{session_id}/messages")
async def get_messages(session_id: str, current_user: dict = Depends(get_current_user)):
    """Get all messages for a session"""
    if supabase is None:
        raise HTTPException(status_code=500, detail="Database not connected")
    
    try:
        print(f"=== GET MESSAGES DEBUG ===")
        print(f"Session ID: {session_id}")
        print(f"User ID: {current_user['user_id']}")
        
        # First verify session belongs to user
        session = supabase.table("chat_sessions")\
            .select("*")\
            .eq("id", session_id)\
            .eq("user_id", current_user["user_id"])\
            .execute()
        
        print(f"Session query result: {session.data}")
        
        if not session.data:
            print(f"Session not found: {session_id}")
            raise HTTPException(404, detail="Session not found")
        
        # Get all messages for this session
        response = supabase.table("chat_messages")\
            .select("*")\
            .eq("session_id", session_id)\
            .order("created_at", asc=True)\
            .execute()
        
        print(f"Found {len(response.data)} messages")
        for msg in response.data:
            print(f"Message: {msg.get('role')} - {str(msg.get('content'))[:50]}...")
        
        # Format messages for response
        messages = []
        for msg in response.data:
            messages.append({
                "id": msg.get("id"),
                "role": msg.get("role"),
                "content": msg.get("content", ""),
                "sources": msg.get("sources"),
                "created_at": msg.get("created_at")
            })
        
        print(f"Returning {len(messages)} formatted messages")
        return {"messages": messages}
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error getting messages: {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(500, detail=f"Failed to get messages: {str(e)}")

@app.post("/chat/sessions/{session_id}/messages")
async def send_message(
    session_id: str,
    request: QueryRequest,
    current_user: dict = Depends(get_current_user)
):
    """Send a message and get AI response"""
    if supabase is None:
        raise HTTPException(status_code=500, detail="Database not connected")
    
    try:
        print(f"Sending message to session: {session_id}")
        
        # Verify session belongs to user
        session = supabase.table("chat_sessions")\
            .select("*")\
            .eq("id", session_id)\
            .eq("user_id", current_user["user_id"])\
            .execute()
        
        if not session.data:
            raise HTTPException(404, detail="Session not found")
        
        # Save user message
        user_msg = supabase.table("chat_messages").insert({
            "session_id": session_id,
            "role": "user",
            "content": request.question,
            "created_at": datetime.utcnow().isoformat()
        }).execute()
        
        print(f"Saved user message")
        
        # Get previous messages for context
        previous = supabase.table("chat_messages")\
            .select("*")\
            .eq("session_id", session_id)\
            .order("created_at", desc=True)\
            .limit(20)\
            .execute()
        
        # Build conversation context
        conversation = []
        for msg in reversed(previous.data):
            conversation.append(f"{msg['role'].upper()}: {msg['content']}")
        conversation_context = "\n".join(conversation)
        
        # Get response from hybrid search
        result = await hybrid_search(
            question=request.question,
            user_id=current_user["user_id"],
            search_type=request.search_type,
            conversation_context=conversation_context
        )
        
        # Save assistant message
        assistant_msg = supabase.table("chat_messages").insert({
            "session_id": session_id,
            "role": "assistant",
            "content": result["answer"],
            "sources": result.get("sources"),
            "created_at": datetime.utcnow().isoformat()
        }).execute()
        
        print(f"Saved assistant message")
        
        # Update session updated_at
        supabase.table("chat_sessions")\
            .update({"updated_at": datetime.utcnow().isoformat()})\
            .eq("id", session_id)\
            .execute()
        
        return QueryResponse(
            answer=result["answer"],
            sources=result.get("sources"),
            search_type_used=result["search_type_used"]
        )
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error sending message: {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(500, detail=f"Failed to send message: {str(e)}")

# ========== DOCUMENT ENDPOINTS ==========
@app.post("/upload")
async def upload_pdf(
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user)
):
    """Upload and process a PDF file"""
    try:
        if not file.filename.endswith('.pdf'):
            raise HTTPException(400, detail="Only PDF files are supported")
        
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
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error uploading file: {str(e)}")
        raise HTTPException(500, detail=f"Upload failed: {str(e)}")

@app.get("/documents")
async def list_documents(current_user: dict = Depends(get_current_user)):
    """List all uploaded documents for the current user"""
    if supabase is None:
        return {"documents": [], "error": "Database not connected"}
    
    try:
        response = supabase.table("user_documents").select("*").eq("user_id", current_user["user_id"]).execute()
        return {"documents": response.data}
    except Exception as e:
        print(f"Error listing documents: {str(e)}")
        return {"documents": [], "error": str(e)}

@app.delete("/documents/{filename}")
async def delete_document(filename: str, current_user: dict = Depends(get_current_user)):
    """Delete a specific document"""
    if supabase is None:
        raise HTTPException(500, detail="Database not connected")
    
    try:
        supabase.table("user_documents").delete().eq("user_id", current_user["user_id"]).eq("filename", filename).execute()
        return {"message": f"Document {filename} deleted"}
    except Exception as e:
        print(f"Error deleting document: {str(e)}")
        raise HTTPException(500, detail=f"Failed to delete: {str(e)}")

# ========== DEBUG ENDPOINT ==========
@app.get("/debug/check-messages/{session_id}")
async def check_messages(session_id: str, current_user: dict = Depends(get_current_user)):
    """Debug endpoint to check messages directly"""
    if supabase is None:
        return {"error": "Database not connected"}
    
    try:
        response = supabase.table("chat_messages")\
            .select("*")\
            .eq("session_id", session_id)\
            .execute()
        
        return {
            "session_id": session_id,
            "message_count": len(response.data),
            "messages": response.data,
            "user_id": current_user["user_id"]
        }
    except Exception as e:
        return {"error": str(e)}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
