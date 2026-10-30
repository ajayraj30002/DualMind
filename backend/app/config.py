import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()
_backend_env = Path(__file__).resolve().parent.parent / ".env"
if _backend_env.exists():
    load_dotenv(_backend_env)

def _clean_env(val: os.PathLike | str | None) -> str | None:
    if not val:
        return None
    cleaned = str(val).strip().strip('"').strip("'")
    return cleaned if cleaned else None

class Config:
    # ─── Raw Environment Keys ───
    _raw_groq = _clean_env(os.getenv("GROQ_API_KEY"))
    _raw_gemini = _clean_env(os.getenv("GEMINI_API_KEY"))

    # If user provided GEMINI_API_KEY, use it.
    # If user pasted a Google key (starts with 'AIza') into GROQ_API_KEY in Render, auto-detect as Gemini.
    if _raw_gemini:
        GEMINI_API_KEY = _raw_gemini
    elif _raw_groq and _raw_groq.startswith("AIza"):
        GEMINI_API_KEY = _raw_groq
    else:
        GEMINI_API_KEY = None

    # Groq API key: only set if it's not a Gemini key
    if _raw_groq and not _raw_groq.startswith("AIza"):
        GROQ_API_KEY = _raw_groq
    else:
        GROQ_API_KEY = None

    # Active LLM Provider
    LLM_PROVIDER = "gemini" if GEMINI_API_KEY else ("groq" if GROQ_API_KEY else "gemini")

    # API Keys
    TAVILY_API_KEY = _clean_env(os.getenv("TAVILY_API_KEY"))
    COHERE_API_KEY = _clean_env(os.getenv("COHERE_API_KEY"))
    
    # Supabase
    SUPABASE_URL = _clean_env(os.getenv("SUPABASE_URL"))
    SUPABASE_ANON_KEY = _clean_env(os.getenv("SUPABASE_ANON_KEY"))
    SUPABASE_JWT_SECRET = _clean_env(os.getenv("SUPABASE_JWT_SECRET"))
    
    # JWT Settings
    JWT_SECRET_KEY = _clean_env(os.getenv("JWT_SECRET_KEY"))
    JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
    JWT_EXPIRY_MINUTES = int(os.getenv("JWT_EXPIRY_MINUTES", "60"))
    
    # File paths
    UPLOAD_DIR = "uploads"
    
    # Model settings
    EMBEDDING_MODEL = "embed-english-v3.0"

    # Default LLM model: gemini-2.0-flash if Gemini, or llama-3.3-70b-versatile if Groq
    if LLM_PROVIDER == "gemini":
        LLM_MODEL = os.getenv("LLM_MODEL", "gemini-2.0-flash")
    else:
        LLM_MODEL = os.getenv("LLM_MODEL", "llama-3.3-70b-versatile")
    
    # CORS
    ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:8000").split(",")
    
    # SMTP Configuration (for email verification)
    SMTP_EMAIL = _clean_env(os.getenv("SMTP_EMAIL"))
    SMTP_APP_PASSWORD = _clean_env(os.getenv("SMTP_APP_PASSWORD"))
    SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
    SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))

