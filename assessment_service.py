import os
import json
import random
import time
import hashlib
from collections import Counter
from typing import List, Dict, Optional
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import HumanMessage, SystemMessage
from dotenv import load_dotenv
from unstructured.partition.pdf import partition_pdf

load_dotenv(override=True)

# CONFIG
UPLOAD_ROOT = "uploads"
DATA_ROOT = "data"
ASSESSMENT_DIR = os.path.join(DATA_ROOT, "assessments")
PROGRESS_FILE = os.path.join(DATA_ROOT, "user_progress.json")
COOLDOWN_SECONDS = 600 # 10 Minutes

os.makedirs(ASSESSMENT_DIR, exist_ok=True)

# Initialize Gemini
llm = ChatGoogleGenerativeAI(model="gemini-2.0-flash", temperature=0.3)

def get_session_text(session_id: str) -> str:
    """
    Extracts text from all PDFs in the session directory.
    Uses unstructured (fast strategy) for speed.
    """
    session_dir = os.path.join(UPLOAD_ROOT, session_id)
    if not os.path.exists(session_dir):
        return ""

    full_text = ""
    for filename in os.listdir(session_dir):
        if filename.lower().endswith(".pdf"):
            file_path = os.path.join(session_dir, filename)
            try:
                elements = partition_pdf(filename=file_path, strategy="fast")
                full_text += "\n".join([str(e) for e in elements])
            except Exception as e:
                print(f"Error parsing {filename}: {e}")
    
    return full_text[:50000] # Limit context window for safety

def get_sorted_files(session_id: str):
    """Returns a list of PDF dictionaries sorted by creation time (Oldest First)."""
    session_dir = os.path.join(UPLOAD_ROOT, session_id)
    if not os.path.exists(session_dir):
        return []
    
    files = []
    for filename in os.listdir(session_dir):
        if filename.lower().endswith(".pdf"):
            path = os.path.join(session_dir, filename)
            files.append({
                "filename": filename,
                "path": path,
                "timestamp": os.path.getctime(path)
            })
    
    # Sort: Oldest -> Newest
    return sorted(files, key=lambda x: x["timestamp"])

def get_current_chapter_context(session_id: str, chapter_file: dict) -> str:
    """Extracts text ONLY from the specific chapter file."""
    try:
        from unstructured.partition.pdf import partition_pdf
        elements = partition_pdf(filename=chapter_file["path"], strategy="fast")
        return "\n".join([str(e) for e in elements])[:40000]
    except Exception as e:
        print(f"Error reading chapter {chapter_file['filename']}: {e}")
        return ""

def get_assessment_prompt(level: int, context: str) -> str:
    if level == 1:
        return f"""
        You are an educational AI. Create a Level 1 Assessment (Recall & Understanding) based on the text below.
        
        Rules:
        1. Generate 10 Multiple Choice Questions (MCQs).
        2. Focus strictly on DEFINITIONS, DIRECT FACTS, and basic UNDERSTANDING from the text.
        3. Do not ask complex analysis questions yet.
        4. Provide 4 options for each question.
        5. Output JSON format only.

        Text Context:
        {context}

        Output JSON format:
        [
            {{
                "id": 1,
                "question": "What is...",
                "options": ["A", "B", "C", "D"],
                "correct_answer": "A",
                "explanation": "Brief explanation of why A is correct.",
                "hints": ["Hint 1 (Vague)", "Hint 2 (Helpful)", "Hint 3 (Giveaway)"]
            }},
            ...
        ]
        """
    elif level == 2:
        return f"""
        You are an educational AI. Create a Level 2 Assessment (Application & Analysis) based on the text below.
        
        Rules:
        1. Generate 10 Multiple Choice Questions (MCQs).
        2. Focus on SCENARIOS, CASE STUDIES, and APPLICATION of concepts.
        3. Questions should start like "A student observes that..." or "If X happens...", asking the user to apply knowledge.
        4. Provide 4 options for each question.
        5. Output JSON format only.

        Text Context:
        {context}

        Output JSON format:
        [
            {{
                "id": 1,
                "question": "Scenario...",
                "options": ["A", "B", "C", "D"],
                "correct_answer": "B",
                "explanation": "Brief explanation of why B is correct in this scenario.",
                "hints": ["Hint 1", "Hint 2", "Hint 3"]
            }},
            ...
        ]
        """
    elif level == 3:
        return f"""
        You are an educational AI. Create a Level 3 Assessment (Creation & Evaluation) based on the text below.
        
        Rules:
        1. Generate 5 Short Answer / Thought-Provoking Questions.
        2. Focus on "Create a solution", "Critique this method", "Propose an alternative".
        3. These are Open-Ended questions requiring synthesis of newer case studies or concepts.
        4. Output JSON format only.

        Text Context:
        {context}

        Output JSON format:
        [
            {{
                "id": 1,
                "question": "Propose a method to...",
                "type": "short_answer",
                "explanation": "Key elements that should be in the student's answer.",
                "hints": ["Think about...", "Consider...", "Remember the concept of..."]
            }},
            ...
        ]
        """
    return ""

