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

## 🏗️ Architecture

```mermaid
flowchart TB
    subgraph CLIENT["🖥️ Client Layer"]
        FRONTEND["Frontend (Vercel)<br/>HTML/CSS/JS + Marked + hljs"]
    end

    subgraph BACKEND["⚙️ Backend Layer (Render/Docker)"]
        API["FastAPI Server<br/>Auth | Chat | Upload | Documents"]
        
        subgraph INTELLIGENCE["🧠 Intelligence Layer"]
            ROUTER["Agentic Router (Groq)<br/>Intent + Mode + Rewrite"]
            GENERATE["Answer Generator (Groq)<br/>RAG | Summary | Code"]
        end
        
        subgraph RETRIEVAL["🔍 Retrieval Layer"]
            PDF["PDF Search<br/>Semantic + Keyword"]
            WEB["Web Search<br/>Tavily API"]
            RERANK["Cohere Rerank"]
        end
    end

    subgraph DATA["💾 Data Layer"]
        SUPABASE[(Supabase<br/>Postgres<br/>Users/Sessions/Messages)]
        VECTOR[(Vector Store<br/>MiniLM-L3-v2<br/>Embeddings)]
    end

    FRONTEND -->|HTTP Request| API
    API --> ROUTER
    ROUTER -->|Retrieval Mode| RETRIEVAL
    ROUTER -->|Intent| GENERATE
    
    PDF --> RERANK
    WEB --> RERANK
    RERANK -->|Top K Sources| GENERATE
    
    GENERATE -->|Final Answer| API
    API -->|JSON Response| FRONTEND
    
    PDF -.->|Query| VECTOR
    API -.->|CRUD| SUPABASE
