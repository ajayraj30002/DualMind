# 🧠 DualMind — Hybrid RAG Assistant

<div align="center">

![Python](https://img.shields.io/badge/Python-3.11-blue?logo=python)
![FastAPI](https://img.shields.io/badge/FastAPI-0.115-green?logo=fastapi)
![Docker](https://img.shields.io/badge/Docker-✓-blue?logo=docker)
![PostgreSQL](https://img.shields.io/badge/Supabase-pgvector-3b82f6?logo=supabase)
![CI/CD](https://img.shields.io/badge/CI/CD-GitHub_Actions-2088FF?logo=github-actions)
![Groq](https://img.shields.io/badge/Groq-LLM-orange?logo=groq)

</div>

## 🚀 Skills & Technologies

| Category | Technologies |
|----------|--------------|
| **Backend** | FastAPI, Python 3.11, JWT Authentication, bcrypt |
| **AI/LLM** | Groq API (Llama 3.3 70B), RAG Architecture, Hybrid Search |
| **Embeddings** | Sentence-Transformers (paraphrase-MiniLM-L3-v2), Semantic Search |
| **Vector Database** | Supabase pgvector, Cosine Similarity |
| **Frontend** | HTML5, CSS3, JavaScript, Dark Theme UI |
| **Web Search** | Tavily API (Real-time web retrieval) |
| **Database** | PostgreSQL, Supabase (Auth, Storage) |
| **PDF Processing** | PyPDF2, Chunking Strategy, Page-by-Page Parsing |
| **DevOps** | Docker, GitHub Actions CI/CD, Render Deployment |
| **Security** | JWT Tokens, Row Level Security (RLS), CORS |
| **Version Control** | Git, GitHub |

---

## 📋 Project Overview

**DualMind** is a production-grade **Hybrid RAG (Retrieval-Augmented Generation)** system that enables intelligent querying across **private documents** and **real-time web sources**. Users can upload PDFs, ask questions, and receive accurate answers powered by Groq's Llama 3.3 70B LLM.

### ✨ Key Features

| Feature | Description |
|---------|-------------|
| 🔐 **Secure Authentication** | JWT-based user authentication with Supabase |
| 📄 **Document Processing** | Upload PDFs → Chunk → Embed → Store in pgvector |
| 🌐 **Real-time Web Search** | Tavily API integration for live information |
| 🔗 **Hybrid Search** | Combines document retrieval + web search for comprehensive answers |
| 💬 **Chat Sessions** | Persistent conversation history with auto-naming |
| 🎨 **Modern UI** | Dark theme, responsive design, chat-like interface |
| 🐳 **Containerized** | Dockerized backend for consistent deployment |
| ⚙️ **CI/CD Pipeline** | GitHub Actions automates testing, Docker build, and deployment to Render |

---

## 🏗️ System Architecture

┌─────────────────────────────────────────────────────────────────┐
│ Frontend (Vercel) │
│ HTML/CSS/JS + Dark Theme UI │
└─────────────────────────────┬───────────────────────────────────┘
│ HTTPS + JWT
▼
┌─────────────────────────────────────────────────────────────────┐
│ Backend (Render - Docker) │
│ FastAPI Server │
│ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ │
│ │ JWT Auth │ │ PDF │ │ Hybrid │ │
│ │ Middleware │ │ Processing │ │ Search │ │
│ └─────────────┘ └─────────────┘ └─────────────┘ │
└───────────┬─────────────┬─────────────┬─────────────────────────┘
│ │ │
▼ ▼ ▼
┌───────────┐ ┌───────────┐ ┌───────────┐
│ Supabase │ │ Groq │ │ Tavily │
│ pgvector │ │ LLM API │ │ Search │
│ (Vectors) │ │ (Llama 3.3│ │ API │
└───────────┘ └───────────┘ └───────────┘