def _assessment_cache_file(session_id: str, chapter_name: str, level: int) -> str:
    chapter_hash = hashlib.sha1(chapter_name.encode("utf-8")).hexdigest()[:12]
    return os.path.join(ASSESSMENT_DIR, f"{session_id}_{chapter_hash}_lvl{level}.json")


def generate_assessment(session_id: str, level: int, chapter_index: Optional[int] = None):
    files = get_sorted_files(session_id)
    if not files:
        return {"error": "No documents found for this session."}

    if chapter_index is None:
        progress = load_user_progress().get(session_id, {})
        chapter_index = int(progress.get("current_chapter_index", 0) or 0)

    if chapter_index >= len(files):
        return {"error": "All chapters completed! You are a master."}

    current_file = files[chapter_index]
    cache_file = _assessment_cache_file(session_id, current_file["filename"], level)
    if os.path.exists(cache_file):
        with open(cache_file, "r") as f:
            return json.load(f)

    # 3. Get Context for THIS Chapter ONLY
    context = get_current_chapter_context(session_id, current_file)
    if not context:
        return {"error": f"Failed to load content for {current_file['filename']}"}

    # 3. Generate
    prompt = get_assessment_prompt(level, context)
    messages = [HumanMessage(content=prompt)]
    
    try:
        response = llm.invoke(messages)
        content = response.content.strip()
        
        # Clean Markdown
        if content.startswith("```json"):
            content = content[7:-3]
        elif content.startswith("```"):
            content = content[3:-3]
            
        assessment_data = json.loads(content)
        
        # Add metadata like timer
        result = {
            "level": level,
            "timer_seconds": 600,
            "questions": assessment_data,
            "chapter_name": current_file['filename'],
            "chapter_index": chapter_index
        }
        
        # Save to Cache
        with open(cache_file, "w") as f:
            json.dump(result, f, indent=4)
            
        return result
        
    except Exception as e:
        print(f"Assessment Generation Failed: {e}")
        return {"error": "Failed to generate assessment."}

