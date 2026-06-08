# 🧠 DualMind — Hybrid RAG Assistant

<div align="center">

![Python](https://img.shields.io/badge/Python-3.11-blue?logo=python)
![FastAPI](https://img.shields.io/badge/FastAPI-0.115-green?logo=fastapi)
![Docker](https://img.shields.io/badge/Docker-✓-blue?logo=docker)
![PostgreSQL](https://img.shields.io/badge/Supabase-pgvector-3b82f6?logo=supabase)
![CI/CD](https://img.shields.io/badge/CI/CD-GitHub_Actions-2088FF?logo=github-actions)
![Groq](https://img.shields.io/badge/Groq-LLM-orange?logo=groq)
![RAG](https://img.shields.io/badge/RAG-Retrieval_Augmented_Generation-blue?style=for-the-badge)
![Vector DB](https://img.shields.io/badge/Vector_Search-Pgvector-316192?style=for-the-badge&logo=postgresql&logoColor=white)

</div>

A production-oriented hybrid Retrieval-Augmented Generation (RAG) system that combines private document retrieval with real-time web search to provide accurate, up-to-date answers. DualMind is built with FastAPI, Supabase (pgvector), Groq LLMs, and a modular embedding pipeline.

Table of Contents
- Project overview
- Key features
- Architecture
- Quick start (local & Docker)
- Environment variables
- Deployment notes
- Contributing
- License


## 📋 Project overview

DualMind enables intelligent querying across private documents (PDFs) and live web sources. Users upload documents which are chunked and embedded; those embeddings are stored in a vector database (pgvector). At query time DualMind performs a hybrid retrieval combining vector search over private documents with real-time web search results, then composes a final answer using a large language model.

This repository contains the backend (FastAPI) and frontend assets for a chat-like assistant with persistent sessions, JWT authentication, and Dockerized deployment.


## ✨ Key features

- 🔐 JWT-based user authentication integrated with Supabase
- 📄 PDF ingestion pipeline: page-level parsing, chunking, embeddings
- 🌐 Real-time web retrieval via Tavily API (configurable)
- 🔎 Hybrid search: combine document retrieval + web search
- 💬 Chat sessions with persistent history and auto-naming
- 🎨 Modern dark-themed responsive UI
- 🐳 Docker-ready backend for reproducible deployment
- ⚙️ CI/CD with GitHub Actions (build & deploy flow)
- 🔒 Security best-practices: JWT, CORS, and Row Level Security (RLS) where applicable


## 🏗️ System architecture

High-level flow:

User → Frontend (Vercel or static host) → Backend (FastAPI on Render or similar) → Supabase (pgvector)
                                         ↘
                                          Groq LLM API (Llama 3.3 70B)
                                         ↘
                                          Tavily Web Search

Components:
- Backend: FastAPI, Python 3.11 — handles auth, PDF processing, vector ingestion, RAG orchestration, and API endpoints.
- Vector DB: Supabase (Postgres + pgvector) used for embeddings storage and similarity search.
- LLM: Groq API (Llama 3.3 70B) for generation; model and provider are configurable.
- Web Search: Tavily API for retrieving live web results to supplement private knowledge.
- Frontend: Lightweight HTML/CSS/JS chat UI — can be hosted separately (e.g., Vercel).


## 📥 Quick start

Prerequisites:
- Python 3.11
- Docker (optional, recommended for production)
- Supabase project (Postgres + pgvector)
- Groq API key (or other LLM provider)
- Tavily API key (optional, for web retrieval)

Local development:

1. Clone the repo

   git clone https://github.com/ajayraj30002/DualMind.git
   cd DualMind

2. Create and activate a virtual environment

   python -m venv .venv
   source .venv/bin/activate  # macOS/Linux
   .\.venv\Scripts\activate  # Windows

3. Install dependencies

   pip install -r requirements.txt

4. Create a .env file at the project root and populate required variables (see next section)

5. Ensure your Supabase/Postgres instance has the pgvector extension enabled and run any migration scripts if provided.

6. Start the backend (adjust path to your entrypoint if different)

   uvicorn app.main:app --reload

7. Open the frontend (if static files are present) or point a browser to the running backend endpoints.


Docker (quick):

- Build and run with Docker (example):

  docker build -t dualmind:latest .
  docker run --env-file .env -p 8000:8000 dualmind:latest

For production, use the provided GitHub Actions workflow to build and push images and deploy to Render or your preferred host.


## ⚙️ Environment variables

Create a .env file or set environment variables in your host/platform. Common variables (adjust names to your implementation):

- SUPABASE_URL
- SUPABASE_KEY
- DATABASE_URL (Postgres connection string)
- JWT_SECRET
- GROQ_API_KEY (or other LLM provider key)
- TAVILY_API_KEY (optional)
- EMBEDDING_MODEL (e.g., sentence-transformers/paraphrase-MiniLM-L3-v2)
- VECTOR_TABLE_NAME (default: documents_embeddings)

Make sure your Postgres instance has the pgvector extension installed and the embedding table created.


## 🧪 API examples

Example: GET health

   curl http://localhost:8000/health

Example: POST /upload (multipart/form-data with file)

   curl -X POST "http://localhost:8000/upload" -H "Authorization: Bearer <TOKEN>" -F "file=@./docs/sample.pdf"

Example: POST /chat

   curl -X POST "http://localhost:8000/chat" -H "Content-Type: application/json" -H "Authorization: Bearer <TOKEN>" -d '{"query":"What is the summary of document X?"}'

Adjust routes to match your implementation if names differ.


## 📦 Deployment notes

- CI/CD: GitHub Actions can build Docker images and push to a registry. On pushes to main the workflow can deploy to Render.
- Secrets: Store API keys and DB credentials in your hosting provider's secret store (Render, Docker secrets, GitHub Actions secrets, Supabase envs).
- Scaling: Consider LLM inference costs and vector DB sizing. Use batching for ingestion and caching for common queries.
- Observability: Add structured logging and metrics; monitor LLM latency and error rates.


## 🔧 Testing & Maintenance

- Add tests under a tests/ directory and run them in CI.
- Add retry/backoff for external API calls (Groq, Tavily, Supabase).
- Periodically re-run embeddings for updated documents or when changing embedding model.


## 🤝 Contributing

Contributions are welcome — please follow the GitHub flow:
1. Fork the repository
2. Create a feature branch
3. Open a pull request with a clear description

Guidelines:
- Keep changes focused and well-documented
- Add tests for new behavior where practical
- Use meaningful commit messages


## 📄 License

If you intend to open-source, add a LICENSE file (for example MIT) to clarify terms.


## 🙋 Contact & Acknowledgements

Maintainer: ajayraj30002

Built with: FastAPI, Supabase (pgvector), Groq, Sentence-Transformers, Docker, GitHub Actions

---

If you want I can further customize the README to include exact command names, Docker Compose, or a full API reference generated from the code. Tell me which details you'd like added and I'll update the README accordingly.
