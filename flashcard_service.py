import os
import json
from typing import List, Dict
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_chroma import Chroma
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_core.messages import HumanMessage, SystemMessage
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
llm = ChatGoogleGenerativeAI(model="gemini-2.0-flash", temperature=0.3)

@retry(
    stop=stop_after_attempt(5),
    wait=wait_exponential(multiplier=1, min=2, max=10),
    retry=retry_if_exception_type(Exception),
    before_sleep=lambda retry_state: print(f"⚠️ API Limit hit (Flashcards). Retrying in {retry_state.next_action.sleep} seconds...")
)
def generate_ai_response(messages):
    try:
        return llm.invoke(messages)
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

def generate_flashcards(session_id: str, language: str = "english"):
    """
    Generates topic-wise revision summaries from the ingested materials of a session.
    """
    cache_name = f"flashcards_v9_{language.lower()}.json"
    flashcard_cache_path = os.path.join("uploads", session_id, cache_name)
    
    # Check if already generated for this language
    if os.path.exists(flashcard_cache_path):
        try:
            with open(flashcard_cache_path, "r", encoding="utf-8") as f:
                return json.load(f)["flashcards"]
        except Exception as e:
            print(f"⚠️ Error reading flashcard cache: {e}")

    # 1. Connect to DB
    db = Chroma(
        persist_directory=CHROMA_PATH,
        embedding_function=LOCAL_EMBEDDINGS,
        collection_name="hackathon_collection"
    )

    # 2. Retrieve all unique chunks for this session
    print(f"🔍 Retrieving material for {language} flashcards in session: {session_id}")
    results = db.get(
        where={"session_id": session_id},
        include=["documents"]
    )
    
    docs = results.get("documents", [])
    if not docs:
        print(f"⚠️ No documents found for session {session_id}")
        return []

    # Combine docs (Increase limit to cover more material)
    full_context = "\n\n".join(docs[:40]) 

    # 3. Generate with AI
    script_note = ""
    if language.lower() == "hindi":
        script_note = "STRICT: Use Devanagari script (हिन्दी) for explanations."
    elif language.lower() == "telugu":
        script_note = "STRICT: Use Telugu script (తెలుగు) ONLY. DO NOT USE ENGLISH ALPHABETS FOR TELUGU SENTENCES."
        
    lang_instruction = f"Output language: {language}. {script_note} Remember: technical terms in English, explanations in native {language} script."
    prompt = f"Extract topics and generate revision flashcards from this text:\n\n{full_context}\n\n{lang_instruction}"
    
    messages = [
        SystemMessage(content=FLASHCARD_SYSTEM_PROMPT),
        HumanMessage(content=prompt)
    ]

    print(f"🪄 Generating {language} flashcards via AI for session {session_id}...")
    response = generate_ai_response(messages)
    
    try:
        # Clean response if AI adds markdown
        clean_content = response.content.replace('```json', '').replace('```', '').strip()
        data = json.loads(clean_content)
        
        # Cache for future use
        os.makedirs(os.path.dirname(flashcard_cache_path), exist_ok=True)
        with open(flashcard_cache_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            
        return data.get("flashcards", [])
    except Exception as e:
        print(f"❌ Failed to parse {language} flashcard JSON: {e}")
        print(f"RAW CONTENT: {response.content}")
        return []

def update_flashcard_manual(session_id: str, language: str, index: int, updated_card: Dict[str, str]):
    """
    Manually updates a specific flashcard in the cache.
    """
    cache_name = f"flashcards_v9_{language.lower()}.json"
    flashcard_cache_path = os.path.join("uploads", session_id, cache_name)
    
    if not os.path.exists(flashcard_cache_path):
        return {"error": "Flashcard cache not found"}
        
    try:
        with open(flashcard_cache_path, "r", encoding="utf-8") as f:
            data = json.load(f)
            
        if 0 <= index < len(data["flashcards"]):
            data["flashcards"][index] = updated_card
            
            with open(flashcard_cache_path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            return {"success": True, "flashcards": data["flashcards"]}
        else:
            return {"error": "Invalid flashcard index"}
    except Exception as e:
        print(f"❌ Error updating flashcard: {e}")
        return {"error": str(e)}

def refine_flashcard_with_ai(session_id: str, language: str, index: int, user_instruction: str):
    """
    Refines a specific flashcard using AI based on teacher instructions.
    """
    cache_name = f"flashcards_v9_{language.lower()}.json"
    flashcard_cache_path = os.path.join("uploads", session_id, cache_name)
    
    if not os.path.exists(flashcard_cache_path):
        return {"error": "Flashcard cache not found"}
        
    try:
        with open(flashcard_cache_path, "r", encoding="utf-8") as f:
            data = json.load(f)
            
        if not (0 <= index < len(data["flashcards"])):
            return {"error": "Invalid flashcard index"}
            
        current_card = data["flashcards"][index]
        
        # Build prompt for refinement
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
        
        messages = [
            SystemMessage(content="You are an expert tutor refining educational content."),
            HumanMessage(content=refinement_prompt)
        ]
        
        print(f"🪄 Refining flashcard {index} via AI for session {session_id}...")
        response = generate_ai_response(messages)
        
        # Parse refined card
        clean_content = response.content.replace('```json', '').replace('```', '').strip()
        refined_card = json.loads(clean_content)
        
        # Update and save
        data["flashcards"][index] = refined_card
        with open(flashcard_cache_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            
        return {"success": True, "refined_card": refined_card, "flashcards": data["flashcards"]}
        
    except Exception as e:
        print(f"❌ Error refining flashcard with AI: {e}")
        return {"error": str(e)}

if __name__ == "__main__":
    # Test logic
    # print(generate_flashcards("test_session"))
    pass