def generate_remedial_plan(mistakes: List[Dict]) -> Dict:
    """
    Analyzes mistakes and generates a diagnostic remedial plan.
    """
    if not mistakes:
        return {}

    mistakes_text = json.dumps([{
        "question": m["question"], 
        "user_answer": m.get("user_answer"), 
        "correct_answer": m.get("correct_answer")
    } for m in mistakes], indent=2)

    prompt = f"""
    You are an expert tutor. A student failed an assessment. Analyze their mistakes and provide a remedial plan.
    
    Mistakes:
    {mistakes_text}

    Task:
    1. **Diagnosis**: Classify the primary gap (Concept Gap, Application Gap, or Overgeneralization).
    2. **Explanation**: Provide a clear, guided explanation to correct the misunderstanding (keep it under 100 words).
    3. **Practice Question**: Create 1 single-choice practice question to verify understanding.

    Output JSON ONLY:
    {{
        "diagnosis": "Concept Gap: Misunderstood the definition of X",
        "explanation": "Here is why...",
        "practice_question": {{
            "question": "...",
            "options": ["A", "B", "C", "D"],
            "correct_answer": "A",
            "explanation": "..."
        }}
    }}
    """
    try:
        response = llm.invoke([HumanMessage(content=prompt)])
        content = response.content.strip()
        if content.startswith("```json"): content = content[7:-3]
        elif content.startswith("```"): content = content[3:-3]
        return json.loads(content)
    except Exception as e:
        print(f"Remedial Plan Generation Failed: {e}")
        return {
            "diagnosis": "General Review Needed",
            "explanation": "Please review the material again.",
            "practice_question": None
        }

def spend_xp(session_id: str, amount: int) -> bool:
    """Deducts XP if sufficient balance exists. Returns True if successful."""
    progress = load_user_progress()
    if session_id not in progress:
        return False
    
    if progress[session_id].get("xp", 0) >= amount:
        progress[session_id]["xp"] -= amount
        save_user_progress(progress)
        return True
    return False

def clear_cooldown(session_id: str):
    """Clears the remedial plan and retry cooldown for a session."""
    progress = load_user_progress()
    if session_id in progress:
        user_data = progress[session_id]
        if "remedial_plan" in user_data:
            del user_data["remedial_plan"]
        if "retry_available_at" in user_data:
            del user_data["retry_available_at"]
        save_user_progress(progress)
        return True
    return False

def load_user_progress():
    if os.path.exists(PROGRESS_FILE):
        with open(PROGRESS_FILE, "r") as f:
            return json.load(f)
    return {}

def save_user_progress(progress):
    with open(PROGRESS_FILE, "w") as f:
        json.dump(progress, f, indent=4)

def submit_assessment_result(session_id: str, level: int, score: int, max_score: int, mistakes: List[Dict] = None):
    progress = load_user_progress()
    
    if session_id not in progress:
        progress[session_id] = {
            "xp": 0, 
            "unlocked_level": 1, 
            "current_chapter_index": 0,
            "history": [], 
            "mistakes": []
        }
    
    user_data = progress[session_id]
    
    # Validation: Ensure they are submitting for the CORRECT chapter level
    # (Simplified: Frontend handles most checks, backend updates pointers)
    
    if "mistakes" not in progress[session_id]:
        progress[session_id]["mistakes"] = []
        
    user_data = progress[session_id]
    
    # Calculate XP
    xp_gained = 0
    passed = False
    
    # Bloom's Logic & Thresholds
    if level == 1:
        if score >= 8: 
            xp_gained = random.randint(50, 100)
            passed = True
            if user_data["unlocked_level"] < 2:
                user_data["unlocked_level"] = 2
                
                
    elif level == 2:
        if score >= 7:
            xp_gained = random.randint(100, 150)
            passed = True
            if user_data["unlocked_level"] < 3:
                user_data["unlocked_level"] = 3

    elif level == 3:
        if score > 0: # Strict passing for L3
            xp_gained = random.randint(150, 200) + 500 # Bonus for Chapter Clear
            passed = True
            
            # --- CHAPTER MASTERED ---
            # Move to next chapter, Reset level to 1
            user_data["current_chapter_index"] = user_data.get("current_chapter_index", 0) + 1
            user_data["unlocked_level"] = 1 

    if passed:
        user_data["xp"] += xp_gained
        # clear remedial plan if passed
        if "remedial_plan" in user_data:
            del user_data["remedial_plan"]
        if "retry_available_at" in user_data:
            del user_data["retry_available_at"]
    else:
        # FAILED - Trigger Cooldown & Remedial Plan
        user_data["retry_available_at"] = time.time() + COOLDOWN_SECONDS
        if mistakes:
            user_data["remedial_plan"] = generate_remedial_plan(mistakes)
    
    # Update History
    user_data["history"].append({
        "level": level,
        "score": score,
        "max_score": max_score,
        "passed": passed,
        "xp_gained": xp_gained,
        "timestamp": str(os.path.getmtime(PROGRESS_FILE) if os.path.exists(PROGRESS_FILE) else 0) 
    })

    # Update Mistakes
    if mistakes:
        for m in mistakes:
            # Check if mistake already exists to avoid duplicates
            if not any(dm["question"] == m["question"] for dm in user_data["mistakes"]):
                user_data["mistakes"].append({
                    "question": m["question"],
                    "correct_answer": m.get("correct_answer"),
                    "explanation": m.get("explanation"),
                    "user_answer": m.get("user_answer"),
                    "level": level,
                    "comments": "",
                    "timestamp": str(os.path.getmtime(PROGRESS_FILE) if os.path.exists(PROGRESS_FILE) else 0)
                })
    
    save_user_progress(progress)
    
    return {
        "passed": passed,
        "xp_gained": xp_gained,
        "new_total_xp": user_data["xp"],
        "unlocked_level": user_data["unlocked_level"],
        "score": score
    }

