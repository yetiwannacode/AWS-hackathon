import json
from json_repair import repair_json
import os
import time
import uuid
from datetime import datetime
from typing import List, Dict, Any, Optional
from google import genai
from google.genai import types
from dotenv import load_dotenv

load_dotenv()

# Configure Gemini
api_key = os.getenv("GOOGLE_API_KEY")
if not api_key:
    # Fallback to a placeholder or raise error in production
    print("Warning: GOOGLE_API_KEY not found in .env")

client = genai.Client(api_key=api_key)

ROADMAPS_DIR = os.path.join("data", "roadmaps")
os.makedirs(ROADMAPS_DIR, exist_ok=True)

def generate_roadmap(prompt: str, session_id: str) -> Dict[str, Any]:
    """
    Generates a structured learning roadmap from a user prompt.
    """
    system_prompt = """
    You are an expert educational consultant. Your task is to create a detailed, high-quality learning roadmap based on a user's goal.
    
    The roadmap must be structured as follows in JSON format:
    {
        "title": "A catchy title for the course",
        "description": "A brief overview of the course",
        "total_days": 30, // Default to 30 if not specified
        "weeks": [
            {
                "week_number": 1,
                "goal": "Goal for this week",
                "days": [
                    {
                        "day_number": 1,
                        "topic": "Topic for the day",
                        "learning_objectives": ["Objective 1", "Objective 2"],
                        "youtube_video_title": "Title of the recommended YouTube video",
                        "youtube_video_url": "Actual URL to the recommended YouTube video",
                        "reference_content": "A highly comprehensive, in-depth tutorial (minimum 400 words). Do NOT summarize. Provide the actual learning material. For coding (like Python/ML), list out the exact data types, variables, and fully explain the functions of libraries like NumPy and Pandas including code syntax. For Mathematics, explicitly state the relevant formulas and exactly when/where they are used. This field must be rich enough that the user can learn the topic entirely from reading it.",
                        "questions": [
                            {"question": "A concept-checking question", "type": "recall", "hint": "A helpful hint or detailed answer to show in a popup"},
                            {"question": "A scenario-based question", "type": "application", "hint": "A helpful hint or detailed answer to show in a popup"}
                        ]
                    }
                ]
            },
            {
                "week_number": 2,
                "goal": "Goal for Week 2",
                "days": [
                    {
                        "day_number": 8,
                        "topic": "Title only for upcoming days",
                        "learning_objectives": [],
                        "youtube_video_url": "",
                        "reference_content": "CONTENT_NOT_GENERATED",
                        "questions": []
                    }
                ]
            }
        ]
    }
    
    IMPORTANT: 
    - You MUST generate the FULL outline (all days) for the requested duration.
    - However, you MUST only generate the deep content (`reference_content`, `youtube_video_url`, `questions` with `hint`) for **Week 1 (Days 1-7)**.
    - For all days in Week 2 and onwards, set `reference_content` to "CONTENT_NOT_GENERATED", `youtube_video_url` to "", and `questions` to an empty list [].
    - Ensure logical progression.
    - Return ONLY the JSON. No markdown formatting.
    """
    
    print(f"🚀 Generating roadmap for prompt: {prompt}")
    try:
        response = client.models.generate_content(
            model='gemini-2.0-flash',
            contents=f"{system_prompt}\n\nUser Goal: {prompt}",
            config=types.GenerateContentConfig(
                tools=[types.Tool(google_search=types.GoogleSearch())]
            )
        )
        
        # Clean up the response text - remove markdown code blocks if necessary
        text = response.text.strip()
        if text.startswith("```json"):
            text = text[7:]
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()

        print(f"✅ AI Response received: {text[:100]}...")
        
        try:
            # Let json_repair handle it directly, returning a Python object
            roadmap_data = json.loads(repair_json(text))
        except Exception as parse_err:
            print(f"❌ Critical JSON parsing failure even after repair: {parse_err}")
            print(f"Raw text generated: {text}")
            return {"error": f"Failed to parse AI response: {parse_err}"}

        roadmap_id = str(uuid.uuid4())
        
        # Add metadata
        roadmap_data["id"] = roadmap_id
        roadmap_data["session_id"] = session_id
        roadmap_data["created_at"] = datetime.now().isoformat()
        roadmap_data["status"] = "active"
        roadmap_data["days_completed"] = 0
        roadmap_data["progress_percentage"] = 0
        
        # Save to file
        save_roadmap(roadmap_data)
        
        return roadmap_data
    except Exception as e:
        print(f"Error generating roadmap: {e}")
        return {"error": str(e)}

def save_roadmap(roadmap: Dict[str, Any]):
    file_path = os.path.join(ROADMAPS_DIR, f"{roadmap['id']}.json")
    with open(file_path, "w") as f:
        json.dump(roadmap, f, indent=4)

def get_roadmap(roadmap_id: str) -> Optional[Dict[str, Any]]:
    file_path = os.path.join(ROADMAPS_DIR, f"{roadmap_id}.json")
    if os.path.exists(file_path):
        with open(file_path, "r") as f:
            return json.load(f)
    return None

def list_roadmaps(session_id: str) -> List[Dict[str, Any]]:
    roadmaps = []
    for filename in os.listdir(ROADMAPS_DIR):
        if filename.endswith(".json"):
            with open(os.path.join(ROADMAPS_DIR, filename), "r") as f:
                data = json.load(f)
                if data.get("session_id") == session_id:
                    roadmaps.append({
                        "id": data["id"],
                        "title": data["title"],
                        "progress": data["progress_percentage"],
                        "status": data["status"],
                        "created_at": data["created_at"]
                    })
    return roadmaps


