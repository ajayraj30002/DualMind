import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_root_endpoint():
    """Test that root endpoint returns healthy status"""
    response = client.get("/")
    assert response.status_code == 200
    assert response.json()["status"] == "healthy"

def test_health_check():
    """Test health check endpoint"""
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"

def test_signup_missing_fields():
    """Test signup with missing fields"""
    response = client.post("/auth/signup", json={})
    assert response.status_code == 422  # Validation error

def test_signin_invalid_credentials():
    """Test signin with invalid credentials"""
    response = client.post("/auth/signin", json={
        "email": "nonexistent@example.com",
        "password": "wrong"
    })
    assert response.status_code == 401

def test_protected_endpoint_without_token():
    """Test protected endpoint without authentication"""
    response = client.post("/upload")
    assert response.status_code == 403  # Missing auth header

def test_query_endpoint_without_token():
    """Test query endpoint without authentication"""
    response = client.post("/query", json={
        "question": "test",
        "search_type": "hybrid"
    })
    assert response.status_code == 403  # Missing auth header