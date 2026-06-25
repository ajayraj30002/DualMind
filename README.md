# 🧠 DualMind
 
<div align="center">

![DualMind Banner](https://img.shields.io/badge/DualMind-Agentic%20Hybrid%20RAG-6366f1?style=for-the-badge)

**Agentic Hybrid RAG System | PDF & Web Search | Multi-Intent Routing**

[![Python](https://img.shields.io/badge/Python-3.11-3776AB?logo=python&logoColor=white)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![Groq](https://img.shields.io/badge/Groq-LLM-F55036?logo=groq&logoColor=white)](https://groq.com)
[![Cohere](https://img.shields.io/badge/Cohere-Rerank-FF4D00?logo=cohere&logoColor=white)](https://cohere.com)
[![Tavily](https://img.shields.io/badge/Tavily-Search-00B4D8?logo=tavily&logoColor=white)](https://tavily.com)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres-3FCF8E?logo=supabase&logoColor=white)](https://supabase.com)
[![pgvector](https://img.shields.io/badge/pgvector-Vector%20DB-4169E1?logo=postgresql&logoColor=white)](https://github.com/pgvector/pgvector)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker&logoColor=white)](https://docker.com)
[![GitHub Actions](https://img.shields.io/badge/CI%2FCD-Automated-2088FF?logo=githubactions&logoColor=white)](https://github.com/features/actions)
[![Render](https://img.shields.io/badge/Deploy-Render-46E3B7?logo=render&logoColor=white)](https://render.com)
[![Vercel](https://img.shields.io/badge/Frontend-Vercel-000000?logo=vercel&logoColor=white)](https://vercel.com)
[![License](https://img.shields.io/badge/License-MIT-3DA639?logo=opensourceinitiative&logoColor=white)](LICENSE)

</div>

---

## 📌 Overview

**DualMind** is an intelligent conversational AI system that combines document-based RAG with web search capabilities. Features an **agentic router** that intelligently determines query intent and selects optimal retrieval strategy.

---

## ✨ Key Features

| Feature | Description |
|---------|-------------|
| 🧠 **Agentic Intent Router** | LLM-powered router detects query intent (conversation/document/web/hybrid) and dynamically selects the optimal retrieval strategy |
| 🔀 **Multi-Intent Routing** | Routes queries to appropriate sources: PDF-only, web-only, or hybrid combination based on context |
| 📄 **PDF Processing** | Upload and process PDFs with semantic chunking (500 chars, 100 overlap) and store embeddings in pgvector |
| 🔍 **Hybrid Retrieval** | Combines semantic search (pgvector) + keyword search (BM25-style) for comprehensive document retrieval |
| 🌐 **Real-time Web Search** | Tavily API integration for live information retrieval |
| 🔗 **Cohere Reranking** | Re-ranks retrieved results for improved relevance |
| 💬 **Chat Sessions** | Persistent conversation history with auto-naming |
| 🎨 **Modern UI** | Dark theme, responsive design, chat-like interface with code syntax highlighting |
| 🔐 **JWT Authentication** | Secure authentication with bcrypt password hashing and email verification (OTP) |
| 🐳 **Containerized** | Dockerized backend for consistent deployment |
| ⚙️ **CI/CD Pipeline** | GitHub Actions automates testing, Docker build, and deployment to Render |

---

## 🏗️ Architecture

```mermaid
flowchart TB
    subgraph CLIENT["🖥️ CLIENT LAYER"]
        UI["Frontend<br/>HTML/CSS/JS + Marked + hljs"]
    end

    subgraph API["🚪 API GATEWAY"]
        FAST["FastAPI Server<br/>Auth | Chat | Upload"]
        AUTH["JWT + bcrypt"]
    end

    subgraph CORE["⚙️ CORE ORCHESTRATION"]
        ROUTER["Agentic Router (Groq)<br/>Intent + Mode + Rewrite"]
        GENERATOR["Answer Generator (Groq)"]
    end

    subgraph RETRIEVAL["🔍 RETRIEVAL LAYER"]
        PDF["PDF Search"]
        SEMANTIC["Semantic (pgvector)"]
        KEYWORD["Keyword (BM25)"]
        WEB["Web Search (Tavily)"]
        RERANK["Cohere Rerank"]
    end

    subgraph DATA["💾 DATA LAYER"]
        SUPABASE["Supabase pgvector<br/>Embeddings + Chunks"]
        VECTOR["MiniLM-L3-v2<br/>Local Embeddings"]
    end

    subgraph EXTERNAL["☁️ EXTERNAL SERVICES"]
        GROQ["Groq API<br/>Llama 3.3 70B"]
        TAVILY["Tavily API"]
        COHERE["Cohere API"]
    end

    subgraph DEPLOY["🚀 DEPLOYMENT"]
        GHA["GitHub Actions"]
        DOCKER["Docker Hub"]
        RENDER["Render"]
        VERCEL["Vercel"]
    end

    %% USER FLOW (left to right)
    UI -->|1. POST /messages| FAST
    FAST -->|2. Forward question| ROUTER
    ROUTER -->|3. Groq call| GROQ
    GROQ -->|4. intent + mode + query| ROUTER
    ROUTER -->|5. rewritten query| PDF
    ROUTER -->|5. rewritten query| WEB
    
    %% PDF RETRIEVAL FLOW
    PDF -->|semantic search| SEMANTIC
    PDF -->|keyword search| KEYWORD
    SEMANTIC -->|query embedding| VECTOR
    VECTOR -->|similarity search| SUPABASE
    SUPABASE -->|chunks + scores| SEMANTIC
    KEYWORD -->|fetch chunks| SUPABASE
    
    %% COMBINE RESULTS
    SEMANTIC -->|chunks| RERANK
    KEYWORD -->|chunks| RERANK
    WEB -->|search| TAVILY
    TAVILY -->|results| WEB
    WEB -->|chunks| RERANK
    RERANK -->|call| COHERE
    COHERE -->|scores| RERANK
    
    %% FINAL ANSWER
    RERANK -->|top sources| GENERATOR
    GENERATOR -->|call| GROQ
    GROQ -->|answer| GENERATOR
    GENERATOR -->|response| FAST
    FAST -->|6. answer + sources| UI
    
    %% DEPLOYMENT FLOW
    GHA -->|build & push| DOCKER
    DOCKER -->|pull| RENDER
    UI -->|deploy| VERCEL

    %% Styling
    style CLIENT fill:#667eea,stroke:#5a67d8,stroke-width:2px,color:#fff
    style API fill:#48bb78,stroke:#38a169,stroke-width:2px,color:#fff
    style CORE fill:#ed8936,stroke:#dd6b20,stroke-width:2px,color:#fff
    style RETRIEVAL fill:#4299e1,stroke:#3182ce,stroke-width:2px,color:#fff
    style DATA fill:#9f7aea,stroke:#805ad5,stroke-width:2px,color:#fff
    style EXTERNAL fill:#fc8181,stroke:#f56565,stroke-width:2px,color:#fff
    style DEPLOY fill:#a0aec0,stroke:#718096,stroke-width:2px,color:#fff
```

## 🧩 Tech Stack

### Backend
| Technology | Purpose |
|------------|---------|
| **FastAPI** | Async web framework |
| **Groq API** | LLM inference (Llama 3.3 70B) |
| **Tavily API** | Web search |
| **Cohere API** | Result reranking |
| **Supabase** | PostgreSQL + Auth |
| **SentenceTransformers** | Local embeddings (paraphrase-MiniLM-L3-v2) |
| **PyPDF** | PDF text extraction |
| **JWT** | Authentication |

### Frontend
| Technology | Purpose |
|------------|---------|
| **HTML5/CSS3** | UI structure & styling |
| **Vanilla JS** | Core logic |
| **Marked.js** | Markdown rendering |
| **Highlight.js** | Code syntax highlighting |
| **Font Awesome** | Icons |

### DevOps
| Tool | Purpose |
|------|---------|
| **Docker** | Containerization |
| **GitHub Actions** | CI/CD Pipeline |
| **Render** | Backend hosting |
| **Vercel** | Frontend hosting |

---

## 🚦 CI/CD Pipeline

Push to main → Run Tests → Build Docker → Push to Registry → Deploy to Render → Deploy to Vercel

GitHub Actions Jobs:

1.Test - Runs pytest with coverage

2.Build & Push - Docker image to Docker Hub

3.Deploy Backend - Trigger Render 
