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

def _resolve_gemini_key() -> str | None:
    # 1. Check all standard, uppercase, and lowercase environment variable names
    candidates = [
        "GEMINI_API_KEY", "gemini_api_key",
        "GEMINI_KEY", "gemini_key",
        "GOOGLE_API_KEY", "google_api_key",
        "GOOGLE_GEMINI_API_KEY", "google_gemini_api_key",
    ]
    for name in candidates:
        val = _clean_env(os.getenv(name))
        if val:
            return val

    # 2. Check GROQ_API_KEY / groq_api_key:
    # If the user replaced GROQ_API_KEY with their Gemini key (anything that doesn't start with 'gsk_'):
    for name in ["GROQ_API_KEY", "groq_api_key"]:
        val = _clean_env(os.getenv(name))
        if val and not val.startswith("gsk_"):
            return val

    # 3. Dynamic search: any variable starting with AIza or containing 'gemini' in its name
    for k, v in os.environ.items():
        if isinstance(v, str):
            cleaned = _clean_env(v)
            if cleaned:
                if cleaned.startswith("AIza"):
                    return cleaned
                if "gemini" in k.lower() and not k.lower().startswith("npm_"):
                    return cleaned

    return None

def _resolve_groq_key() -> str | None:
    for name in ["GROQ_API_KEY", "groq_api_key"]:
        val = _clean_env(os.getenv(name))
        if val and val.startswith("gsk_"):
            return val
    return None

class Config:
    @classmethod
    def get_gemini_key(cls) -> str | None:
        return _resolve_gemini_key()

    @classmethod
    def get_groq_key(cls) -> str | None:
        return _resolve_groq_key()

    # Initial static resolution
    GEMINI_API_KEY = _resolve_gemini_key()
    GROQ_API_KEY = _resolve_groq_key()

    # Active LLM Provider
    LLM_PROVIDER = "gemini" if (GEMINI_API_KEY or not GROQ_API_KEY) else "groq"

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