def get_mistakes(session_id: str):
    progress = load_user_progress()
    if session_id == "all":
        all_mistakes = []
        for sid, data in progress.items():
            if isinstance(data, dict) and "mistakes" in data:
                # Add session_id to each mistake for context in global view
                for m in data["mistakes"]:
                    m_with_sid = m.copy()
                    m_with_sid["session_id"] = sid
                    all_mistakes.append(m_with_sid)
        return all_mistakes
        
    if session_id not in progress:
        return []
    return progress[session_id].get("mistakes", [])

def update_mistake_comment(session_id: str, question_text: str, comment: str):
    progress = load_user_progress()
    if session_id in progress and "mistakes" in progress[session_id]:
        for m in progress[session_id]["mistakes"]:
            if m["question"] == question_text:
                m["comments"] = comment
                save_user_progress(progress)
                return True
    return False

def get_progress(session_id: str):
    progress = load_user_progress()
    user_data = progress.get(session_id, {
        "xp": 0, 
        "unlocked_level": 1, 
        "current_chapter_index": 0,
        "history": []
    })
    
    # Calculate Lagging Status
    files = get_sorted_files(session_id)
    current_idx = user_data.get("current_chapter_index", 0)
    
    status = "on_track"
    deadline_msg = ""
    
    if current_idx < len(files):
        current_file = files[current_idx]
        user_data["current_chapter_title"] = current_file['filename'] # Added for Frontend
        upload_time = current_file["timestamp"]
        deadline = upload_time + (5 * 24 * 3600) # 5 Days in seconds
        
        if current_idx + 1 < len(files):
             user_data["next_chapter_title"] = files[current_idx + 1]['filename']

        if time.time() > deadline:
            status = "lagging"
            days_late = int((time.time() - deadline) / (24 * 3600))
            deadline_date = time.strftime('%Y-%m-%d', time.localtime(deadline))
            deadline_msg = f"⚠️ You are {days_late} days late! Deadline for '{current_file['filename']}' was {deadline_date}."
    else:
        user_data["current_chapter_title"] = "All Chapters Mastered!"
    
    user_data["status"] = status
    user_data["deadline_message"] = deadline_msg
    user_data["total_chapters"] = len(files)

    # Check Cooldown
    if "retry_available_at" in user_data:
        remaining = user_data["retry_available_at"] - time.time()
        if remaining > 0:
            user_data["cooldown_remaining"] = int(remaining)
        else:
            # Cleanup expired cooldown
            del user_data["retry_available_at"]
            if "remedial_plan" in user_data:
                del user_data["remedial_plan"]
    
    return user_data

