from fastapi import FastAPI, UploadFile, File, BackgroundTasks, HTTPException, Form
from typing import List
import os
import shutil
import uuid
import json # Added json import as it's used later in the code

from ingestion_pipeline import ingest_directory
from retrieval_service import get_doubt_assistant_response

from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import assessment_service
import flashcard_service
import roadmap_service
from typing import List, Dict, Any, Optional

app = FastAPI()

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # For development; refine this for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ----------------------------
# CONFIG
# ----------------------------
UPLOAD_ROOT = "uploads"
ALLOWED_EXTENSIONS = {".pdf"}

os.makedirs(UPLOAD_ROOT, exist_ok=True)

app.mount("/uploads", StaticFiles(directory=UPLOAD_ROOT), name="uploads")

# ----------------------------
# HELPERS
# ----------------------------
def is_allowed_file(filename: str) -> bool:
    return any(filename.lower().endswith(ext) for ext in ALLOWED_EXTENSIONS)

# ----------------------------
# STATUS ENDPOINTS
# ----------------------------

@app.get("/")
async def root():
    return {
        "message": "Study Assistant Bot API is running!",
        "docs": "/docs",
        "endpoints": {
            "upload": "/upload (POST)",
            "status": "/health (GET)"
        }
    }

@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "study-assistant-ingestion"}

# ----------------------------
# DOUBT ASSISTANT ENDPOINT
# ----------------------------

@app.post("/ask")
async def ask_question(session_id: str, query: str, language: str = "english", track: str = "institution"):
    print(f"📥 /ask Request - Session: {session_id}, Query: {query}, Lang: {language}, Track: {track}")
    """
    Endpoint for the Doubt Assistant. Supports both RAG (Institution) and General (Individual) tracks.
    """
    try:
        is_individual = track == "individual"
        response = get_doubt_assistant_response(query, session_id, language, is_individual)
        return {"response": response}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ----------------------------
# UPLOAD ENDPOINT
# ----------------------------

@app.post("/upload")
async def upload_files(
    files: List[UploadFile] = File(...),
    session_id: str = Form("default"),
    background_tasks: BackgroundTasks = BackgroundTasks()
):
    if not files:
        raise HTTPException(status_code=400, detail="No files uploaded")

    # Use provided session_id or 'default'
    session_dir = os.path.join(UPLOAD_ROOT, session_id)

    os.makedirs(session_dir, exist_ok=True)

    saved_files = []
    rejected_files = []

    for file in files:
        if not is_allowed_file(file.filename):
            rejected_files.append(file.filename)
            continue

        file_path = os.path.join(session_dir, file.filename)

        try:
            with open(file_path, "wb") as buffer:
                shutil.copyfileobj(file.file, buffer)

            saved_files.append(file.filename)

        except Exception as e:
            raise HTTPException(
                status_code=500,
                detail=f"Failed to save file {file.filename}: {str(e)}"
            )

    if not saved_files:
        raise HTTPException(
            status_code=400,
            detail="No valid PDF files were uploaded"
        )

    # Trigger ingestion in background
    try:
        background_tasks.add_task(ingest_directory, session_dir)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to start ingestion: {str(e)}"
        )

    return {
        "session_id": session_id,
        "status": "processing",
        "uploaded_files": saved_files,
        "rejected_files": rejected_files
    }

# ----------------------------
# ASSESSMENT ENDPOINTS
# ----------------------------

class AssessmentRequest(BaseModel):
    session_id: str
    level: int

class SubmitRequest(BaseModel):
    session_id: str
    level: int
    score: int
    max_score: int
    mistakes: List[dict] = []

@app.get("/api/classrooms")
async def get_classrooms():
    """List all available classrooms (uploaded sessions)."""
    if not os.path.exists(UPLOAD_ROOT):
        return {"classrooms": []}
    
    classrooms = []
    for name in os.listdir(UPLOAD_ROOT):
        path = os.path.join(UPLOAD_ROOT, name)
        if os.path.isdir(path):
            classrooms.append(name)
    return {"classrooms": classrooms}

