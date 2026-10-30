import os
from pathlib import Path
from typing import Optional
from dotenv import load_dotenv

load_dotenv()
_backend_env = Path(__file__).resolve().parent.parent / ".env"
if _backend_env.exists():
    load_dotenv(_backend_env)

def _get_clean_env(key: str, default: Optional[str] = None) -> Optional[str]:
    val = os.getenv(key, default)
    if val is None:
        return None
    val = val.strip().strip('"').strip("'").strip()
    return val if val else None

class Config:
    # API Keys (sanitized of accidental quotes and whitespace from cloud dashboards)
    GROQ_API_KEY = _get_clean_env("GROQ_API_KEY")
    TAVILY_API_KEY = _get_clean_env("TAVILY_API_KEY")
    COHERE_API_KEY = _get_clean_env("COHERE_API_KEY")
    
    # Supabase
    SUPABASE_URL = _get_clean_env("SUPABASE_URL")
    SUPABASE_ANON_KEY = _get_clean_env("SUPABASE_ANON_KEY")
    SUPABASE_JWT_SECRET = _get_clean_env("SUPABASE_JWT_SECRET")
    
    # JWT Settings
    JWT_SECRET_KEY = _get_clean_env("JWT_SECRET_KEY", "fallback_jwt_secret_key_change_in_prod")
    JWT_ALGORITHM = _get_clean_env("JWT_ALGORITHM", "HS256")
    JWT_EXPIRY_MINUTES = int(_get_clean_env("JWT_EXPIRY_MINUTES", "60"))
    
    # File paths
    UPLOAD_DIR = "uploads"
    
    # Model settings
    EMBEDDING_MODEL = "embed-english-v3.0"
    LLM_MODEL = _get_clean_env("LLM_MODEL", "llama-3.3-70b-versatile")
    
    # CORS (allows local dev ports 8080, 3000, 5173 and configured production origins)
    _raw_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:8080,http://localhost:5173,http://127.0.0.1:8080,http://127.0.0.1:3000,*")
    ALLOWED_ORIGINS = [orig.strip() for orig in _raw_origins.split(",") if orig.strip()]
    
    # SMTP Configuration (for email verification)
    SMTP_EMAIL = _get_clean_env("SMTP_EMAIL")
    SMTP_APP_PASSWORD = _get_clean_env("SMTP_APP_PASSWORD")
    SMTP_HOST = _get_clean_env("SMTP_HOST", "smtp.gmail.com")
    SMTP_PORT = int(_get_clean_env("SMTP_PORT", "587"))
