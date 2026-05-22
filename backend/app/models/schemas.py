from pydantic import BaseModel, EmailStr
from typing import Optional, List
from datetime import datetime

# ========== AUTH SCHEMAS ==========
class SignUpRequest(BaseModel):
    email: EmailStr
    password: str
    full_name: Optional[str] = None

class SignUpResponse(BaseModel):
    message: str
    user_id: str
    email: str

class SignInRequest(BaseModel):
    email: EmailStr
    password: str

class SignInResponse(BaseModel):
    message: str
    access_token: str
    token_type: str = "bearer"
    user_id: str
    email: str

class TokenData(BaseModel):
    email: Optional[str] = None
    user_id: Optional[str] = None

# ========== RAG SCHEMAS ==========
class QueryRequest(BaseModel):
    question: str
    search_type: str = "hybrid"
    include_sources: bool = True
    uploaded_document: Optional[str] = None  # CRITICAL: For PDF priority

class QueryResponse(BaseModel):
    answer: str
    sources: Optional[List[dict]] = None
    search_type_used: str

class UploadResponse(BaseModel):
    message: str
    filename: str
    chunk_count: int

class UserDocumentResponse(BaseModel):
    id: str
    filename: str
    uploaded_at: datetime
    chunk_count: int
