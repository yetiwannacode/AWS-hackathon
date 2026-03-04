from fastapi import FastAPI, UploadFile, File, BackgroundTasks, HTTPException, Form, Header, Query
from typing import List
import os
import shutil
import uuid
import json # Added json import as it's used later in the code
import hashlib
import secrets
import sqlite3
from datetime import datetime
from urllib.parse import quote, unquote
from glob import glob

try:
    import boto3
except Exception:
    boto3 = None

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

# ----------------------------
# CONFIG
# ----------------------------
UPLOAD_ROOT = "uploads"
DATA_ROOT = "data"
ALLOWED_EXTENSIONS = {".pdf"}
USERS_FILE = os.path.join(DATA_ROOT, "users.json")
SESSIONS_FILE = os.path.join(DATA_ROOT, "auth_sessions.json")
APP_DB_FILE = os.path.join(DATA_ROOT, "app.db")
AWS_REGION = os.getenv("AWS_REGION", os.getenv("AWS_DEFAULT_REGION", "ap-southeast-2"))
S3_BUCKET_NAME = os.getenv("S3_BUCKET_NAME", "").strip()
CORS_ORIGINS_RAW = os.getenv("CORS_ORIGINS", "*").strip()
CORS_ORIGINS = [o.strip() for o in CORS_ORIGINS_RAW.split(",") if o.strip()] if CORS_ORIGINS_RAW != "*" else ["*"]

os.makedirs(UPLOAD_ROOT, exist_ok=True)
os.makedirs(DATA_ROOT, exist_ok=True)

app.mount("/uploads", StaticFiles(directory=UPLOAD_ROOT), name="uploads")

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ----------------------------
# HELPERS
# ----------------------------
def is_allowed_file(filename: str) -> bool:
    return any(filename.lower().endswith(ext) for ext in ALLOWED_EXTENSIONS)


