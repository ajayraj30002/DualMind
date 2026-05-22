import os
from dotenv import load_dotenv

load_dotenv()

class Config:
    # API Keys
    GROQ_API_KEY = os.getenv("GROQ_API_KEY")
    TAVILY_API_KEY = os.getenv("TAVILY_API_KEY")
    COHERE_API_KEY = os.getenv("COHERE_API_KEY")
    
    # Supabase
    SUPABASE_URL = os.getenv("SUPABASE_URL")
    SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY")
    SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET")
    
    # JWT Settings
    JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY")
    JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
    JWT_EXPIRY_MINUTES = int(os.getenv("JWT_EXPIRY_MINUTES", "60"))
    
    # File paths
    UPLOAD_DIR = "uploads"
    
    # Model settings
    EMBEDDING_MODEL = "embed-english-v3.0"  # Cohere V1 embedding model
    LLM_MODEL = "llama-3.3-70b-versatile"
    
    # CORS
    ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS").split(",")
