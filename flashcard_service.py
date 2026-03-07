import os
import json
import re
import threading
from typing import List, Dict, Optional
from bedrock_utils import invoke_bedrock_text
from langchain_chroma import Chroma
from langchain_huggingface import HuggingFaceEmbeddings
from tenacity import (
    retry,
    stop_after_attempt,
    wait_exponential,
    retry_if_exception_type
)
from dotenv import load_dotenv

load_dotenv(override=True)

# --- CONFIG ---
CHROMA_PATH = "./chroma_db"
LOCAL_EMBEDDINGS = HuggingFaceEmbeddings(model_name="sentence-transformers/all-MiniLM-L6-v2")
_cache_locks: Dict[str, threading.Lock] = {}
_cache_locks_guard = threading.Lock()

class BedrockResponse:
    def __init__(self, content: str):
        self.content = content
        
@retry(
    stop=stop_after_attempt(5),
    wait=wait_exponential(multiplier=1, min=2, max=10),
    retry=retry_if_exception_type(Exception),
    before_sleep=lambda retry_state: print(f"⚠️ API Limit hit (Flashcards). Retrying in {retry_state.next_action.sleep} seconds...")
)
def generate_ai_response(prompt: str):
    try:
        content= invoke_bedrock_text(prompt, temperature=0.3, max_tokens=2500).strip()
        return BedrockResponse(content)
    except Exception as e:
        print(f"DEBUG: API call failed with error: {str(e)}")
        raise e

FLASHCARD_SYSTEM_PROMPT = """
You are an expert educational content creator. Your goal is to extract the main topics from a provided text and create concise, high-impact revision summaries for each topic.

Rules for your response:
1. **Comprehensive Extraction**: Identify **all distinct core topics, sections, or concepts** discussed in the provided text. Do not limit yourself to a fixed number; if the text covers 10 concepts, list all 10.
2. **Conciseness**: Each summary MUST be short and power-packed (max 120 words per topic).
3. **Format**: Return a JSON object with a list called "flashcards". Each item should have:
   - "topic": The name of the concept or section heading (In English).
   - "summary": The concise revision notes for that topic.
4. **Style**: Use bullet points and bold text for key terms within the summary.
5. **JSON ONLY**: Your entire response MUST be a valid JSON object. Do not include any markdown formatting like ```json ... ``` tags.
6. **STRICT LANGUAGE & SCRIPT RULE**:
   - If **Hindi** is selected: You MUST use **Devanagari script (हिन्दी)** for all explanations. Do NOT use Roman script (English alphabets) for Hindi sentences.
   - If **Telugu** is selected: You MUST use **Telugu script (తెలుగు)** for all explanations. Do NOT use Roman script (English alphabets) for Telugu sentences. This is CRITICAL.
   - If **Hinglish** is selected: Use **English alphabets (Roman script)** for the entire summary.
   - If **English** is selected: Use English.
   - **Technical Terms**: Keep all technical terms, technical definitions, and proper nouns in **English** (Roman script) even when writing in Hindi or Telugu script.
     - *Example (Hindi)*: "Neural Network एक कम्प्यूटर सिस्टम है..."
     - *Example (Telugu)*: "Neural Network అనేది ఒక కంప్యూటర్ సిస్టమ్..."
"""

def _normalize_source_name(source: Optional[str]) -> Optional[str]:
    if not source:
        return None
    cleaned = os.path.basename(str(source)).strip()
    return cleaned or None


def _source_slug(source: str) -> str:
    # Stable cache-safe slug per material filename.
    return re.sub(r"[^a-zA-Z0-9._-]+", "_", source).strip("_").lower()[:120]


def _flashcard_cache_path(session_id: str, language: str, source: Optional[str] = None) -> str:
    source_name = _normalize_source_name(source)
    if source_name:
        cache_name = f"flashcards_v10_{language.lower()}_{_source_slug(source_name)}.json"
    else:
        cache_name = f"flashcards_v10_{language.lower()}_all.json"
    return os.path.join("uploads", session_id, cache_name)


def _get_cache_lock(cache_path: str) -> threading.Lock:
    with _cache_locks_guard:
        if cache_path not in _cache_locks:
            _cache_locks[cache_path] = threading.Lock()
        return _cache_locks[cache_path]


def _read_cached_flashcards(cache_path: str) -> Optional[List[Dict[str, str]]]:
    if not os.path.exists(cache_path):
        return None
    try:
        with open(cache_path, "r", encoding="utf-8") as f:
            payload = json.load(f)
        cards = payload.get("flashcards", [])
        return cards if isinstance(cards, list) else []
    except Exception as e:
        print(f"Cache read failed: {e}")
        return None


def _write_cache_atomic(cache_path: str, data: Dict[str, object]) -> None:
    os.makedirs(os.path.dirname(cache_path), exist_ok=True)
    tmp_path = f"{cache_path}.tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp_path, cache_path)