def _load_json_file(path: str) -> Dict[str, Any]:
    if not os.path.exists(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _save_json_file(path: str, data: Dict[str, Any]):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def _normalize_name(name: str) -> str:
    return " ".join(name.strip().lower().split())


def _hash_password(password: str, salt: str) -> str:
    return hashlib.sha256(f"{salt}:{password}".encode("utf-8")).hexdigest()


def _get_bearer_token(authorization: Optional[str]) -> Optional[str]:
    if not authorization or not authorization.startswith("Bearer "):
        return None
    token = authorization.replace("Bearer ", "", 1).strip()
    return token or None


def _find_user_by_username(users: Dict[str, Any], username: str) -> Optional[Dict[str, Any]]:
    target = username.strip().lower()
    direct = users.get(target)
    if isinstance(direct, dict):
        return direct
    for _, user in users.items():
        if str(user.get("username", "")).strip().lower() == target:
            return user
    return None


def _resolve_user_display_name(users: Dict[str, Any], user_key: str) -> str:
    user = users.get(user_key, {})
    if isinstance(user, dict):
        name = str(user.get("name", "")).strip()
        if name:
            return name
        username = str(user.get("username", "")).strip()
        if username:
            return username
    return user_key


def _get_s3_client():
    if not S3_BUCKET_NAME or boto3 is None:
        return None
    try:
        return boto3.client("s3", region_name=AWS_REGION)
    except Exception as e:
        print(f"S3 client init failed: {e}")
        return None


def _get_db_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(APP_DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn


def _init_app_db():
    conn = _get_db_connection()
    try:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS classrooms (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                description TEXT NOT NULL,
                track TEXT NOT NULL,
                teacher_user_key TEXT NOT NULL,
                enrollment_code TEXT NOT NULL UNIQUE,
                created_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS classroom_enrollments (
                classroom_id TEXT NOT NULL,
                student_user_key TEXT NOT NULL,
                joined_at TEXT NOT NULL,
                PRIMARY KEY (classroom_id, student_user_key),
                FOREIGN KEY (classroom_id) REFERENCES classrooms(id)
            )
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_classrooms_teacher ON classrooms(teacher_user_key)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_enrollments_student ON classroom_enrollments(student_user_key)"
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS classroom_materials (
                id TEXT PRIMARY KEY,
                classroom_id TEXT NOT NULL,
                filename TEXT NOT NULL,
                file_path TEXT NOT NULL,
                url_path TEXT NOT NULL,
                created_at TEXT NOT NULL,
                uploaded_by TEXT,
                s3_object_key TEXT,
                UNIQUE (classroom_id, filename),
                FOREIGN KEY (classroom_id) REFERENCES classrooms(id)
            )
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_materials_classroom ON classroom_materials(classroom_id)"
        )
        conn.commit()
    finally:
        conn.close()


def _generate_enrollment_code(conn: sqlite3.Connection) -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    while True:
        code = "".join(secrets.choice(alphabet) for _ in range(5))
        exists = conn.execute(
            "SELECT 1 FROM classrooms WHERE enrollment_code = ?",
            (code,)
        ).fetchone()
        if not exists:
            return code


def _upsert_material_record(
    conn: sqlite3.Connection,
    classroom_id: str,
    filename: str,
    uploaded_by: str = "",
    s3_object_key: str = ""
) -> Dict[str, Any]:
    file_path = os.path.join(UPLOAD_ROOT, classroom_id, filename)
    if not os.path.isfile(file_path):
        raise FileNotFoundError(f"Material not found on disk: {file_path}")

    created_at = datetime.utcfromtimestamp(os.path.getmtime(file_path)).isoformat() + "Z"
    url_path = f"/uploads/{classroom_id}/{quote(filename)}"

    existing = conn.execute(
        """
        SELECT id FROM classroom_materials
        WHERE classroom_id = ? AND filename = ?
        """,
        (classroom_id, filename)
    ).fetchone()
    material_id = existing["id"] if existing else uuid.uuid4().hex[:12]

    conn.execute(
        """
        INSERT INTO classroom_materials(id, classroom_id, filename, file_path, url_path, created_at, uploaded_by, s3_object_key)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(classroom_id, filename)
        DO UPDATE SET
            file_path = excluded.file_path,
            url_path = excluded.url_path,
            created_at = excluded.created_at,
            uploaded_by = excluded.uploaded_by,
            s3_object_key = CASE
                WHEN excluded.s3_object_key != '' THEN excluded.s3_object_key
                ELSE classroom_materials.s3_object_key
            END
        """,
        (material_id, classroom_id, filename, file_path, url_path, created_at, uploaded_by, s3_object_key)
    )
    return {
        "id": material_id,
        "filename": filename,
        "url_path": url_path,
        "created_at": created_at
    }


def _sync_material_records_for_classroom(conn: sqlite3.Connection, classroom_id: str):
    session_dir = os.path.join(UPLOAD_ROOT, classroom_id)
    if not os.path.isdir(session_dir):
        return

    for filename in os.listdir(session_dir):
        if not is_allowed_file(filename):
            continue
        file_path = os.path.join(session_dir, filename)
        if not os.path.isfile(file_path):
            continue
        try:
            _upsert_material_record(conn, classroom_id, filename)
        except Exception as e:
            print(f"Material sync failed ({classroom_id}/{filename}): {e}")


def _list_session_materials(session_id: str, conn: sqlite3.Connection) -> List[Dict[str, Any]]:
    _sync_material_records_for_classroom(conn, session_id)
    rows = conn.execute(
        """
        SELECT id, filename, url_path, created_at
        FROM classroom_materials
        WHERE classroom_id = ?
        ORDER BY created_at DESC
        """,
        (session_id,)
    ).fetchall()
    return [
        {
            "id": row["id"],
            "title": row["filename"],
            "url": row["url_path"],
            "type": "pdf",
            "date": row["created_at"],
            "description": f"Posted new material: {row['filename']}"
        }
        for row in rows
    ]


def _remove_material_from_vector_store(session_id: str, filename: str):
    try:
        from langchain_chroma import Chroma
        from ingestion_pipeline import LOCAL_EMBEDDINGS, CHROMA_PATH
        db = Chroma(
            persist_directory=CHROMA_PATH,
            embedding_function=LOCAL_EMBEDDINGS,
            collection_name="hackathon_collection"
        )
        db.delete(where={"$and": [{"session_id": session_id}, {"source": filename}]})
    except Exception as e:
        print(f"Vector cleanup skipped ({session_id}/{filename}): {e}")


def _invalidate_classroom_caches(session_id: str):
    session_dir = os.path.join(UPLOAD_ROOT, session_id)
    for flashcard_file in glob(os.path.join(session_dir, "flashcards_v*.json")):
        try:
            os.remove(flashcard_file)
        except Exception as e:
            print(f"Flashcard cache cleanup failed ({flashcard_file}): {e}")

    assessments_dir = os.path.join(DATA_ROOT, "assessments")
    for assessment_file in glob(os.path.join(assessments_dir, f"{session_id}_*.json")):
        try:
            os.remove(assessment_file)
        except Exception as e:
            print(f"Assessment cache cleanup failed ({assessment_file}): {e}")


def _format_classroom_row(row: sqlite3.Row, conn: Optional[sqlite3.Connection] = None) -> Dict[str, Any]:
    own_conn = None
    if conn is None:
        own_conn = _get_db_connection()
        conn = own_conn
    payload = {
        "id": row["id"],
        "title": row["title"],
        "description": row["description"],
        "enrollmentCode": row["enrollment_code"],
        "teacherId": row["teacher_user_key"],
        "track": row["track"],
        "materials": _list_session_materials(row["id"], conn)
    }
    if "joined_students" in row.keys():
        payload["joinedStudentCount"] = row["joined_students"]
    if own_conn is not None:
        own_conn.close()
    return payload


def _get_current_user_from_token(authorization: Optional[str]) -> Dict[str, Any]:
    token = _get_bearer_token(authorization)
    if not token:
        raise HTTPException(status_code=401, detail="Missing auth token.")

    sessions = _load_json_file(SESSIONS_FILE)
    session = sessions.get(token)
    if not session:
        raise HTTPException(status_code=401, detail="Invalid or expired session.")

    users = _load_json_file(USERS_FILE)
    user_key = (session.get("user_key") or "").strip().lower()
    user = users.get(user_key) if user_key else None
    if not user and session.get("email"):
        user = users.get(str(session.get("email")))
    if not user:
        raise HTTPException(status_code=401, detail="User not found.")

    return {"user_key": user_key, "user": user}


def _try_get_current_user_from_token(authorization: Optional[str]) -> Optional[Dict[str, Any]]:
    try:
        return _get_current_user_from_token(authorization)
    except HTTPException:
        return None


def _classroom_exists(classroom_id: str) -> bool:
    conn = _get_db_connection()
    try:
        row = conn.execute("SELECT 1 FROM classrooms WHERE id = ?", (classroom_id,)).fetchone()
        return bool(row)
    finally:
        conn.close()


def _resolve_progress_session_id(raw_session_id: str, authorization: Optional[str]) -> str:
    """
    Student progress is scoped per classroom+student when authenticated.
    Legacy or unauthenticated requests continue using raw session_id.
    """
    auth = _try_get_current_user_from_token(authorization)
    if not auth:
        return raw_session_id
    if auth["user"].get("role") != "student":
        return raw_session_id
    if not _classroom_exists(raw_session_id):
        return raw_session_id
    return f"{raw_session_id}::{auth['user_key']}"


def _upload_file_to_s3(local_path: str, object_key: str, content_type: str = "application/pdf") -> Optional[str]:
    s3_client = _get_s3_client()
    if s3_client is None:
        return None

    try:
        with open(local_path, "rb") as f:
            s3_client.upload_fileobj(
                f,
                S3_BUCKET_NAME,
                object_key,
                ExtraArgs={"ContentType": content_type}
            )
        return object_key
    except Exception as e:
        print(f"S3 upload failed ({object_key}): {e}")
        return None


_init_app_db()

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
# AUTH ENDPOINTS
# ----------------------------

class SignupRequest(BaseModel):
    name: str
    username: str
    password: str
    role: str = "student"
    track: str = "institution"


class LoginRequest(BaseModel):
    username: str
    password: str


class CreateClassroomRequest(BaseModel):
    name: str
    batch: str = ""
    grade: str = ""


class JoinClassroomRequest(BaseModel):
    code: str


@app.post("/api/auth/signup")
async def auth_signup(request: SignupRequest):
    name = request.name.strip()
    username = request.username.strip()
    username_key = username.lower()
    role = request.role if request.role in ("teacher", "student") else "student"
    track = request.track if request.track in ("institution", "individual") else "institution"

    if len(name) < 2:
        raise HTTPException(status_code=400, detail="Name must be at least 2 characters.")
    if len(username) < 3:
        raise HTTPException(status_code=400, detail="Username must be at least 3 characters.")
    if _normalize_name(name) != _normalize_name(username):
        raise HTTPException(status_code=400, detail="Username must match your name.")
    if len(request.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters.")

    users = _load_json_file(USERS_FILE)
    existing_user = _find_user_by_username(users, username_key)
    if existing_user:
        raise HTTPException(status_code=409, detail="Username already exists. Please login.")

    salt = secrets.token_hex(16)
    users[username_key] = {
        "name": name,
        "username": username,
        "email": "",
        "role": role,
        "track": track,
        "salt": salt,
        "password_hash": _hash_password(request.password, salt)
    }
    _save_json_file(USERS_FILE, users)

    token = secrets.token_urlsafe(32)
    sessions = _load_json_file(SESSIONS_FILE)
    sessions[token] = {"user_key": username_key}
    _save_json_file(SESSIONS_FILE, sessions)

    return {
        "token": token,
        "user": {
            "name": name,
            "email": "",
            "role": role,
            "track": track
        }
    }


@app.post("/api/auth/login")
async def auth_login(request: LoginRequest):
    username_key = request.username.strip().lower()
    users = _load_json_file(USERS_FILE)
    user = _find_user_by_username(users, username_key)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid username or password.")

    expected = user.get("password_hash")
    actual = _hash_password(request.password, user.get("salt", ""))
    if expected != actual:
        raise HTTPException(status_code=401, detail="Invalid username or password.")

    token = secrets.token_urlsafe(32)
    sessions = _load_json_file(SESSIONS_FILE)
    sessions[token] = {"user_key": user.get("username", "").strip().lower() or username_key}
    _save_json_file(SESSIONS_FILE, sessions)

    return {
        "token": token,
        "user": {
            "name": user.get("name", ""),
            "email": user.get("email", ""),
            "role": user.get("role", "student"),
            "track": user.get("track", "institution")
        }
    }


@app.get("/api/auth/me")
async def auth_me(authorization: Optional[str] = Header(default=None)):
    token = _get_bearer_token(authorization)
    if not token:
        raise HTTPException(status_code=401, detail="Missing auth token.")

    sessions = _load_json_file(SESSIONS_FILE)
    session = sessions.get(token)
    if not session:
        raise HTTPException(status_code=401, detail="Invalid or expired session.")

    users = _load_json_file(USERS_FILE)
    user_key = (session.get("user_key") or "").strip().lower()
    user = users.get(user_key) if user_key else None
    if not user and session.get("email"):
        # Backward compatibility with older session entries
        user = users.get(str(session.get("email")))
    if not user:
        raise HTTPException(status_code=401, detail="User not found.")

    return {
        "user": {
            "name": user.get("name", ""),
            "email": user.get("email", ""),
            "role": user.get("role", "student"),
            "track": user.get("track", "institution")
        }
    }


@app.post("/api/auth/logout")
async def auth_logout(authorization: Optional[str] = Header(default=None)):
    token = _get_bearer_token(authorization)
    if not token:
        return {"success": True}

    sessions = _load_json_file(SESSIONS_FILE)
    if token in sessions:
        del sessions[token]
        _save_json_file(SESSIONS_FILE, sessions)
    return {"success": True}

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
    background_tasks: BackgroundTasks = BackgroundTasks(),
    authorization: Optional[str] = Header(default=None)
):
    if not files:
        raise HTTPException(status_code=400, detail="No files uploaded")

    # Use provided session_id or 'default'
    session_dir = os.path.join(UPLOAD_ROOT, session_id)

    os.makedirs(session_dir, exist_ok=True)

    saved_files = []
    rejected_files = []
    s3_uploaded_keys = []
    uploader_auth = _try_get_current_user_from_token(authorization)
    uploader_key = uploader_auth["user_key"] if uploader_auth else ""
    conn = _get_db_connection()

    try:
        for file in files:
            if not is_allowed_file(file.filename):
                rejected_files.append(file.filename)
                continue

            file_path = os.path.join(session_dir, file.filename)

            try:
                with open(file_path, "wb") as buffer:
                    shutil.copyfileobj(file.file, buffer)

                _remove_material_from_vector_store(session_id, file.filename)
                saved_files.append(file.filename)
                s3_key = _upload_file_to_s3(
                    local_path=file_path,
                    object_key=f"sessions/{session_id}/{datetime.utcnow().strftime('%Y%m%dT%H%M%S')}_{file.filename}",
                    content_type=file.content_type or "application/pdf"
                )
                if s3_key:
                    s3_uploaded_keys.append(s3_key)
                _upsert_material_record(conn, session_id, file.filename, uploaded_by=uploader_key, s3_object_key=s3_key or "")

            except Exception as e:
                raise HTTPException(
                    status_code=500,
                    detail=f"Failed to save file {file.filename}: {str(e)}"
                )
        conn.commit()
    finally:
        conn.close()

    if not saved_files:
        raise HTTPException(
            status_code=400,
            detail="No valid PDF files were uploaded"
        )

    _invalidate_classroom_caches(session_id)

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
        "rejected_files": rejected_files,
        "s3_uploaded_keys": s3_uploaded_keys
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

@app.get("/api/classrooms/mine")
async def get_my_classrooms(authorization: Optional[str] = Header(default=None)):
    auth = _get_current_user_from_token(authorization)
    user_key = auth["user_key"]
    user = auth["user"]
    role = user.get("role", "student")
    track = user.get("track", "institution")

    conn = _get_db_connection()
    try:
        if role == "teacher":
            rows = conn.execute(
                """
                SELECT c.id, c.title, c.description, c.enrollment_code, c.teacher_user_key, c.track,
                       COUNT(ce.student_user_key) AS joined_students
                FROM classrooms c
                LEFT JOIN classroom_enrollments ce ON ce.classroom_id = c.id
                WHERE c.teacher_user_key = ?
                GROUP BY c.id, c.title, c.description, c.enrollment_code, c.teacher_user_key, c.track, c.created_at
                ORDER BY c.created_at DESC
                """,
                (user_key,)
            ).fetchall()
        elif track == "individual":
            rows = []
        else:
            rows = conn.execute(
                """
                SELECT c.id, c.title, c.description, c.enrollment_code, c.teacher_user_key, c.track
                FROM classrooms c
                INNER JOIN classroom_enrollments ce ON ce.classroom_id = c.id
                WHERE ce.student_user_key = ?
                ORDER BY c.created_at DESC
                """,
                (user_key,)
            ).fetchall()

        return {"classrooms": [_format_classroom_row(row, conn) for row in rows]}
    finally:
        conn.close()


@app.post("/api/classrooms")
async def create_classroom(request: CreateClassroomRequest, authorization: Optional[str] = Header(default=None)):
    auth = _get_current_user_from_token(authorization)
    user_key = auth["user_key"]
    user = auth["user"]

    if user.get("role") != "teacher":
        raise HTTPException(status_code=403, detail="Only teachers can create classrooms.")
    if user.get("track", "institution") != "institution":
        raise HTTPException(status_code=400, detail="Classrooms are only available in institution track.")

    title = request.name.strip()
    if len(title) < 2:
        raise HTTPException(status_code=400, detail="Classroom name must be at least 2 characters.")

    grade = request.grade.strip()
    batch = request.batch.strip()
    if grade and batch:
        description = f"{grade} - {batch}"
    else:
        description = grade or batch or "Institution Classroom"

    conn = _get_db_connection()
    try:
        classroom_id = uuid.uuid4().hex[:8]
        enrollment_code = _generate_enrollment_code(conn)
        created_at = datetime.utcnow().isoformat()
        conn.execute(
            """
            INSERT INTO classrooms(id, title, description, track, teacher_user_key, enrollment_code, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (classroom_id, title, description, "institution", user_key, enrollment_code, created_at)
        )
        conn.commit()

        row = conn.execute(
            """
            SELECT id, title, description, enrollment_code, teacher_user_key, track
            FROM classrooms
            WHERE id = ?
            """,
            (classroom_id,)
        ).fetchone()
        return {"classroom": _format_classroom_row(row, conn)}
    finally:
        conn.close()


@app.post("/api/classrooms/join")
async def join_classroom(request: JoinClassroomRequest, authorization: Optional[str] = Header(default=None)):
    auth = _get_current_user_from_token(authorization)
    user_key = auth["user_key"]
    user = auth["user"]

    if user.get("role", "student") != "student":
        raise HTTPException(status_code=403, detail="Only students can join classrooms.")
    if user.get("track", "institution") != "institution":
        raise HTTPException(status_code=400, detail="Join classroom is only available in institution track.")

    code = request.code.strip().upper()
    if len(code) != 5:
        raise HTTPException(status_code=400, detail="Enrollment code must be 5 characters.")

    conn = _get_db_connection()
    try:
        classroom = conn.execute(
            """
            SELECT id, title, description, enrollment_code, teacher_user_key, track
            FROM classrooms
            WHERE enrollment_code = ?
            """,
            (code,)
        ).fetchone()
        if not classroom:
            raise HTTPException(status_code=404, detail="Invalid enrollment code.")

        conn.execute(
            """
            INSERT OR IGNORE INTO classroom_enrollments(classroom_id, student_user_key, joined_at)
            VALUES (?, ?, ?)
            """,
            (classroom["id"], user_key, datetime.utcnow().isoformat())
        )
        conn.commit()

        return {"classroom": _format_classroom_row(classroom, conn)}
    finally:
        conn.close()


@app.delete("/api/classrooms/{classroom_id}/materials/{material_id}")
async def delete_classroom_material(
    classroom_id: str,
    material_id: str,
    filename: Optional[str] = Query(default=None),
    authorization: Optional[str] = Header(default=None)
):
    auth = _get_current_user_from_token(authorization)
    if auth["user"].get("role") != "teacher":
        raise HTTPException(status_code=403, detail="Only teachers can delete materials.")

    conn = _get_db_connection()
    try:
        owned = conn.execute(
            "SELECT id FROM classrooms WHERE id = ? AND teacher_user_key = ?",
            (classroom_id, auth["user_key"])
        ).fetchone()
        if not owned:
            raise HTTPException(status_code=404, detail="Classroom not found or not owned by teacher.")

        # Ensure DB rows exist for legacy files present on disk.
        _sync_material_records_for_classroom(conn, classroom_id)

        material = conn.execute(
            """
            SELECT id, filename, file_path, s3_object_key
            FROM classroom_materials
            WHERE id = ? AND classroom_id = ?
            """,
            (material_id, classroom_id)
        ).fetchone()
        if not material:
            if filename:
                normalized_filename = os.path.basename(unquote(filename)).strip()
                material = conn.execute(
                    """
                    SELECT id, filename, file_path, s3_object_key
                    FROM classroom_materials
                    WHERE classroom_id = ? AND filename = ?
                    """,
                    (classroom_id, normalized_filename)
                ).fetchone()
                if not material:
                    material = conn.execute(
                        """
                        SELECT id, filename, file_path, s3_object_key
                        FROM classroom_materials
                        WHERE classroom_id = ? AND lower(filename) = lower(?)
                        """,
                        (classroom_id, normalized_filename)
                    ).fetchone()
            if not material:
                raise HTTPException(status_code=404, detail="Material not found.")

        if material["file_path"] and os.path.exists(material["file_path"]):
            try:
                os.remove(material["file_path"])
            except Exception as e:
                print(f"Failed to delete local material file: {e}")

        if material["s3_object_key"]:
            try:
                s3_client = _get_s3_client()
                if s3_client is not None:
                    s3_client.delete_object(Bucket=S3_BUCKET_NAME, Key=material["s3_object_key"])
            except Exception as e:
                print(f"Failed to delete S3 object ({material['s3_object_key']}): {e}")

        conn.execute(
            "DELETE FROM classroom_materials WHERE id = ? AND classroom_id = ?",
            (material["id"], classroom_id)
        )
        conn.commit()
    finally:
        conn.close()

    _remove_material_from_vector_store(classroom_id, material["filename"])
    _invalidate_classroom_caches(classroom_id)
    return {"success": True, "deleted_material_id": material["id"]}


@app.get("/api/classrooms/{classroom_id}/people")
async def get_classroom_people(
    classroom_id: str,
    authorization: Optional[str] = Header(default=None)
):
    auth = _get_current_user_from_token(authorization)
    user_key = auth["user_key"]
    role = auth["user"].get("role", "student")

    conn = _get_db_connection()
    try:
        classroom = conn.execute(
            """
            SELECT id, teacher_user_key
            FROM classrooms
            WHERE id = ?
            """,
            (classroom_id,)
        ).fetchone()
        if not classroom:
            raise HTTPException(status_code=404, detail="Classroom not found.")

        if role == "teacher":
            if classroom["teacher_user_key"] != user_key:
                raise HTTPException(status_code=403, detail="Not allowed to view this classroom.")
        else:
            enrolled = conn.execute(
                """
                SELECT 1
                FROM classroom_enrollments
                WHERE classroom_id = ? AND student_user_key = ?
                """,
                (classroom_id, user_key)
            ).fetchone()
            if not enrolled:
                raise HTTPException(status_code=403, detail="Not enrolled in this classroom.")

        student_rows = conn.execute(
            """
            SELECT student_user_key
            FROM classroom_enrollments
            WHERE classroom_id = ?
            """,
            (classroom_id,)
        ).fetchall()
    finally:
        conn.close()

    users = _load_json_file(USERS_FILE)
    progress = assessment_service.load_user_progress()
    students = []
    for row in student_rows:
        sid = row["student_user_key"]
        scoped_key = f"{classroom_id}::{sid}"
        student_progress = progress.get(scoped_key, {})
        students.append({
            "id": sid,
            "name": _resolve_user_display_name(users, sid),
            "xp": int(student_progress.get("xp", 0) or 0)
        })

    students.sort(key=lambda s: s["xp"], reverse=True)
    teacher_key = classroom["teacher_user_key"]
    return {
        "teacher": {
            "id": teacher_key,
            "name": _resolve_user_display_name(users, teacher_key)
        },
        "students": students
    }


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
async def generate_assessment_endpoint(request: AssessmentRequest, authorization: Optional[str] = Header(default=None)):
    """Generate or retrieve an assessment for a specific level."""
    from assessment_service import generate_assessment
    resolved_session_id = _resolve_progress_session_id(request.session_id, authorization)
    progress = assessment_service.load_user_progress().get(resolved_session_id, {})
    chapter_index = int(progress.get("current_chapter_index", 0) or 0)
    result = generate_assessment(request.session_id, request.level, chapter_index=chapter_index)
    if "error" in result:
        raise HTTPException(status_code=500, detail=result["error"])
    return result

@app.post("/api/assessment/submit")
async def submit_assessment_endpoint(request: SubmitRequest, authorization: Optional[str] = Header(default=None)):
    """Submit results and calculate XP/Unlocks."""
    from assessment_service import submit_assessment_result
    resolved_session_id = _resolve_progress_session_id(request.session_id, authorization)
    result = submit_assessment_result(
        resolved_session_id,
        request.level, 
        request.score, 
        request.max_score,
        request.mistakes
    )
    return result

@app.get("/api/mistakes/{session_id}")
async def get_mistakes_endpoint(session_id: str, authorization: Optional[str] = Header(default=None)):
    """Get list of mistakes for a student in a specific classroom."""
    from assessment_service import get_mistakes
    if session_id == "all":
        return get_mistakes(session_id)
    return get_mistakes(_resolve_progress_session_id(session_id, authorization))

class CommentRequest(BaseModel):
    session_id: str
    question: str
    comment: str

@app.post("/api/mistakes/comment")
async def add_mistake_comment(request: CommentRequest, authorization: Optional[str] = Header(default=None)):
    """Add or update a comment on a specific mistake."""
    from assessment_service import update_mistake_comment
    resolved_session_id = _resolve_progress_session_id(request.session_id, authorization)
    success = update_mistake_comment(resolved_session_id, request.question, request.comment)
    if not success:
        raise HTTPException(status_code=404, detail="Mistake not found")
    return {"status": "success"}

@app.get("/api/progress/{session_id}")
async def get_progress_endpoint(session_id: str, authorization: Optional[str] = Header(default=None)):
    """Get current XP and unlocked levels for a student in a specific classroom."""
    from assessment_service import get_progress
    return get_progress(_resolve_progress_session_id(session_id, authorization))

@app.get("/api/flashcards/{session_id}")
async def get_flashcards(session_id: str, language: str = "english", source: Optional[str] = None):
    """Get topic-wise revision flashcards with language support."""
    try:
        cards = flashcard_service.generate_flashcards(session_id, language, source)
        return cards
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class FlashcardUpdateRequest(BaseModel):
    session_id: str
    language: str
    index: int
    updated_card: Dict[str, str]
    source: Optional[str] = None

@app.post("/api/flashcards/update")
async def update_flashcard(request: FlashcardUpdateRequest):
    """Manually update a specific flashcard."""
    result = flashcard_service.update_flashcard_manual(
        request.session_id, 
        request.language, 
        request.index, 
        request.updated_card,
        request.source
    )
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result

class FlashcardAIEditRequest(BaseModel):
    session_id: str
    language: str
    index: int
    instruction: str
    source: Optional[str] = None

@app.post("/api/flashcards/ai-edit")
async def ai_edit_flashcard(request: FlashcardAIEditRequest):
    """Refine a specific flashcard using AI instructions."""
    result = flashcard_service.refine_flashcard_with_ai(
        request.session_id, 
        request.language, 
        request.index, 
        request.instruction,
        request.source
    )
    if "error" in result:
        raise HTTPException(status_code=500, detail=result["error"])
    return result

class XPRequest(BaseModel):
    session_id: str
    amount: int

@app.post("/api/add_xp")
async def add_xp(request: XPRequest, authorization: Optional[str] = Header(default=None)):
    """Manually add XP to a student (e.g. for viewing flashcards)."""
    try:
        resolved_session_id = _resolve_progress_session_id(request.session_id, authorization)
        progress = assessment_service.load_user_progress()
        if resolved_session_id not in progress:
            # Initialize if not exists
            progress[resolved_session_id] = {
                "xp": 0,
                "mistakes": [],
                "history": [],
                "unlocked_level": 1
            }
        
        progress[resolved_session_id]["xp"] += request.amount
        assessment_service.save_user_progress(progress)
        
        return {
            "success": True,
            "new_total": progress[resolved_session_id]["xp"]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/spend_xp")
async def spend_xp_endpoint(request: XPRequest, authorization: Optional[str] = Header(default=None)):
    """Spend XP for hints or other items."""
    from assessment_service import spend_xp
    resolved_session_id = _resolve_progress_session_id(request.session_id, authorization)
    success = spend_xp(resolved_session_id, request.amount)
    if not success:
         return {"success": False, "message": "Insufficient XP"}
    return {"success": True}

class RemedialRequest(BaseModel):
    session_id: str

@app.post("/api/remedial/complete")
async def remedial_complete_endpoint(request: RemedialRequest, authorization: Optional[str] = Header(default=None)):
    """Clear cooldown and remedial plan after successful practice."""
    from assessment_service import clear_cooldown
    resolved_session_id = _resolve_progress_session_id(request.session_id, authorization)
    success = clear_cooldown(resolved_session_id)
    if not success:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"success": True}

@app.get("/api/teacher/analytics/{session_id}")
async def get_teacher_analytics_endpoint(session_id: str, authorization: Optional[str] = Header(default=None)):
    """Get class-wide analytics for a specific classroom."""
    auth = _get_current_user_from_token(authorization)
    if auth["user"].get("role") != "teacher":
        raise HTTPException(status_code=403, detail="Only teachers can view classroom analytics.")

    conn = _get_db_connection()
    try:
        classroom = conn.execute(
            "SELECT id FROM classrooms WHERE id = ? AND teacher_user_key = ?",
            (session_id, auth["user_key"])
        ).fetchone()
        if not classroom:
            raise HTTPException(status_code=404, detail="Classroom not found or not owned by teacher.")

        rows = conn.execute(
            "SELECT student_user_key FROM classroom_enrollments WHERE classroom_id = ?",
            (session_id,)
        ).fetchall()
        enrolled_student_ids = [row["student_user_key"] for row in rows]
    finally:
        conn.close()

    from assessment_service import get_teacher_analytics
    return get_teacher_analytics(session_id, enrolled_student_ids)

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
async def generate_roadmap_endpoint(request: RoadmapGenerateRequest, authorization: Optional[str] = Header(default=None)):
    """Generate a new learning roadmap."""
    auth = _try_get_current_user_from_token(authorization)
    effective_session_id = request.session_id
    if auth and auth["user"].get("track") == "individual":
        effective_session_id = auth["user_key"]
    result = roadmap_service.generate_roadmap(request.prompt, effective_session_id)
    if "error" in result:
        raise HTTPException(status_code=500, detail=result["error"])
    return result

@app.get("/api/roadmaps/{session_id}")
async def list_roadmaps_endpoint(session_id: str, authorization: Optional[str] = Header(default=None)):
    """List all roadmaps for a user/session."""
    auth = _try_get_current_user_from_token(authorization)
    effective_session_id = session_id
    if auth and auth["user"].get("track") == "individual":
        effective_session_id = auth["user_key"]
    return roadmap_service.list_roadmaps(effective_session_id)

@app.get("/api/roadmap/{roadmap_id}")
async def get_roadmap_endpoint(roadmap_id: str, authorization: Optional[str] = Header(default=None)):
    """Get full details of a specific roadmap."""
    roadmap = roadmap_service.get_roadmap(roadmap_id)
    if not roadmap:
        raise HTTPException(status_code=404, detail="Roadmap not found")
    auth = _try_get_current_user_from_token(authorization)
    if auth and auth["user"].get("track") == "individual":
        if not roadmap_service.roadmap_belongs_to_user(roadmap, auth["user_key"]):
            raise HTTPException(status_code=403, detail="Not allowed to access this roadmap.")
    return roadmap

class ProgressUpdateRequest(BaseModel):
    day_number: int

@app.post("/api/roadmap/{roadmap_id}/complete_day")
async def complete_day_endpoint(roadmap_id: str, request: ProgressUpdateRequest, authorization: Optional[str] = Header(default=None)):
    """Mark a specific day in the roadmap as completed."""
    roadmap = roadmap_service.get_roadmap(roadmap_id)
    if not roadmap:
        raise HTTPException(status_code=404, detail="Roadmap not found")
    auth = _try_get_current_user_from_token(authorization)
    if auth and auth["user"].get("track") == "individual":
        if not roadmap_service.roadmap_belongs_to_user(roadmap, auth["user_key"]):
            raise HTTPException(status_code=403, detail="Not allowed to update this roadmap.")
    result = roadmap_service.update_progress(roadmap_id, request.day_number)
    if not result:
        raise HTTPException(status_code=404, detail="Roadmap not found")
    return result

class WeekGenerateRequest(BaseModel):
    week_number: int

@app.post("/api/roadmap/{roadmap_id}/generate_week")
async def generate_week_endpoint(roadmap_id: str, request: WeekGenerateRequest, authorization: Optional[str] = Header(default=None)):
    """Generate deep content for a specific week in an existing roadmap."""
    roadmap = roadmap_service.get_roadmap(roadmap_id)
    if not roadmap:
        raise HTTPException(status_code=404, detail="Roadmap not found")
    auth = _try_get_current_user_from_token(authorization)
    if auth and auth["user"].get("track") == "individual":
        if not roadmap_service.roadmap_belongs_to_user(roadmap, auth["user_key"]):
            raise HTTPException(status_code=403, detail="Not allowed to update this roadmap.")
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
            s3_key = _upload_file_to_s3(
                local_path=file_path,
                object_key=f"sessions/{session_id}/teacher_review_document_{datetime.utcnow().strftime('%Y%m%dT%H%M%S')}.pdf",
                content_type=file.content_type or "application/pdf"
            )
            if s3_key:
                review_data["s3_document_key"] = s3_key
            
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
