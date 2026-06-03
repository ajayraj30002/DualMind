"""
Smart response formatting that balances user-friendly conversation with research accuracy.
Handles source attribution intelligently based on query intent and result quality.
Optimized for minimal memory footprint - uses only regex and string operations.
"""

import re
from typing import List, Dict, Any, Tuple


# Precompiled regex patterns (compiled once at module load)
CASUAL_PATTERNS = [
    re.compile(r'^(hey|hi|hello|how are you|what\'?s up|yo|sup|greetings|hiya)', re.IGNORECASE),
    re.compile(r'^(thanks|thank you|great|cool|awesome|nice|good job)', re.IGNORECASE),
    re.compile(r'^(tell me|what do you think|can you|help me|explain|describe)', re.IGNORECASE),
]

DOC_KEYWORDS = {'document', 'pdf', 'file', 'page', 'section', 'chapter', 'uploaded', 'research', 'find', 'search for'}

VERBOSE_PATTERNS = [
    (r"I couldn't find any information about .* in your uploaded PDF documents\.?\s*", ""),
    (r"Please make sure your PDF contains the relevant information or try uploading a different document\.?\s*", ""),
    (r"I couldn't find this information in your uploaded PDF document\.?\s*", ""),
    (r"I have no information from any PDF documents\.?\s*", ""),
    (r"The documents appear to contain .* but none of them mention .*\.?\s*", ""),
    (r"I couldn't find any relevant information related to .* in your uploaded PDF documents\.\s*", ""),
]


def is_conversational_query(question: str) -> bool:
    """
    Detect if a query is conversational/casual vs. research/informational.
    Optimized with precompiled regexes for speed.
    
    Conversational indicators:
    - Greetings: hey, hi, hello, how are you, what's up
    - Casual acknowledgments: thanks, cool, nice
    - Very short queries (< 10 words)
    - No technical/research jargon or specific document references
    """
    question_lower = question.lower().strip()
    
    # Check for casual patterns using precompiled regexes
    for pattern in CASUAL_PATTERNS:
        if pattern.search(question_lower):
            # If it's just a greeting or acknowledgment
            word_count = len(question.split())
            if word_count < 5:
                return True
            # Even longer greetings with follow-ups are still conversational
            if pattern.pattern.startswith('^(hey|hi|hello|thanks|thank you)'):
                return True
    
    # Very short questions tend to be casual
    if len(question.split()) < 3:
        return True
    
    # Check if it has document-specific keywords (research indicator)
    has_doc_keyword = any(keyword in question_lower for keyword in DOC_KEYWORDS)
    
    # If no doc keywords and casual length, it's conversational
    return not has_doc_keyword


def sanitize_no_results_answer(answer: str, sources: List[Dict]) -> str:
    """
    Remove verbose source naming from no-results answers.
    Optimized with precompiled regex patterns.
    
    Transforms verbose "I couldn't find..." into friendly alternatives.
    Only applies if no sources were actually found.
    """
    
    # If there are sources, don't modify the answer
    if sources:
        return answer
    
    # Apply precompiled replacements
    result = answer
    for pattern, replacement in VERBOSE_PATTERNS:
        result = re.sub(pattern, replacement, result, flags=re.IGNORECASE)
    
    # Clean up extra whitespace
    result = re.sub(r'\s+', ' ', result).strip()
    
    # If result is empty after cleanup, provide a friendly fallback
    if not result:
        result = "I don't have that information available."
    
    return result


def should_show_sources(
    is_conversational: bool,
    has_pdf_results: bool,
    has_web_results: bool,
    search_type_used: str
) -> bool:
    """
    Determine if sources should be shown to the user.
    Fast boolean logic - no allocations.
    
    Rules:
    - Conversational queries with good results: hide sources
    - Conversational queries with no results: show what was searched (helps context)
    - Research queries: always show sources
    - Web fallback: show sources to indicate web was used
    """
    
    if is_conversational:
        # Only show sources if we have NO results (help user understand search attempt)
        return not (has_pdf_results or has_web_results)
    
    # For research queries, always show sources
    return True


def build_response_sources(
    all_sources: List[Dict[str, Any]],
    max_sources: int = 3,
    is_conversational: bool = False,
    search_type_used: str = ""
) -> List[Dict[str, Any]]:
    """
    Build clean source attribution for display.
    Minimal memory overhead - only formats what's needed.
    """
    
    # For conversational queries with results, don't include sources
    if is_conversational and search_type_used != "No results":
        return []
    
    if not all_sources:
        return []
    
    response_sources = []
    
    for source in all_sources[:max_sources]:
        source_type = source.get("source_type", "Unknown")
        
        # Get clean display name
        if source_type == "PDF Document":
            title = source.get("filename", "PDF Document")
            if len(title) > 40:
                title = title[:37] + "..."
        else:
            title = source.get("title", "Web Result")
            if len(title) > 60:
                title = title[:57] + "..."
        
        source_entry = {
            "type": source_type,
            "title": title,
            "content": source.get("content", "")[:200],
        }
        
        # Only include URL for web sources
        if source_type != "PDF Document":
            url = source.get("url", "")
            if url:
                source_entry["url"] = url
        
        response_sources.append(source_entry)
    
    return response_sources


def get_friendly_no_results_messages() -> Dict[str, str]:
    """
    Return friendly alternatives to verbose no-results messages.
    Dictionary lookup is O(1) - more efficient than generating strings.
    """
    return {
        "default": "I don't have that information available.",
        "conversational": "Hmm, I couldn't find that in your documents.",
        "research": "No matching information found in your documents or web search.",
        "pdf_only": "That's not in your uploaded documents.",
        "web_only": "I couldn't find that online.",
    }


def format_response_for_query(
    answer: str,
    sources: List[Dict[str, Any]],
    search_type_used: str,
    closed_source_count: int,
    open_source_count: int,
    question: str
) -> Tuple[str, List[Dict[str, Any]]]:
    """
    Main function to intelligently format the complete response.
    Single entry point - handles all formatting logic.
    
    Returns:
        - Cleaned/formatted answer
        - Filtered sources (empty list if shouldn't show)
    """
    
    is_conv = is_conversational_query(question)
    
    # Clean up verbose no-results messages
    if "couldn't find" in answer.lower().strip()[:50]:  # Check first 50 chars
        if closed_source_count == 0 and open_source_count == 0:
            # Determine which type of friendly message to use
            if search_type_used == "No results":
                message_key = "conversational" if is_conv else "research"
                friendly_msg = get_friendly_no_results_messages()[message_key]
                answer = friendly_msg
            else:
                answer = sanitize_no_results_answer(answer, sources)
    
    # Determine if sources should be shown
    should_show = should_show_sources(
        is_conv,
        closed_source_count > 0,
        open_source_count > 0,
        search_type_used
    )
    
    # Build response sources only if needed
    response_sources = build_response_sources(
        sources,
        max_sources=3,
        is_conversational=is_conv,
        search_type_used=search_type_used
    ) if should_show else []
    
    return answer, response_sources