def get_teacher_analytics(session_id: str, enrolled_student_ids: Optional[List[str]] = None):
    """
    Generates class analytics using only students enrolled in the classroom.
    """
    progress = load_user_progress()
    total_chapters = len(get_sorted_files(session_id))
    enrolled_student_ids = enrolled_student_ids or []
    total_students = len(enrolled_student_ids)

    student_records: List[Dict] = []
    for student_id in enrolled_student_ids:
        scoped_key = f"{session_id}::{student_id}"
        student_records.append(progress.get(scoped_key, {
            "xp": 0,
            "unlocked_level": 1,
            "current_chapter_index": 0,
            "history": [],
            "mistakes": []
        }))

    level_dist: Dict = {1: 0, 2: 0, 3: 0, "completed": 0}
    level_attempt_totals = {1: 0, 2: 0, 3: 0}
    mistake_counter: Counter = Counter()
    lagging_count = 0

    chapter_files = get_sorted_files(session_id)
    for record in student_records:
        chapter_index = int(record.get("current_chapter_index", 0) or 0)
        unlocked_level = int(record.get("unlocked_level", 1) or 1)

        if total_chapters > 0 and chapter_index >= total_chapters:
            level_dist["completed"] += 1
        else:
            normalized_level = unlocked_level if unlocked_level in (1, 2, 3) else 1
            level_dist[normalized_level] += 1

        if chapter_index < len(chapter_files):
            chapter_deadline = chapter_files[chapter_index]["timestamp"] + (5 * 24 * 3600)
            if time.time() > chapter_deadline:
                lagging_count += 1

        history = record.get("history", []) or []
        for attempt in history:
            level = attempt.get("level")
            if level in (1, 2, 3):
                level_attempt_totals[level] += 1

        for mistake in (record.get("mistakes", []) or []):
            concept = (mistake.get("question") or "Unknown Concept").strip()
            if concept:
                mistake_counter[concept] += 1

    denominator = total_students if total_students > 0 else 1
    average_attempts = {
        "level_1": round(level_attempt_totals[1] / denominator, 2),
        "level_2": round(level_attempt_totals[2] / denominator, 2),
        "level_3": round(level_attempt_totals[3] / denominator, 2),
    }

    common_mistakes = [
        {"concept": concept[:80], "frequency": frequency}
        for concept, frequency in mistake_counter.most_common(3)
    ]

    return {
        "total_students": total_students,
        "level_distribution": level_dist,
        "stuck_percent": round((lagging_count / denominator) * 100) if total_students > 0 else 0,
        "average_attempts": average_attempts,
        "common_mistakes": common_mistakes
    }

def get_all_assessments_for_teacher(session_id: str):
    """
    Returns all assessments organized by chapter and quest level for teacher preview.
    Structure:
    {
        "chapters": [
            {
                "chapter_name": "filename.pdf",
                "chapter_index": 0,
                "quests": [
                    {"level": 1, "questions": [...], "timer_seconds": 600},
                    {"level": 2, "questions": [...], "timer_seconds": 600},
                    {"level": 3, "questions": [...], "timer_seconds": 600}
                ]
            }
        ]
    }
    """
    files = get_sorted_files(session_id)
    if not files:
        return {"chapters": []}
    
    chapters = []
    
    for idx, file_info in enumerate(files):
        chapter_data = {
            "chapter_name": file_info['filename'],
            "chapter_index": idx,
            "quests": []
        }
        
        # Generate assessments for all 3 levels
        for level in [1, 2, 3]:
            assessment = generate_assessment(session_id, level, chapter_index=idx)
            if "error" not in assessment:
                chapter_data["quests"].append({
                    "level": level,
                    "questions": assessment.get("questions", []),
                    "timer_seconds": assessment.get("timer_seconds", 600)
                })
        
        chapters.append(chapter_data)
    
    return {"chapters": chapters}
