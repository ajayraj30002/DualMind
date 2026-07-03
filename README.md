<div align="center">

<img src="assets/dualmind_logo.png" alt="DualMind Logo" width="160" />

# DualMind

**Agentic Hybrid RAG System — PDF & Web Search — Multi-Intent Routing**

An intelligent conversational AI that combines document-based retrieval with real-time web search,<br/>
powered by an LLM-driven agentic router that autonomously classifies intent and selects retrieval strategy.

<br/>

[![Python](https://img.shields.io/badge/Python-3.11-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![Groq](https://img.shields.io/badge/Groq-LLM-F55036?style=for-the-badge&logo=groq&logoColor=white)](https://groq.com)
[![Supabase](https://img.shields.io/badge/Supabase-pgvector-3FCF8E?style=for-the-badge&logo=supabase&logoColor=white)](https://supabase.com)
[![Cohere](https://img.shields.io/badge/Cohere-Rerank-FF4D00?style=for-the-badge&logo=cohere&logoColor=white)](https://cohere.com)
[![Tavily](https://img.shields.io/badge/Tavily-Search-00B4D8?style=for-the-badge&logo=tavily&logoColor=white)](https://tavily.com)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://docker.com)
[![GitHub Actions](https://img.shields.io/badge/CI%2FCD-Automated-2088FF?style=for-the-badge&logo=githubactions&logoColor=white)](https://github.com/features/actions)
[![Render](https://img.shields.io/badge/Deploy-Render-46E3B7?style=for-the-badge&logo=render&logoColor=white)](https://render.com)
[![Vercel](https://img.shields.io/badge/Frontend-Vercel-000000?style=for-the-badge&logo=vercel&logoColor=white)](https://vercel.com)
[![License](https://img.shields.io/badge/License-MIT-3DA639?style=for-the-badge&logo=opensourceinitiative&logoColor=white)](LICENSE)

</div>

<br/>

---
## Demo Video

<p align="center">
  <video src="assets/dualmind-demo.mp4" controls width="100%" preload="metadata"></video>
</p>



## <img src="https://img.shields.io/badge/―-Features-f97316?style=flat-square" height="22" />

<table>
<tr>
<td width="50%">

<img src="https://img.shields.io/badge/▸-Agentic_Router-f97316?style=flat-square" height="18" /><br/>
LLM-powered intent classification across 10 intent types — autonomously decides <em>how</em> to answer every query

<img src="https://img.shields.io/badge/▸-PDF_RAG-4299e1?style=flat-square" height="18" /><br/>
Upload PDFs and query them with hybrid semantic + BM25 keyword retrieval

<img src="https://img.shields.io/badge/▸-Web_Search-00B4D8?style=flat-square" height="18" /><br/>
Real-time web search via Tavily API with automatic fallback when documents lack answers

<img src="https://img.shields.io/badge/▸-Cohere_Reranking-FF4D00?style=flat-square" height="18" /><br/>
Cross-encoder reranking (rerank-v3.5) for precision-optimized source selection

</td>
<td width="50%">

<img src="https://img.shields.io/badge/▸-Hybrid_Retrieval-9f7aea?style=flat-square" height="18" /><br/>
Combines PDF search + web search with intelligent fallback — the system decides the optimal strategy

<img src="https://img.shields.io/badge/▸-Multi--Session_Chat-48bb78?style=flat-square" height="18" /><br/>
Persistent conversation history with session management, renaming, and context-aware follow-ups

<img src="https://img.shields.io/badge/▸-JWT_Authentication-ed8936?style=flat-square" height="18" /><br/>
Secure user accounts with bcrypt password hashing and JWT token-based auth

<img src="https://img.shields.io/badge/▸-Docker_+_CI/CD-2496ED?style=flat-square" height="18" /><br/>
Containerized deployment with automated GitHub Actions pipeline — test, build, deploy

</td>
</tr>
</table>

<br/>

---

<br/>

## <img src="https://img.shields.io/badge/―-How_the_Agentic_Router_Works-f97316?style=flat-square" height="22" />

DualMind's standout feature is its **agentic router** — a single Groq LLM call that autonomously decides three things for every user query:

| Decision | What it determines | Example |
|---|---|---|
| **Intent** | What the user wants (1 of 10 types) | `FACTUAL_LOOKUP`, `SUMMARIZE`, `CODE_REQUEST` |
| **Retrieval Mode** | Where to get information | `rag`, `web`, `full_document`, `none` |
| **Query Rewrite** | Optimized search query | "tell me about chapter 3" → "chapter 3 key concepts" |

<br/>

### Intent Classification

The router classifies every query into exactly one of these intents:

```
 FACTUAL_LOOKUP               Specific questions about documents or general knowledge
 FACTUAL_LOOKUP_WEB_FALLBACK  Document lookup with automatic web fallback if PDF lacks answers
 SUMMARIZE                    "What's this?", "explain", "overview" — vague document queries
 GENERATE_NOTES               "Make notes", "bullet points", "key takeaways"
 COMPARE                      "Compare X vs Y", "difference between"
 CODE_REQUEST                 Write, fix, explain, or improve code
 WEB_SEARCH                   Needs live data — news, prices, weather, current events
 CASUAL_CHAT                  Greetings, thanks, opinions, general conversation
 CONVERSATION_RECALL          "What did we discuss?", "earlier you said"
 META_QUESTION                "What can you do?", "what formats do you support?"
```

<br/>

### Routing Decision Flow

```mermaid
flowchart LR
    Q["User Query"] --> R["Agentic Router<br/>(Groq LLM)"]
    R --> |"intent + mode<br/>+ rewritten query"| D{Retrieval Mode?}
    
    D --> |none| CONV["Direct LLM Response<br/>No retrieval needed"]
    D --> |rag| RAG["Semantic + BM25 Search<br/>→ Cohere Rerank → LLM"]
    D --> |web| WEB["Tavily Web Search<br/>→ Cohere Rerank → LLM"]
    D --> |full_document| FULL["Fetch All Chunks<br/>→ Full Context LLM"]

    RAG --> |"low quality<br/>results?"| FALL["Web Fallback"]
    
    style Q fill:#1a1a1a,stroke:#f97316,color:#fff
    style R fill:#f97316,stroke:#dd6b20,color:#fff
    style D fill:#1a1a1a,stroke:#f97316,color:#fff
    style CONV fill:#1a1a1a,stroke:#48bb78,color:#fff
    style RAG fill:#1a1a1a,stroke:#4299e1,color:#fff
    style WEB fill:#1a1a1a,stroke:#00B4D8,color:#fff
    style FULL fill:#1a1a1a,stroke:#9f7aea,color:#fff
    style FALL fill:#1a1a1a,stroke:#fc8181,color:#fff
```

> The router includes a **regex-based fallback** — if the Groq API call fails, pattern matching ensures the system still routes correctly.

<br/>

---

<br/>

## <img src="https://img.shields.io/badge/―-Architecture-f97316?style=flat-square" height="22" />

```mermaid
flowchart TB
    subgraph CLIENT["CLIENT LAYER"]
        UI["Frontend<br/>HTML/CSS/JS + Marked + hljs"]
    end

    subgraph API["API GATEWAY"]
        FAST["FastAPI + Uvicorn<br/>Auth | Chat | Upload"]
        AUTH["JWT + bcrypt"]
    end

    subgraph CORE["CORE ORCHESTRATION"]
        ROUTER["Agentic Router<br/>Intent + Mode + Rewrite"]
        GENERATOR["Answer Generator"]
    end

    subgraph RETRIEVAL["RETRIEVAL LAYER"]
        PDF["PDF Search"]
        SEMANTIC["Semantic Search<br/>pgvector cosine similarity"]
        KEYWORD["Keyword Search<br/>BM25 scoring"]
        WEB["Web Search"]
        RERANK["Cohere Rerank v3.5"]
    end

    subgraph DATA["DATA LAYER"]
        SUPABASE["Supabase PostgreSQL<br/>Users | Sessions | Messages"]
        VECTOR["Supabase pgvector<br/>Embeddings + Chunks"]
        EMBED["paraphrase-MiniLM-L3-v2<br/>Local Embeddings"]
    end

    subgraph EXTERNAL["EXTERNAL SERVICES"]
        GROQ["Groq API<br/>Llama 3.3 70B Versatile"]
        TAVILY["Tavily API"]
        COHERE["Cohere API"]
    end

    subgraph DEPLOY["DEPLOYMENT"]
        GHA["GitHub Actions"]
        DOCKER["Docker Hub"]
        RENDER["Render"]
        VERCEL["Vercel"]
    end

    UI -->|"1. POST /messages"| FAST
    FAST -->|"2. Forward query"| ROUTER
    ROUTER -->|"3. Classify intent"| GROQ
    GROQ -->|"4. intent + mode + query"| ROUTER
    ROUTER -->|"5. Rewritten query"| PDF
    ROUTER -->|"5. Rewritten query"| WEB
    
    PDF -->|semantic path| SEMANTIC
    PDF -->|keyword path| KEYWORD
    SEMANTIC -->|generate embedding| EMBED
    EMBED -->|cosine similarity| VECTOR
    VECTOR -->|chunks + scores| SEMANTIC
    KEYWORD -->|fetch + BM25 score| SUPABASE
    
    SEMANTIC -->|ranked chunks| RERANK
    KEYWORD -->|ranked chunks| RERANK
    WEB -->|search| TAVILY
    TAVILY -->|results| WEB
    WEB -->|results| RERANK
    RERANK -->|rerank| COHERE
    COHERE -->|scores| RERANK
    
    RERANK -->|top sources| GENERATOR
    GENERATOR -->|generate answer| GROQ
    GROQ -->|answer| GENERATOR
    GENERATOR -->|response| FAST
    FAST -->|"6. Answer + sources"| UI
    
    GHA -->|build + push| DOCKER
    DOCKER -->|pull| RENDER
    UI -->|deploy| VERCEL

    style CLIENT fill:#667eea,stroke:#5a67d8,stroke-width:2px,color:#fff
    style API fill:#48bb78,stroke:#38a169,stroke-width:2px,color:#fff
    style CORE fill:#ed8936,stroke:#dd6b20,stroke-width:2px,color:#fff
    style RETRIEVAL fill:#4299e1,stroke:#3182ce,stroke-width:2px,color:#fff
    style DATA fill:#9f7aea,stroke:#805ad5,stroke-width:2px,color:#fff
    style EXTERNAL fill:#fc8181,stroke:#f56565,stroke-width:2px,color:#fff
    style DEPLOY fill:#a0aec0,stroke:#718096,stroke-width:2px,color:#fff
```

<br/>

---

<br/>

## <img src="https://img.shields.io/badge/―-Tech_Stack-f97316?style=flat-square" height="22" />

### Backend

| Technology | Purpose |
|---|---|
| **FastAPI + Uvicorn** | Async web framework + ASGI server |
| **Groq API** | LLM inference (Llama 3.3 70B Versatile) |
| **Supabase PostgreSQL** | Relational database — users, sessions, messages |
| **Supabase pgvector** | Vector database — semantic similarity search |
| **SentenceTransformers** | Local embedding model (paraphrase-MiniLM-L3-v2) |
| **BM25 (Custom)** | Keyword-based lexical retrieval with IDF scoring |
| **Cohere API** | Cross-encoder result reranking (rerank-v3.5) |
| **Tavily API** | Real-time web search |
| **PyPDF** | PDF text extraction and chunking |
| **JWT + bcrypt** | Token authentication + password hashing |
| **Pydantic** | Request/response schema validation |

### Frontend

| Technology | Purpose |
|---|---|
| **HTML5 / CSS3** | UI structure and styling |
| **Vanilla JavaScript** | Core application logic |
| **Marked.js** | Markdown rendering |
| **Highlight.js** | Code syntax highlighting |
| **Font Awesome** | UI icons |
| **DM Sans + JetBrains Mono** | Typography (Google Fonts) |

### DevOps

| Tool | Purpose |
|---|---|
| **Docker** | Containerization |
| **GitHub Actions** | CI/CD — test, build, push, deploy |
| **Docker Hub** | Container registry |
| **Render** | Backend hosting |
| **Vercel** | Frontend hosting |

<br/>

---

<br/>

## <img src="https://img.shields.io/badge/―-Quick_Start-f97316?style=flat-square" height="22" />

### Prerequisites

- Python 3.11+
- Docker (optional, for containerized deployment)
- API keys: [Groq](https://console.groq.com), [Tavily](https://tavily.com), [Cohere](https://dashboard.cohere.com), [Supabase](https://supabase.com)

### 1. Clone the repository

```bash
git clone https://github.com/ajayraj30002/DualMind.git
cd DualMind
```

### 2. Set up environment variables

Create a `.env` file in the `backend/` directory (see [`backend/.env.example`](backend/.env.example)):

```env
# LLM
GROQ_API_KEY=your_groq_api_key

# Search
TAVILY_API_KEY=your_tavily_api_key

# Reranking
COHERE_API_KEY=your_cohere_api_key

# Database (Supabase)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_JWT_SECRET=your_supabase_jwt_secret

# Authentication
JWT_SECRET_KEY=your_jwt_secret_key
JWT_ALGORITHM=HS256
JWT_EXPIRY_MINUTES=60

# CORS
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5500
```

### 3. Supabase setup

Enable the **pgvector** extension in your Supabase project and create the required tables:

```sql
-- Enable vector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Users table
CREATE TABLE users (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    hashed_password TEXT NOT NULL,
    full_name TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Document chunks with vector embeddings
CREATE TABLE document_chunks (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES users(id),
    filename TEXT NOT NULL,
    chunk_text TEXT NOT NULL,
    chunk_index INTEGER,
    embedding VECTOR(384)
);

-- Vector similarity search function
CREATE OR REPLACE FUNCTION match_documents(
    query_embedding VECTOR(384),
    match_user_id UUID,
    match_count INT DEFAULT 5
) RETURNS TABLE (
    chunk_text TEXT,
    filename TEXT,
    chunk_index INT,
    similarity FLOAT
) AS $$
    SELECT chunk_text, filename, chunk_index,
           1 - (embedding <=> query_embedding) AS similarity
    FROM document_chunks
    WHERE user_id = match_user_id
    ORDER BY embedding <=> query_embedding
    LIMIT match_count;
$$ LANGUAGE sql;
```

### 4a. Run with Docker

```bash
cd backend
docker-compose up --build
```

### 4b. Run without Docker

```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

### 5. Open the frontend

Open `frontend/index.html` in your browser, or serve it with any static file server:

```bash
cd frontend
python -m http.server 5500
```

<br/>

---

<br/>

## <img src="https://img.shields.io/badge/―-Project_Structure-f97316?style=flat-square" height="22" />

```
DualMind/
├── backend/
│   ├── app/
│   │   ├── main.py                  # FastAPI application — all REST endpoints
│   │   ├── config.py                # Environment variables and settings
│   │   ├── auth.py                  # JWT token creation and verification
│   │   ├── vector_store.py          # Embeddings, semantic search, BM25, PDF processing
│   │   ├── models/
│   │   │   └── schemas.py           # Pydantic request/response models
│   │   └── rag/
│   │       ├── hybrid.py            # Agentic router + RAG pipeline + answer generation
│   │       ├── closed_domain.py     # PDF document search interface
│   │       ├── open_domain.py       # Tavily web search interface
│   │       └── response_formatter.py # Smart response formatting and source attribution
│   ├── tests/
│   │   ├── test_main.py             # API endpoint tests
│   │   └── test_hybrid_routing.py   # Agentic router unit tests
│   ├── Dockerfile
│   ├── docker-compose.yaml
│   └── requirements.txt
├── frontend/
│   ├── index.html                   # Complete UI — login, chat, sidebar, document management
│   ├── script.js                    # Client logic — auth, sessions, messaging, file upload
│   └── styles.css                   # Styling
├── .github/
│   └── workflows/
│       └── deploy.yaml              # CI/CD — test → build → push → deploy
└── assets/
    └── dualmind_logo.png
```

<br/>

---

<br/>

## <img src="https://img.shields.io/badge/―-CI/CD_Pipeline-f97316?style=flat-square" height="22" />

```mermaid
flowchart LR
    A["Push to main"] --> B["Run Tests<br/>pytest + coverage"]
    B --> C["Build Docker Image"]
    C --> D["Push to Docker Hub"]
    D --> E["Deploy Backend<br/>Render"]
    A --> F["Deploy Frontend<br/>Vercel"]
    
    style A fill:#1a1a1a,stroke:#f97316,color:#fff
    style B fill:#1a1a1a,stroke:#48bb78,color:#fff
    style C fill:#1a1a1a,stroke:#2496ED,color:#fff
    style D fill:#1a1a1a,stroke:#2496ED,color:#fff
    style E fill:#1a1a1a,stroke:#46E3B7,color:#fff
    style F fill:#1a1a1a,stroke:#000,color:#fff
```

| Job | Trigger | What it does |
|---|---|---|
| **Test** | Every push & PR | Runs `pytest` with coverage report |
| **Build & Push** | Push to `main` | Builds Docker image, pushes to Docker Hub |
| **Deploy Backend** | After build | Triggers Render deployment, verifies health check |
| **Deploy Frontend** | Push to `main` | Automatic Vercel deployment |

<br/>

---

<br/>

## <img src="https://img.shields.io/badge/―-License-f97316?style=flat-square" height="22" />

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

<br/>

---

<div align="center">

<img src="assets/dualmind_logo.png" width="40" />

**Built with intent-driven intelligence**

</div>
