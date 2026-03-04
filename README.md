# C.O.T.E.ai (Study Assistant Bot)

This repository contains a production-style AI learning platform with two tracks:

- `institution`: teacher/student classroom workflows
- `individual`: personal AI roadmap workflows

This README reflects the current codebase state as of March 4, 2026.

## What is implemented

### Authentication and user model
- Username/password auth with token sessions
- Roles: `teacher`, `student`
- Tracks: `institution`, `individual`
- Persistent auth/user data in `data/users.json` and `data/auth_sessions.json`

### Institution track
- Teacher classroom creation with enrollment code
- Student classroom join via 5-character code
- PDF material upload/delete per classroom
- Background ingestion of uploaded PDFs into Chroma vector DB
- Doubt assistant (`/ask`) grounded in classroom materials
- Topic flashcards with language support and cache
- 3-level assessment path (recall, application, creation), XP, mistakes, remedial cooldown
- Teacher analytics and teacher assessment preview
- Teacher review ingestion (`/teacher_review`, `/upload_review`) to refine assistant behavior

### Individual track
- AI-generated roadmaps with day/week structure
- Week 1 includes deep content; later weeks are outline-first and can be expanded on demand
- Day-level progress tracking
- Week content generation endpoint for deferred deep content
- Coding roadmap normalization for YouTube/practice resources
- New rule: engineering/developer-productivity roadmaps set the final day to interview prep with 30 relevant interview questions

## Tech stack

- Frontend: React 18, TypeScript, Vite, Tailwind CSS 4, MUI, Radix UI, Framer Motion
- Backend: FastAPI, Pydantic, SQLite (app metadata), JSON persistence for auth/progress caches
- AI and RAG:
  - Google Gemini (`gemini-2.0-flash`)
  - LangChain
  - ChromaDB
  - HuggingFace embeddings (`sentence-transformers/all-MiniLM-L6-v2`)
- PDF parsing: `unstructured[pdf]`, `poppler`, `tesseract`
- Optional cloud storage: AWS S3 (via `boto3`)

## Repository layout

```text
.
|- frontend/                 # React app (UI for institution + individual tracks)
|- main.py                  # FastAPI app and all route wiring
|- ingestion_pipeline.py    # PDF ingestion + chunking + vector upsert
|- retrieval_service.py     # Doubt assistant retrieval and answer generation
|- assessment_service.py    # Assessment generation, XP, mistakes, remedial logic
|- flashcard_service.py     # Flashcard generation/edit/refine pipeline
|- roadmap_service.py       # Roadmap generation, week expansion, progress
|- topic_mapper.py          # Topic grouping helper
|- data/                    # Runtime data (users, sessions, progress, roadmaps, assessments)
|- uploads/                 # Uploaded classroom files and teacher review artifacts
|- chroma_db/               # Vector store persistence
|- Dockerfile               # Backend container image
```

## Prerequisites

- Python 3.10+ (3.11 recommended)
- Node.js 20+
- Google API key for Gemini

For local PDF parsing, ensure system deps are available:
- `poppler-utils`
- `tesseract-ocr`

(`Dockerfile` already installs these for containerized backend runs.)

## Environment variables

Create `.env` in project root:

```env
GOOGLE_API_KEY=your_google_api_key

# Optional
CORS_ORIGINS=*                       # or comma-separated origins
AWS_REGION=ap-southeast-2
S3_BUCKET_NAME=your_bucket_name      # if using S3 upload backup
```

## Local setup

### 1. Backend

```bash
python -m venv venv
source venv/bin/activate   # Windows: .\venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload
```

Backend runs at `http://localhost:8000` by default.

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend runs at `http://localhost:5173` by default.

Optional frontend env (`frontend/.env`):

```env
VITE_API_BASE_URL=http://localhost:8000
```

## Docker (backend)

```bash
docker build -t study-assistant-bot .
docker run --rm -p 8000:8000 --env-file .env study-assistant-bot
```

## API overview

Main groups currently exposed in `main.py`:

- Health and status:
  - `GET /`
  - `GET /health`
- Auth:
  - `POST /api/auth/signup`
  - `POST /api/auth/login`
  - `GET /api/auth/me`
  - `POST /api/auth/logout`
- Doubt assistant and ingestion:
  - `POST /ask`
  - `POST /upload`
- Classrooms:
  - `GET /api/classrooms/mine`
  - `POST /api/classrooms`
  - `POST /api/classrooms/join`
  - `DELETE /api/classrooms/{classroom_id}/materials/{material_id}`
  - `GET /api/classrooms/{classroom_id}/people`
  - `GET /api/classrooms`
- Assessments and progress:
  - `POST /api/assessment/generate`
  - `POST /api/assessment/submit`
  - `GET /api/mistakes/{session_id}`
  - `POST /api/mistakes/comment`
  - `GET /api/progress/{session_id}`
  - `POST /api/add_xp`
  - `POST /api/spend_xp`
  - `POST /api/remedial/complete`
  - `GET /api/teacher/analytics/{session_id}`
  - `GET /api/teacher/assessments/{session_id}`
- Flashcards:
  - `GET /api/flashcards/{session_id}`
  - `POST /api/flashcards/update`
  - `POST /api/flashcards/ai-edit`
- Roadmaps:
  - `POST /api/roadmap/generate`
  - `GET /api/roadmaps/{session_id}`
  - `GET /api/roadmap/{roadmap_id}`
  - `POST /api/roadmap/{roadmap_id}/complete_day`
  - `POST /api/roadmap/{roadmap_id}/generate_week`
- Teacher review:
  - `POST /teacher_review`
  - `POST /upload_review`

Use `http://localhost:8000/docs` for live OpenAPI docs.

## Roadmap behavior notes

- Full outline is generated for requested duration.
- Deep content is generated for week 1 initially.
- Future weeks can be expanded via `generate_week`.
- Coding topics auto-normalize practice sources (`HackerRank`/`LeetCode`) and YouTube fallback links.
- For engineering/developer-productivity prompts, final roadmap day is forced to interview-only content with 30 relevant interview questions.

## Data and persistence

- Classroom metadata: SQLite (`data/app.db`)
- Auth/progress/session state: JSON files under `data/`
- Uploaded files: `uploads/{session_id}/`
- Embeddings and vectors: `chroma_db/`

For clean local resets, stop services and remove `data/`, `uploads/`, and `chroma_db/` carefully.

## License

MIT License