def generate_day_content(roadmap_title: str, week_number: int, day: dict) -> Dict[str, Any]:
    """
    Generate deep content for a SINGLE day to avoid RESOURCE_EXHAUSTED errors
    that occur when generating all 7 days at once in one large API call.
    """
    day_prompt = f"""You are an expert educational consultant generating content for ONE specific day of a learning roadmap.

Roadmap: {roadmap_title}
Week {week_number}, Day {day['day_number']}: {day['topic']}

Generate a JSON object for this single day with these exact fields:
{{
    "day_number": {day['day_number']},
    "learning_objectives": ["objective 1", "objective 2", "objective 3"],
    "youtube_video_title": "Title of a real, relevant YouTube tutorial",
    "youtube_video_url": "https://www.youtube.com/watch?v=...",
    "reference_content": "A comprehensive, in-depth tutorial of at least 400 words. For coding topics: include exact syntax, data types, library functions with code examples. For math topics: include formulas, derivations, and worked examples. Write as if it is the primary learning material the student will read.",
    "questions": [
        {{"question": "A concept-checking question", "type": "recall", "hint": "Detailed answer/explanation"}},
        {{"question": "A scenario-based question", "type": "application", "hint": "Detailed answer/explanation"}}
    ]
}}

Return ONLY the JSON object. No markdown formatting, no extra text."""

    max_retries = 3
    retry_delay = 10  # base delay in seconds

    for attempt in range(max_retries):
        try:
            response = client.models.generate_content(
                model='gemini-2.0-flash',
                contents=day_prompt,
                config=types.GenerateContentConfig(
                    tools=[types.Tool(google_search=types.GoogleSearch())]
                )
            )
            text = response.text.strip()
            if text.startswith("```json"):
                text = text[7:]
            if text.endswith("```"):
                text = text[:-3]
            return {"success": True, "data": json.loads(repair_json(text))}
        except Exception as e:
            if "RESOURCE_EXHAUSTED" in str(e) and attempt < max_retries - 1:
                wait_time = retry_delay * (attempt + 1)
                print(f"  ⚠️ Quota hit for Day {day['day_number']}, retrying in {wait_time}s... (Attempt {attempt+1}/{max_retries})")
                time.sleep(wait_time)
                continue
            print(f"  ⚠️ Error generating content for Day {day['day_number']}: {e}")
            return {"success": False, "error": str(e)}


def generate_week_content(roadmap_id: str, week_number: int):
    """
    Generate deep content for all days in a specific week.
    Generates one day at a time to avoid Gemini RESOURCE_EXHAUSTED errors.
    Saves progress after each day so partial results are not lost.
    """
    roadmap = get_roadmap(roadmap_id)
    if not roadmap:
        return {"error": "Roadmap not found"}
    
    # Find the specific week
    target_week = next((w for w in roadmap["weeks"] if w["week_number"] == week_number), None)
    if not target_week:
        return {"error": f"Week {week_number} not found in roadmap outline"}

    print(f"🔄 Generating deep content for Week {week_number} of '{roadmap['title']}' (one day at a time)")
    
    errors = []
    error_details = {}
    for day in target_week["days"]:
        # Skip days that already have generated content
        existing_content = day.get("reference_content", "")
        if existing_content and existing_content not in ("CONTENT_NOT_GENERATED", ""):
            print(f"  ✅ Day {day['day_number']} already has content, skipping.")
            continue
        
        print(f"  📝 Generating Day {day['day_number']}: {day['topic']}")
        
        # Add a small delay between days to stay under RPM/TPM limits
        if day != target_week["days"][0]:
            time.sleep(2)
            
        result = generate_day_content(roadmap["title"], week_number, day)
        
        if result["success"]:
            new_day_data = result["data"]
            day.update({
                "learning_objectives": new_day_data.get("learning_objectives", []),
                "youtube_video_title": new_day_data.get("youtube_video_title", ""),
                "youtube_video_url": new_day_data.get("youtube_video_url", ""),
                "reference_content": new_day_data.get("reference_content", ""),
                "questions": new_day_data.get("questions", [])
            })
            # Save after each successful day so progress is preserved on partial failures
            save_roadmap(roadmap)
            print(f"  ✅ Day {day['day_number']} done and saved.")
        else:
            errors.append(str(day["day_number"]))
            error_details[str(day["day_number"])] = result["error"]

    if errors:
        print(f"⚠️ Week {week_number} generation finished with failures on days: {', '.join(errors)}")
        return {
            "status": "partial", 
            "week_number": week_number, 
            "failed_days": errors, 
            "error_details": error_details,
            "roadmap": roadmap
        }
    
    print(f"✅ Week {week_number} content generation complete!")
    return {"status": "success", "week_number": week_number, "roadmap": roadmap}


def update_progress(roadmap_id: str, day_number: int):
    roadmap = get_roadmap(roadmap_id)
    if roadmap:
        # Simple progress tracking: mark day as completed
        # This can be expanded to track specific day completion
        if "completed_days" not in roadmap:
            roadmap["completed_days"] = []
        
        if day_number not in roadmap["completed_days"]:
            roadmap["completed_days"].append(day_number)
            roadmap["days_completed"] = len(roadmap["completed_days"])
            roadmap["progress_percentage"] = (roadmap["days_completed"] / roadmap["total_days"]) * 100
            save_roadmap(roadmap)
        return roadmap
    return None
