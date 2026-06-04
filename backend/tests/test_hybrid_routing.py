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
    monkeypatch.setattr(hybrid, "classify_query_intent", lambda **kwargs: "conversation")
    monkeypatch.setattr(
        hybrid,
        "generate_conversational_answer",
        lambda question, conversation_context=None: "Good to see you. What can we work on?",
    )

    result = await hybrid.hybrid_search(
        "hi",
        user_id="user-1",
        search_type="hybrid",
        filename="KTU CGPA to Percentage Conversion Certificate.pdf",
    )

    assert result["answer"] == "Good to see you. What can we work on?"
    assert result["search_type_used"] == "Conversation"


def test_joined_goodmorning_is_conversation():
    assert hybrid.is_conversational_query("goodmorning") is True


@pytest.mark.asyncio
async def test_tell_details_uses_pdf_retrieval(monkeypatch):
    closed_called = {"value": False}

    def fake_closed(question, user_id, top_k=5, filename=None):
        closed_called["value"] = True
        return [
            {
                "content": "PlacementNews.pdf says placements begin in July.",
                "filename": "PlacementNews.pdf",
                "similarity": 0.91,
            }
        ]

    monkeypatch.setattr(hybrid, "search_closed_domain", fake_closed)
    monkeypatch.setattr(hybrid, "search_open_domain", lambda *args, **kwargs: [])
    monkeypatch.setattr(hybrid, "classify_query_intent", lambda **kwargs: "document")
    monkeypatch.setattr(
        hybrid,
        "rewrite_query_for_retrieval",
        lambda question, conversation_context=None, filename=None, intent="hybrid": "summary details from PlacementNews.pdf",
    )
    monkeypatch.setattr(
        hybrid,
        "generate_answer",
        lambda question, sources, conversation_context=None: "Placements begin in July.",
    )

    result = await hybrid.hybrid_search(
        "tell details",
        user_id="user-1",
        search_type="hybrid",
        filename="PlacementNews.pdf",
    )

    assert closed_called["value"] is True
    assert result["answer"] == "Placements begin in July."
    assert result["closed_source_count"] == 1


@pytest.mark.asyncio
async def test_live_query_uses_web_even_with_attached_document(monkeypatch):
    def fail_closed(*args, **kwargs):
        raise AssertionError("weather should not be trapped in PDF search")

    monkeypatch.setattr(hybrid, "search_closed_domain", fail_closed)
    monkeypatch.setattr(hybrid, "classify_query_intent", lambda **kwargs: "web")
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
    monkeypatch.setattr(hybrid, "classify_query_intent", lambda **kwargs: "hybrid")
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
