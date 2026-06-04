import pytest

from app.rag import hybrid


@pytest.mark.asyncio
async def test_greeting_skips_retrieval_even_with_attached_document(monkeypatch):
    def fail_closed(*args, **kwargs):
        raise AssertionError("closed search should not run for a greeting")

    def fail_open(*args, **kwargs):
        raise AssertionError("open search should not run for a greeting")

    monkeypatch.setattr(hybrid, "search_closed_domain", fail_closed)
    monkeypatch.setattr(hybrid, "search_open_domain", fail_open)

    result = await hybrid.hybrid_search(
        "hi",
        user_id="user-1",
        search_type="hybrid",
        filename="KTU CGPA to Percentage Conversion Certificate.pdf",
    )

    assert result["answer"] == "Hi! How can I help you today?"
    assert result["search_type_used"] == "Conversation"


@pytest.mark.asyncio
async def test_live_query_uses_web_even_with_attached_document(monkeypatch):
    def fail_closed(*args, **kwargs):
        raise AssertionError("weather should not be trapped in PDF search")

    monkeypatch.setattr(hybrid, "search_closed_domain", fail_closed)
    monkeypatch.setattr(
        hybrid,
        "search_open_domain",
        lambda question, top_k=3: [
            {
                "content": "Chicago is 72 F with light wind.",
                "title": "Chicago weather",
                "url": "https://example.com/weather",
                "score": 0.9,
            }
        ],
    )
    monkeypatch.setattr(
        hybrid,
        "generate_answer",
        lambda question, sources, conversation_context=None: "Chicago is 72 F.",
    )

    result = await hybrid.hybrid_search(
        "whats the weather in chicago",
        user_id="user-1",
        search_type="hybrid",
        filename="KTU CGPA to Percentage Conversion Certificate.pdf",
    )

    assert result["answer"] == "Chicago is 72 F."
    assert result["search_type_used"] == "Web Search"
    assert result["open_source_count"] == 1


@pytest.mark.asyncio
async def test_hybrid_falls_back_to_web_when_pdf_has_no_relevant_results(monkeypatch):
    monkeypatch.setattr(hybrid, "search_closed_domain", lambda *args, **kwargs: [])
    monkeypatch.setattr(
        hybrid,
        "search_open_domain",
        lambda question, top_k=3: [
            {"content": "A web result", "title": "Result", "url": "https://example.com"}
        ],
    )
    monkeypatch.setattr(
        hybrid,
        "generate_answer",
        lambda question, sources, conversation_context=None: "From the web.",
    )

    result = await hybrid.hybrid_search("explain this topic", user_id="user-1", search_type="hybrid")

    assert result["answer"] == "From the web."
    assert result["closed_source_count"] == 0
    assert result["open_source_count"] == 1