def generate_flashcards(session_id: str, language: str = "english", source: Optional[str] = None):
    """
    Generates topic-wise revision summaries from the ingested materials of a session.
    """
    source_name = _normalize_source_name(source)
    flashcard_cache_path = _flashcard_cache_path(session_id, language, source_name)
    cache_lock = _get_cache_lock(flashcard_cache_path)

    cached = _read_cached_flashcards(flashcard_cache_path)
    if cached is not None:
        return cached

    with cache_lock:
        cached = _read_cached_flashcards(flashcard_cache_path)
        if cached is not None:
            return cached

        db = Chroma(
            persist_directory=CHROMA_PATH,
            embedding_function=LOCAL_EMBEDDINGS,
            collection_name="hackathon_collection"
        )

        print(f"Retrieving material for {language} flashcards in session: {session_id}, source={source_name or 'ALL'}")
        where_filter = {"session_id": session_id}
        if source_name:
            where_filter = {"$and": [{"session_id": session_id}, {"source": source_name}]}

        results = db.get(where=where_filter, include=["documents", "metadatas"])
        docs = results.get("documents", [])
        metadatas = results.get("metadatas", [])
        if source_name and docs and metadatas:
            # Defensive fallback: enforce source match in case backend filter behavior changes.
            filtered_docs = []
            for doc, metadata in zip(docs, metadatas):
                doc_source = str((metadata or {}).get("source", "")).strip()
                if doc_source.lower() == source_name.lower():
                    filtered_docs.append(doc)
            docs = filtered_docs
        if not docs:
            print(f"No documents found for session_id={session_id}, source={source_name}")
            return {"status": "processing", "flashcards": []}

        full_context = "\n\n".join(docs[:40])

        script_note = ""
        if language.lower() == "hindi":
            script_note = "STRICT: Use Devanagari script for explanations."
        elif language.lower() == "telugu":
            script_note = "STRICT: Use Telugu script only. Do not use English alphabets for Telugu sentences."

        lang_instruction = f"Output language: {language}. {script_note} Remember: technical terms in English, explanations in native {language} script."
        prompt = f"Extract topics and generate revision flashcards from this text:\n\n{full_context}\n\n{lang_instruction}"

        full_prompt = f"{FLASHCARD_SYSTEM_PROMPT}\n\n{prompt}"
        response = generate_ai_response(full_prompt)

        try:
            clean_content = response.content.replace("```json", "").replace("```", "").strip()
            try:
                data = json.loads(clean_content)
            except json.JSONDecodeError:
                start = clean_content.find("{")
                end = clean_content.rfind("}")
                if start != -1 and end != -1:
                    data = json.loads(clean_content[start:end+1])
                else:
                    raise
                    
            if not isinstance(data, dict):
                raise ValueError("Invalid flashcard payload.")
            if not isinstance(data.get("flashcards"), list):
                data["flashcards"] = []
            _write_cache_atomic(flashcard_cache_path, data)
            return data.get("flashcards", [])
        except Exception as e:
            print(f"Failed to parse {language} flashcard JSON: {e}")
            print(f"RAW CONTENT: {response.content}")
            return []

def update_flashcard_manual(session_id: str, language: str, index: int, updated_card: Dict[str, str], source: Optional[str] = None):
    """
    Manually updates a specific flashcard in the cache.
    """
    flashcard_cache_path = _flashcard_cache_path(session_id, language, source)
    cache_lock = _get_cache_lock(flashcard_cache_path)

    if not os.path.exists(flashcard_cache_path):
        return {"error": "Flashcard cache not found"}

    try:
        with cache_lock:
            with open(flashcard_cache_path, "r", encoding="utf-8") as f:
                data = json.load(f)

            if 0 <= index < len(data["flashcards"]):
                data["flashcards"][index] = updated_card
                _write_cache_atomic(flashcard_cache_path, data)
                return {"success": True, "flashcards": data["flashcards"]}
            return {"error": "Invalid flashcard index"}
    except Exception as e:
        print(f"Error updating flashcard: {e}")
        return {"error": str(e)}

def refine_flashcard_with_ai(
    session_id: str,
    language: str,
    index: int,
    user_instruction: str,
    source: Optional[str] = None
):
    """
    Refines a specific flashcard using AI based on teacher instructions.
    """
    flashcard_cache_path = _flashcard_cache_path(session_id, language, source)
    cache_lock = _get_cache_lock(flashcard_cache_path)

    if not os.path.exists(flashcard_cache_path):
        return {"error": "Flashcard cache not found"}

    try:
        with cache_lock:
            with open(flashcard_cache_path, "r", encoding="utf-8") as f:
                data = json.load(f)

            if not (0 <= index < len(data["flashcards"])):
                return {"error": "Invalid flashcard index"}

            current_card = data["flashcards"][index]

            refinement_prompt = f"""
            You are refining a specific revision flashcard based on a teacher's instruction.

            Current Flashcard:
            Topic: {current_card['topic']}
            Summary: {current_card['summary']}

            Teacher's Instruction for refinement: "{user_instruction}"

            Rules:
            1. Maintain the JSON format: {{"topic": "...", "summary": "..."}}
            2. Keep the summary concise (max 120 words).
            3. Use the requested language: {language}.
            4. Return ONLY the JSON object for this single refined card.
            """

            full_prompt = (
                "You are an expert tutor refining educational content.\n\n"
                f"{refinement_prompt}"
            )
            response = generate_ai_response(full_prompt)
            clean_content = response.content.replace("```json", "").replace("```", "").strip()
            try:
                refined_card = json.loads(clean_content)
            except json.JSONDecodeError:
                start = clean_content.find("{")
                end = clean_content.rfind("}")
                if start != -1 and end != -1:
                    refined_card = json.loads(clean_content[start:end+1])
                else:
                    raise

            data["flashcards"][index] = refined_card
            _write_cache_atomic(flashcard_cache_path, data)

            return {"success": True, "refined_card": refined_card, "flashcards": data["flashcards"]}

    except Exception as e:
        print(f"Error refining flashcard with AI: {e}")
        return {"error": str(e)}

if __name__ == "__main__":
    # Test logic
    # print(generate_flashcards("test_session"))
    pass