@app.post("/api/assessment/generate")
async def generate_assessment_endpoint(request: AssessmentRequest):
    """Generate or retrieve an assessment for a specific level."""
    from assessment_service import generate_assessment
    result = generate_assessment(request.session_id, request.level)
    if "error" in result:
        raise HTTPException(status_code=500, detail=result["error"])
    return result

@app.post("/api/assessment/submit")
async def submit_assessment_endpoint(request: SubmitRequest):
    """Submit results and calculate XP/Unlocks."""
    from assessment_service import submit_assessment_result
    result = submit_assessment_result(
        request.session_id, 
        request.level, 
        request.score, 
        request.max_score,
        request.mistakes
    )
    return result

@app.get("/api/mistakes/{session_id}")
async def get_mistakes_endpoint(session_id: str):
    """Get list of mistakes for a student in a specific classroom."""
    from assessment_service import get_mistakes
    return get_mistakes(session_id)

class CommentRequest(BaseModel):
    session_id: str
    question: str
    comment: str

@app.post("/api/mistakes/comment")
async def add_mistake_comment(request: CommentRequest):
    """Add or update a comment on a specific mistake."""
    from assessment_service import update_mistake_comment
    success = update_mistake_comment(request.session_id, request.question, request.comment)
    if not success:
        raise HTTPException(status_code=404, detail="Mistake not found")
    return {"status": "success"}

@app.get("/api/progress/{session_id}")
async def get_progress_endpoint(session_id: str):
    """Get current XP and unlocked levels for a student in a specific classroom."""
    from assessment_service import get_progress
    return get_progress(session_id)

@app.get("/api/flashcards/{session_id}")
async def get_flashcards(session_id: str, language: str = "english"):
    """Get topic-wise revision flashcards with language support."""
    try:
        cards = flashcard_service.generate_flashcards(session_id, language)
        return cards
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class FlashcardUpdateRequest(BaseModel):
    session_id: str
    language: str
    index: int
    updated_card: Dict[str, str]

@app.post("/api/flashcards/update")
async def update_flashcard(request: FlashcardUpdateRequest):
    """Manually update a specific flashcard."""
    result = flashcard_service.update_flashcard_manual(
        request.session_id, 
        request.language, 
        request.index, 
        request.updated_card
    )
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result

class FlashcardAIEditRequest(BaseModel):
    session_id: str
    language: str
    index: int
    instruction: str

@app.post("/api/flashcards/ai-edit")
async def ai_edit_flashcard(request: FlashcardAIEditRequest):
    """Refine a specific flashcard using AI instructions."""
    result = flashcard_service.refine_flashcard_with_ai(
        request.session_id, 
        request.language, 
        request.index, 
        request.instruction
    )
    if "error" in result:
        raise HTTPException(status_code=500, detail=result["error"])
    return result

class XPRequest(BaseModel):
    session_id: str
    amount: int

@app.post("/api/add_xp")
async def add_xp(request: XPRequest):
    """Manually add XP to a student (e.g. for viewing flashcards)."""
    try:
        progress = assessment_service.load_user_progress()
        if request.session_id not in progress:
            # Initialize if not exists
            progress[request.session_id] = {
                "xp": 0,
                "mistakes": [],
                "history": [],
                "unlocked_level": 1
            }
        
        progress[request.session_id]["xp"] += request.amount
        assessment_service.save_user_progress(progress)
        
        return {
            "success": True,
            "new_total": progress[request.session_id]["xp"]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/spend_xp")
async def spend_xp_endpoint(request: XPRequest):
    """Spend XP for hints or other items."""
    from assessment_service import spend_xp
    success = spend_xp(request.session_id, request.amount)
    if not success:
         return {"success": False, "message": "Insufficient XP"}
    return {"success": True}

class RemedialRequest(BaseModel):
    session_id: str

@app.post("/api/remedial/complete")
async def remedial_complete_endpoint(request: RemedialRequest):
    """Clear cooldown and remedial plan after successful practice."""
    from assessment_service import clear_cooldown
    success = clear_cooldown(request.session_id)
    if not success:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"success": True}

@app.get("/api/teacher/analytics/{session_id}")
async def get_teacher_analytics_endpoint(session_id: str):
    """Get class-wide analytics for a specific classroom."""
    from assessment_service import get_teacher_analytics
    return get_teacher_analytics(session_id)

