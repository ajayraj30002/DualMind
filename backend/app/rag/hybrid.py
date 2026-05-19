from typing import List, Dict, Any
from groq import Groq
from .closed_domain import search_closed_domain
from .open_domain import search_open_domain
from ..config import Config

# Initialize Groq client
groq_client = Groq(api_key=Config.GROQ_API_KEY)

def combine_sources(closed_results: List[Dict], open_results: List[Dict], max_sources: int = 10) -> List[Dict]:
    """Combine and deduplicate results from both sources"""
    
    all_sources = []
    
    for r in closed_results:
        r['source_type'] = '📁 My Documents'
        all_sources.append(r)
    
    for r in open_results:
        r['source_type'] = '🌐 Web Search'
        all_sources.append(r)
    
    return all_sources[:max_sources]

def detect_document_type(content: str) -> str:
    """Detect what type of document is being analyzed"""
    content_lower = content.lower()
    
    if any(word in content_lower for word in ['dear hiring', 'cover letter', 'sincerely', 'i am writing']):
        return "resume_cover"
    elif any(word in content_lower for word in ['policy', 'procedure', 'guidelines', 'employees shall']):
        return "policy"
    elif any(word in content_lower for word in ['installation', 'manual', 'instructions', 'warranty']):
        return "manual"
    else:
        return "general"

def generate_answer(question: str, sources: List[Dict]) -> str:
    """Generate an intelligent, structured answer using Groq LLM"""
    
    # Detect document type for better response formatting
    if sources:
        doc_type = detect_document_type(sources[0]['content'])
    else:
        doc_type = "general"
    
    # Format context without source numbers
    context_parts = []
    for source in sources:
        context_parts.append(source['content'])
    
    context = "\n\n---\n\n".join(context_parts)
    
    # Document-type specific instructions
    type_instructions = {
        "resume_cover": """
Focus on extracting:
- SKILLS: List technical skills, tools, frameworks
- EXPERIENCE: Previous roles, companies, duration, key achievements
- EDUCATION: Degree, institution, GPA, relevant coursework
- PROJECTS: Names, technologies used, outcomes""",
        
        "policy": """
Focus on extracting:
- RULES: Specific requirements, restrictions, conditions
- DATES: Deadlines, effective dates, waiting periods
- AMOUNTS: Numbers, percentages, limits, thresholds
- PROCEDURES: Step-by-step processes, approval chains""",
        
        "manual": """
Focus on extracting:
- STEPS: Sequential instructions, numbered procedures
- WARNINGS: Safety information, cautions, important notes
- SPECIFICATIONS: Technical specs, measurements, requirements""",
        
        "general": """
Focus on extracting:
- FACTS: Specific information, data points, details
- KEY POINTS: Main ideas, important concepts"""
    }
    
    instructions = type_instructions.get(doc_type, type_instructions["general"])
    
    prompt = f"""You are DualMind, an expert document analyst. Answer questions accurately based ONLY on the provided information.

DOCUMENT CONTENT:
{context}

USER QUESTION: {question}

INSTRUCTIONS:
1. Answer ONLY using information from the document
2. Be specific - extract names, dates, numbers, technologies
3. Use bullet points for lists or multiple items
4. Do NOT mention "source", "document", or cite anything
5. Do NOT say "according to" or "the document states"
6. Just give a clean, natural answer

{document_type.upper()} DOCUMENT - EXTRA INSTRUCTIONS:
{instructions}

YOUR ANSWER:"""

    try:
        completion = groq_client.chat.completions.create(
            model=Config.LLM_MODEL,
            messages=[
                {"role": "system", "content": "You are an expert document analyst. Provide specific, factual answers without mentioning sources or documents. Use bullet points for clarity when appropriate."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.2,  # Lower temperature for more factual answers
            max_tokens=1500
        )
        
        return completion.choices[0].message.content
        
    except Exception as e:
        return f"Error generating response: {str(e)}"

async def hybrid_search(question: str, user_id: str, search_type: str = "hybrid") -> Dict[str, Any]:
    """Perform hybrid search based on specified type"""
    
    closed_results = []
    open_results = []
    
    # Get closed-domain results (user's documents)
    if search_type in ["closed", "hybrid"]:
        closed_results = search_closed_domain(question, user_id, top_k=8)  # Get more for better context
    
    # Get open-domain results (web search)
    if search_type in ["open", "hybrid"]:
        open_results = search_open_domain(question, top_k=5)
    
    # Combine sources
    all_sources = combine_sources(closed_results, open_results)
    
    # Generate answer
    answer = generate_answer(question, all_sources)
    
    # Prepare sources for response
    response_sources = []
    for source in all_sources[:5]:
        response_sources.append({
            "type": source.get('source_type', 'Source'),
            "content": source.get('content', '')[:300],
            "filename": source.get('filename', ''),
            "url": source.get('url', '')
        })
    
    return {
        "answer": answer,
        "sources": response_sources,
        "search_type_used": search_type,
        "closed_source_count": len(closed_results),
        "open_source_count": len(open_results)
    }
