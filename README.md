# 🧠 DualMind

<div align="center">

![DualMind Banner](https://img.shields.io/badge/DualMind-Agentic%20Hybrid%20RAG-6366f1?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IndoaXRlIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHBhdGggZD0iTTEyIDJhMTAgMTAgMCAwIDEgMTAgMTBjMCA1LTMgOS04IDktNSAwLTgtNC04LTlzMy05IDgtOSAwIDgtNCA4LTkiLz48cGF0aCBkPSJtOCAxMiA0IDQgNC00Ii8+PHBhdGggZD0iTTEyIDE2VjgiLz48L3N2Zz4=)

**Agentic Hybrid RAG System | PDF & Web Search | Multi-Intent Routing**

[![Python](https://img.shields.io/badge/Python-3.11-3776AB?logo=python&logoColor=white)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![Groq](https://img.shields.io/badge/Groq-LLM-F55036?logo=groq&logoColor=white)](https://groq.com)
[![Cohere](https://img.shields.io/badge/Cohere-Rerank-FF4D00?logo=cohere&logoColor=white)](https://cohere.com)
[![Tavily](https://img.shields.io/badge/Tavily-Search-00B4D8?logo=tavily&logoColor=white)](https://tavily.com)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres-3FCF8E?logo=supabase&logoColor=white)](https://supabase.com)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker&logoColor=white)](https://docker.com)
[![GitHub Actions](https://img.shields.io/badge/CI%2FCD-Automated-2088FF?logo=githubactions&logoColor=white)](https://github.com/features/actions)
[![Render](https://img.shields.io/badge/Deploy-Render-46E3B7?logo=render&logoColor=white)](https://render.com)
[![Vercel](https://img.shields.io/badge/Frontend-Vercel-000000?logo=vercel&logoColor=white)](https://vercel.com)
[![JWT](https://img.shields.io/badge/JWT-Auth-000000?logo=jsonwebtokens&logoColor=white)](https://jwt.io)
[![SentenceTransformers](https://img.shields.io/badge/Embeddings-MiniLM-FFD43B?logo=huggingface&logoColor=black)](https://huggingface.co/sentence-transformers)
[![Markdown](https://img.shields.io/badge/Format-Markdown-000000?logo=markdown&logoColor=white)](https://markdown.com)


</div>

---

## 📌 Overview

**DualMind** is an intelligent conversational AI system that combines document-based RAG (Retrieval-Augmented Generation) with web search capabilities. It features an **agentic router** that intelligently determines query intent and selects the optimal retrieval strategy.

### 🎯 Key Capabilities

| Capability | Description |
|------------|-------------|
| 📄 **PDF Intelligence** | Upload, embed, and query documents with hybrid search (semantic + keyword) |
| 🌐 **Web Integration** | Real-time web search via Tavily API |
| 🧠 **Agentic Router** | Single LLM call for intent classification + retrieval mode + query rewriting |
| 🔄 **Conversational Memory** | Full chat history with session management |
| 📝 **Smart Formatting** | Markdown responses with code highlighting, copy buttons, and source badges |
| 🔐 **Auth System** | JWT-based authentication with Supabase |
| 🚀 **Production Ready** | Dockerized, CI/CD pipeline, deployable to Render/Vercel |

---

## 🏗️ Architecture

```mermaid
flowchart TB
    subgraph FRONTEND["🎨 Frontend (Vercel)"]
        UI[HTML/CSS/JS + Marked + hljs]
    end

    subgraph BACKEND["⚙️ Backend (Render/Docker)"]
        API[FastAPI Endpoints<br/>Auth/Chat/Upload]
        
        subgraph INTELLIGENCE["🧠 Intelligence Layer"]
            ROUTER[Agentic Router<br/>Groq]
            RETRIEVE[Retriever]
            GENERATE[Answer Generator<br/>Groq]
        end
        
        subgraph RETRIEVAL["🔍 Retrieval Layer"]
            PDF[PDF Search<br/>Semantic + Keyword]
            WEB[Web Search<br/>Tavily API]
            RERANK[Cohere Rerank]
        end
    end

    subgraph DATA["💾 Data Layer"]
        SUPABASE[(Supabase<br/>Postgres)]
        VECTOR[(Vector Store<br/>MiniLM Embeddings)]
    end

    UI --> API
    API --> ROUTER
    ROUTER --> RETRIEVE
    RETRIEVE --> PDF
    RETRIEVE --> WEB
    PDF --> RERANK
    WEB --> RERANK
    RERANK --> GENERATE
    GENERATE --> API
    API --> UI
    
    PDF --> VECTOR
    API --> SUPABASE

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

```yaml
Push to main → Run Tests → Build Docker → Push to Registry → Deploy to Render → Deploy to Vercel