@app.get("/api/teacher/assessments/{session_id}")
async def get_teacher_assessments_endpoint(session_id: str):
    """Get all assessments organized by chapter and quest level for teacher preview."""
    from assessment_service import get_all_assessments_for_teacher
    return get_all_assessments_for_teacher(session_id)

# ----------------------------
# ROADMAP ENDPOINTS
# ----------------------------

class RoadmapGenerateRequest(BaseModel):
    prompt: str
    session_id: str

@app.post("/api/roadmap/generate")
async def generate_roadmap_endpoint(request: RoadmapGenerateRequest):
    """Generate a new learning roadmap."""
    result = roadmap_service.generate_roadmap(request.prompt, request.session_id)
    if "error" in result:
        raise HTTPException(status_code=500, detail=result["error"])
    return result

@app.get("/api/roadmaps/{session_id}")
async def list_roadmaps_endpoint(session_id: str):
    """List all roadmaps for a user/session."""
    return roadmap_service.list_roadmaps(session_id)

@app.get("/api/roadmap/{roadmap_id}")
async def get_roadmap_endpoint(roadmap_id: str):
    """Get full details of a specific roadmap."""
    roadmap = roadmap_service.get_roadmap(roadmap_id)
    if not roadmap:
        raise HTTPException(status_code=404, detail="Roadmap not found")
    return roadmap

class ProgressUpdateRequest(BaseModel):
    day_number: int

@app.post("/api/roadmap/{roadmap_id}/complete_day")
async def complete_day_endpoint(roadmap_id: str, request: ProgressUpdateRequest):
    """Mark a specific day in the roadmap as completed."""
    result = roadmap_service.update_progress(roadmap_id, request.day_number)
    if not result:
        raise HTTPException(status_code=404, detail="Roadmap not found")
    return result

class WeekGenerateRequest(BaseModel):
    week_number: int

@app.post("/api/roadmap/{roadmap_id}/generate_week")
async def generate_week_endpoint(roadmap_id: str, request: WeekGenerateRequest):
    """Generate deep content for a specific week in an existing roadmap."""
    result = roadmap_service.generate_week_content(roadmap_id, request.week_number)
    if "error" in result:
        raise HTTPException(status_code=500, detail=result["error"])
    return result

# ----------------------------
# TEACHER REVIEW ENDPOINT
# ----------------------------

@app.post("/teacher_review")
async def save_teacher_review(data: dict):
    """
    Endpoint for teachers to send feedback to the AI (Text-only fallback).
    """
    session_id = data.get("session_id")
    if not session_id:
        raise HTTPException(status_code=400, detail="session_id is required")
        
    session_dir = os.path.join(UPLOAD_ROOT, session_id)
    os.makedirs(session_dir, exist_ok=True)
    
    review_path = os.path.join(session_dir, "teacher_review.json")
    
    try:
        with open(review_path, "w") as f:
            json.dump(data, f, indent=4)
        return {"status": "success", "message": "Teacher review saved"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/upload_review")
async def upload_review(
    background_tasks: BackgroundTasks,
    session_id: str = Form(...),
    assessment_focus: str = Form(""),
    student_gaps: str = Form(""),
    file: UploadFile = File(None)
):
    """
    Endpoint for teachers to send feedback including documents.
    Triggers RAG ingestion in the background.
    """
    session_dir = os.path.join(UPLOAD_ROOT, session_id)
    os.makedirs(session_dir, exist_ok=True)
    
    review_data = {
        "session_id": session_id,
        "assessment_focus": assessment_focus,
        "student_gaps": student_gaps,
        "has_document": False
    }

    if file:
        file_path = os.path.join(session_dir, "teacher_review_document.pdf")
        try:
            with open(file_path, "wb") as buffer:
                shutil.copyfileobj(file.file, buffer)
            
            review_data["has_document"] = True
            review_data["document_path"] = file_path
            
            # Trigger ingestion for RAG
            background_tasks.add_task(ingest_directory, session_dir)
            
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to save review document: {str(e)}")

    review_path = os.path.join(session_dir, "teacher_review.json")
    try:
        with open(review_path, "w") as f:
            json.dump(review_data, f, indent=4)
        return {"status": "success", "message": "Teacher review saved and processing started"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
