import os
import time
import json
import logging
import urllib.request
import urllib.error
from typing import List, Dict, Any, Optional
from ..config import Config

logger = logging.getLogger(__name__)

# Known friendly metadata mapping for popular Groq models
KNOWN_MODELS_META = {
    "llama-3.3-70b-versatile": {
        "name": "Llama 3.3 70B",
        "description": "Balanced reasoning · Current default",
        "badge": "Default",
        "priority": 10
    },
    "llama-3.1-8b-instant": {
        "name": "Llama 3.1 8B",
        "description": "Faster responses · 128k context",
        "badge": "Fast",
        "priority": 9
    },
    "deepseek-r1-distill-llama-70b": {
        "name": "DeepSeek R1 70B",
        "description": "Advanced reasoning & logic · 128k context",
        "badge": "Reasoning",
        "priority": 8
    },
    "gemma2-9b-it": {
        "name": "Gemma 2 9B",
        "description": "Google open model · High speed",
        "badge": "Efficient",
        "priority": 7
    },
    "mixtral-8x7b-32768": {
        "name": "Mixtral 8x7B",
        "description": "MoE architecture · 32k context",
        "badge": "Versatile",
        "priority": 6
    },
    "llama3-70b-8192": {
        "name": "Llama 3 70B",
        "description": "Legacy 70B model · 8k context",
        "badge": "Legacy",
        "priority": 5
    },
    "llama3-8b-8192": {
        "name": "Llama 3 8B",
        "description": "Legacy 8B model · 8k context",
        "badge": "Legacy",
        "priority": 4
    }
}

# Non-chat models to exclude from chat completions
EXCLUDED_PATTERNS = [
    "whisper",
    "audio",
    "tts",
    "embed",
    "guard",
    "moderation",
    "vision"
]

FALLBACK_MODELS = [
    {
        "id": "llama-3.3-70b-versatile",
        "name": "Llama 3.3 70B",
        "description": "Balanced reasoning · Current default",
        "badge": "Default",
        "context_window": 131072,
        "is_default": True
    },
    {
        "id": "llama-3.1-8b-instant",
        "name": "Llama 3.1 8B",
        "description": "Faster responses · 128k context",
        "badge": "Fast",
        "context_window": 131072,
        "is_default": False
    },
    {
        "id": "deepseek-r1-distill-llama-70b",
        "name": "DeepSeek R1 70B",
        "description": "Advanced reasoning & logic · 128k context",
        "badge": "Reasoning",
        "context_window": 131072,
        "is_default": False
    },
    {
        "id": "gemma2-9b-it",
        "name": "Gemma 2 9B",
        "description": "Google open model · High speed",
        "badge": "Efficient",
        "context_window": 8192,
        "is_default": False
    }
]

class ModelService:
    def __init__(self, ttl_seconds: int = 300):
        self.ttl_seconds = ttl_seconds
        self._cached_models: List[Dict[str, Any]] = []
        self._last_fetched: float = 0
        self._default_model = Config.LLM_MODEL or "llama-3.3-70b-versatile"

    def _is_chat_model(self, model_id: str) -> bool:
        low = model_id.lower()
        for p in EXCLUDED_PATTERNS:
            if p in low:
                return False
        return True

    def _format_model_meta(self, model_obj: Dict[str, Any]) -> Dict[str, Any]:
        m_id = model_obj.get("id", "")
        ctx = model_obj.get("context_window")
        
        known = KNOWN_MODELS_META.get(m_id)
        if known:
            name = known["name"]
            desc = known["description"]
            badge = known.get("badge")
            priority = known.get("priority", 0)
        else:
            # Dynamic friendly name from model ID
            parts = m_id.replace("_", "-").split("-")
            name = " ".join([p.capitalize() if not p.isdigit() else p for p in parts if p not in ["preview", "it", "versatile", "instant"]])
            ctx_str = f"{ctx // 1024}k context" if ctx else "Active chat model"
            desc = f"{ctx_str} · Groq cloud"
            badge = "Active"
            priority = 1

        is_default = (m_id == self._default_model)
        if is_default:
            badge = "Default"
            priority = 100

        return {
            "id": m_id,
            "name": name,
            "description": desc,
            "badge": badge,
            "context_window": ctx,
            "is_default": is_default,
            "priority": priority
        }

    def fetch_models_from_groq(self) -> List[Dict[str, Any]]:
        api_key = Config.GROQ_API_KEY
        if not api_key:
            logger.warning("GROQ_API_KEY is not set. Returning fallback models.")
            return FALLBACK_MODELS

        raw_models = []
        # Attempt 1: Try using groq Python SDK if available
        try:
            from groq import Groq
            client = Groq(api_key=api_key)
            resp = client.models.list()
            for m in resp.data:
                raw_models.append({
                    "id": m.id,
                    "active": getattr(m, "active", True),
                    "context_window": getattr(m, "context_window", None)
                })
        except Exception as sdk_err:
            logger.info(f"Groq SDK models.list failed ({sdk_err}); trying REST API directly.")
            # Attempt 2: Direct REST request via urllib
            try:
                req = urllib.request.Request(
                    "https://api.groq.com/openai/v1/models",
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "User-Agent": "DualMind/1.0"
                    }
                )
                with urllib.request.urlopen(req, timeout=8) as res:
                    if res.status == 200:
                        body = json.loads(res.read().decode("utf-8"))
                        raw_models = body.get("data", [])
            except Exception as rest_err:
                logger.error(f"Failed to fetch models from Groq REST API: {rest_err}")
                return FALLBACK_MODELS

        if not raw_models:
            return FALLBACK_MODELS

        formatted = []
        for m in raw_models:
            m_id = m.get("id")
            if not m_id:
                continue
            if not m.get("active", True):
                continue
            if not self._is_chat_model(m_id):
                continue
            formatted.append(self._format_model_meta(m))

        # Sort by priority descending
        formatted.sort(key=lambda x: x["priority"], reverse=True)
        return formatted or FALLBACK_MODELS

    def get_models(self, force_refresh: bool = False) -> Dict[str, Any]:
        now = time.time()
        if force_refresh or not self._cached_models or (now - self._last_fetched > self.ttl_seconds):
            try:
                models = self.fetch_models_from_groq()
                self._cached_models = models
                self._last_fetched = now
            except Exception as e:
                logger.error(f"Error refreshing models: {e}")
                if not self._cached_models:
                    self._cached_models = FALLBACK_MODELS

        # Always include "Auto" as the first choice
        model_list = [
            {
                "id": "auto",
                "name": "Auto",
                "description": "Let DualMind choose the best model",
                "badge": "Smart",
                "is_default": False
            }
        ] + self._cached_models

        return {
            "default": self._default_model,
            "models": model_list,
            "cached_at": self._last_fetched
        }

    def resolve_model(self, requested_model: Optional[str]) -> str:
        """Resolve a user-provided model ID or 'auto' to a valid Groq model string."""
        if not requested_model or requested_model.lower() == "auto":
            return self._default_model
        
        # Check against cached or fallback models
        models = self.get_models()["models"]
        for m in models:
            if m["id"].lower() == requested_model.lower() or m["name"].lower() == requested_model.lower():
                return m["id"]
        
        return self._default_model

model_service = ModelService()
