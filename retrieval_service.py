import os
import json
from typing import List, Dict, Optional, Set
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

class BedrockResponse:
    def __init__(self, content: str):
        self.content = content

@retry(
    stop=stop_after_attempt(5),
    wait=wait_exponential(multiplier=1, min=2, max=10),
    retry=retry_if_exception_type(Exception),
    before_sleep=lambda retry_state: print(f"⚠️ API Limit hit (Retrieval). Retrying in {retry_state.next_action.sleep} seconds...")
)
def generate_ai_response(prompt: str):
    try:
        text = invoke_bedrock_text(prompt, temperature=0.2, max_tokens=2000).strip()
        return BedrockResponse(text)
    except Exception as e:
        print(f"DEBUG: API call failed with error: {str(e)}")
        # If it's a 429, we want to know the EXACT message (e.g., TPM, RPM, or Account limit)
        raise e

SYSTEM_PROMPT = """
You are a friendly, expert Study Assistant Bot. Your goal is to help students understand complex topics from their teacher's uploaded materials.

Rules for your response:
1. **Explanation Structure**: For every key concept or topic you explain, you MUST follow this internal logic, but **DO NOT use labels like "Step A" or "Step B" in your final response**:
   - **First**: Provide a precise, technical definition directly from the teacher's provided context. Quote the text or summarize it accurately without simplification.
   - **Second**: Transition naturally (e.g., "In simpler terms..." or "Think of it like this...") into an intuitive, layman explanation using your educational tone and analogies.
2. **Educational Tone**: Speak like a supportive teacher. Use analogies and metaphors only *after* providing the formal technical definition.
3. **Context First**: Primary information MUST come from the provided PDF context. Use it for the initial formal definition.
4. **Higher-Order Thinking (Bloom's Taxonomy)**:
   - **Application**: Always end your explanation with a "Brain Teaser" or "Apply It" scenario that asks the student to use the concept in a new situation.
   - **Synthesis**: If multiple topics or sections are retrieved, explain how they fit together into the "Big Picture".
   - **Reasoning Hints**: If the student asks a "Why" or "How" question, provide a subtle hint that guides them toward the answer before or alongside the full explanation.
5. **Summarization Queries**: If the user asks for "main concepts" or an "overview", prioritize identifying the central theme or architecture described in the documents first, then move to details, applying the [Formal -> Intuitive] flow for each.
6. **Broaden Knowledge (+1 Logic)**: If relevant, add a small piece of related common knowledge that helps explain the concept better. Keep it simple.
7. **Visual Aids**: Use Mermaid.js flowchart syntax for processes or hierarchies. 
8. **Formatting**: Use bold text for key terms and bullet points. Do not include internal structural tags or step indices in the text.
9. **Analogies**: Always provide at least one analogy for complex concepts.
10. **Google Search**: You have access to Google Search. If the provided context is insufficient or if the user asks about recent events, latest breakthroughs, or information outside the documents, use Google Search to provide accurate, grounded information. Always prioritize the teacher's documents for core course topics.
"""

def get_doubt_assistant_response(
    query: str,
    session_id: str,
    language: str = "english",
    is_individual: bool = False,
    allowed_sources: Optional[Set[str]] = None
):
    """
    Main retrieval pipeline for the Doubt Assistant.
    """
    # 1. Connect to DB
    db = Chroma(
        persist_directory=CHROMA_PATH,
        embedding_function=LOCAL_EMBEDDINGS,
        collection_name="hackathon_collection"
    )

    # 3. Retrieve context from Vector DB
    print(f"🔍 Searching ChromaDB for session: {session_id} with query: {query}")
    results = []
    if session_id and session_id != "undefined":
        results = db.max_marginal_relevance_search(
            query, 
            k=8, 
            fetch_k=20, 
            lambda_mult=0.5, 
            filter={"session_id": session_id}
        )
    print(f"📊 Found {len(results)} chunks in ChromaDB")

    normalized_allowed_sources = {
        str(src).strip().casefold() for src in (allowed_sources or set()) if str(src).strip()
    }
    if normalized_allowed_sources:
        filtered_results = []
        for doc in results:
            source = str((doc.metadata or {}).get("source", "")).strip().casefold()
            if source in normalized_allowed_sources:
                filtered_results.append(doc)
        print(
            f"📎 Source filtering enabled: {len(filtered_results)}/{len(results)} chunks match "
            f"{len(normalized_allowed_sources)} allowed files"
        )
        results = filtered_results

    if not results and not is_individual:
        return "I'm sorry, I couldn't find relevant information in the classroom PDFs for this class. Please make sure the correct class is selected and files are fully ingested."

    # 3. Format Context
    context_text = ""
    if results:
        for i, doc in enumerate(results):
            context_text += f"\n--- SOURCE CHUNK {i+1} ---\n{doc.page_content}\n"
    else:
        context_text = "No specific document context available. Answer as a general educational assistant."

    # 4. Multilingual Prompt logic
    lang_instruction = ""
    if language.lower() == "hindi":
        lang_instruction = "\n**LANGUAGE RULE**: Respond in a mix of Hindi and English. Explain the concepts in Hindi, but keep all technical terms, definitions, and context-specific labels in English exactly as they appear in the documentation. speak in a natural 'Hinglish' style."
    elif language.lower() == "telugu":
        lang_instruction = "\n**LANGUAGE RULE**: Respond in a mix of Telugu and English. Explain the concepts in Telugu, but keep all technical terms, definitions, and context-specific labels in English exactly as they appear in the documentation."
    
    # 5. Load Teacher Instructions (if any)
    teacher_instructions = ""
    review_path = os.path.join("uploads", session_id, "teacher_review.json")
    if os.path.exists(review_path):
        try:
            with open(review_path, "r") as f:
                review_data = json.load(f)
                focus = review_data.get("assessment_focus")
                gaps = review_data.get("student_gaps")
                doc_text = review_data.get("document_text")
                if focus or gaps or doc_text:
                    teacher_instructions = "\n\n**IMPORTANT TEACHER GUIDANCE**:"
                    if focus:
                        teacher_instructions += f"\n- Assessment/Evaluation Style: {focus}"
                    if gaps:
                        teacher_instructions += f"\n- Student Knowledge Gaps to prioritize: {gaps}"
                    if doc_text:
                        teacher_instructions += f"\n- Detailed Guidance from Teacher's Review Document: {doc_text}"
                    teacher_instructions += "\nAdjust your explanation and assessment approach to align with these instructions."
        except Exception as e:
            print(f"⚠️ Failed to load teacher review: {e}")

    # 6. Generate Response
    student_prompt = f"""
    USER QUESTION: {query}

    TEACHER'S PROVIDED CONTEXT:
    {context_text}

    Please explain this to the student using the rules provided in your system prompt. {lang_instruction} {teacher_instructions}
    """
    
    full_prompt = f"{SYSTEM_PROMPT}\n\n{student_prompt}"
    response = generate_ai_response(full_prompt)
    return response.content

if __name__ == "__main__":
    pass
