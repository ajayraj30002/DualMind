from typing import List, Dict, Any
from tavily import TavilyClient
from ..config import Config

# Initialize Tavily client
tavily_client = TavilyClient(api_key=Config.TAVILY_API_KEY)

def search_open_domain(question: str, top_k: int = 4) -> List[Dict[str, Any]]:
    """Search the web using Tavily API"""
    try:
        response = tavily_client.search(
            query=question,
            search_depth="basic",
            include_answer=False,
            include_raw_content=False,
            max_results=top_k
        )
        
        documents = []
        for result in response.get('results', []):
            documents.append({
                "content": result.get('content', ''),
                "url": result.get('url', ''),
                "title": result.get('title', ''),
                "score": result.get('score', 0),
                "type": "open_domain",
                "source_type": "🌐 Web Search"
            })
        
        return documents
        
    except Exception as e:
        print(f"Tavily search error: {e}")
        return []
