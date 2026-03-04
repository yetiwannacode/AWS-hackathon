import json
from json_repair import repair_json
import os
import time
import uuid
from urllib.parse import quote_plus
from urllib.parse import urlparse, parse_qs
from urllib.request import urlopen
from urllib.error import URLError, HTTPError
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

DSA_KEYWORDS = [
    "dsa", "data structure", "data structures", "algorithm", "algorithms",
    "array", "string", "linked list", "stack", "queue", "tree", "graph",
    "heap", "hash", "dynamic programming", "recursion", "greedy", "backtracking",
    "sliding window", "two pointers", "binary search"
]

CODING_KEYWORDS = [
    "code", "coding", "programming", "developer", "software engineer",
    "python", "java", "javascript", "typescript", "c++", "c#", "go", "rust",
    "sql", "react", "node", "django", "flask", "api", "git", "linux",
    "machine learning", "data science", "computer science", "web development"
]

ENGINEERING_PRODUCTIVITY_KEYWORDS = [
    "engineering", "software engineering", "developer productivity", "productivity",
    "dev productivity", "engineering productivity", "devops", "ci/cd", "ci cd",
    "system design", "microservices", "backend", "frontend", "full stack",
    "architecture", "clean code", "code review", "testing", "debugging"
]

HACKERRANK_TOPIC_URLS = {
    "python": "https://www.hackerrank.com/domains/python",
    "sql": "https://www.hackerrank.com/domains/sql",
    "java": "https://www.hackerrank.com/domains/java",
    "javascript": "https://www.hackerrank.com/domains/tutorials/10-days-of-javascript",
    "cpp": "https://www.hackerrank.com/domains/cpp",
    "c++": "https://www.hackerrank.com/domains/cpp",
    "algorithms": "https://www.hackerrank.com/domains/algorithms",
    "data structures": "https://www.hackerrank.com/domains/data-structures"
}

LEETCODE_TOPIC_SLUGS = {
    "array": "array",
    "string": "string",
    "linked list": "linked-list",
    "stack": "stack",
    "queue": "queue",
    "tree": "tree",
    "graph": "graph",
    "heap": "heap-priority-queue",
    "hash": "hash-table",
    "dynamic programming": "dynamic-programming",
    "recursion": "recursion",
    "backtracking": "backtracking",
    "binary search": "binary-search",
    "two pointers": "two-pointers",
    "sliding window": "sliding-window",
}

PREFERRED_CODING_YT_CHANNELS = [
    "Apna College",
    "Coding with Harry",
    "freeCodeCamp.org",
]


def _normalize_text(*parts: str) -> str:
    return " ".join([str(p or "").lower() for p in parts]).strip()


def _contains_any(text: str, keywords: List[str]) -> bool:
    return any(keyword in text for keyword in keywords)


def _infer_practice_source(roadmap_title: str, day: Dict[str, Any]) -> str:
    content = _normalize_text(
        roadmap_title,
        day.get("topic", ""),
        " ".join(day.get("learning_objectives", []) or [])
    )
    if _contains_any(content, DSA_KEYWORDS):
        return "leetcode"
    if _contains_any(content, CODING_KEYWORDS):
        return "hackerrank"
    return ""


def _build_practice_url(source: str, day: Dict[str, Any]) -> str:
    topic = _normalize_text(day.get("topic", ""), " ".join(day.get("learning_objectives", []) or []))
    if source == "leetcode":
        for key, slug in LEETCODE_TOPIC_SLUGS.items():
            if key in topic:
                return f"https://leetcode.com/problemset/?topicSlugs={slug}"
        return "https://leetcode.com/problemset/"

    if source == "hackerrank":
        for key, url in HACKERRANK_TOPIC_URLS.items():
            if key in topic:
                return url
        return "https://www.hackerrank.com/dashboard"

    return ""


def _build_fallback_practice_question(day: Dict[str, Any]) -> Dict[str, str]:
    topic = day.get("topic", "this topic")
    ai_questions = day.get("questions", []) or []
    for q in ai_questions:
        question_text = (q or {}).get("question", "").strip()
        if question_text:
            return {
                "question": question_text,
                "hint": (q or {}).get("hint", "").strip() or "Break the problem into smaller steps first."
            }
    return {
        "question": f"Write a function that demonstrates your understanding of {topic}. Include at least one edge case and explain your approach.",
        "hint": "Start with a brute-force solution, then optimize and test with edge cases."
    }


def _build_youtube_search_url(query: str) -> str:
    return f"https://www.youtube.com/results?search_query={quote_plus(query)}"


def _looks_like_youtube_url(url: str) -> bool:
    value = (url or "").lower()
    return "youtube.com" in value or "youtu.be" in value


def _extract_youtube_video_id(url: str) -> str:
    try:
        parsed = urlparse(url)
        host = (parsed.netloc or "").lower()
        path = parsed.path or ""
        if "youtu.be" in host:
            return path.lstrip("/").split("/")[0]
        if "youtube.com" in host:
            if path == "/watch":
                return (parse_qs(parsed.query).get("v") or [""])[0]
            if path.startswith("/shorts/") or path.startswith("/embed/"):
                return path.split("/")[2] if len(path.split("/")) > 2 else ""
    except Exception:
        return ""
    return ""


def _is_youtube_video_available(url: str) -> bool:
    if not _looks_like_youtube_url(url):
        return False
    if "results?search_query=" in (url or ""):
        return True
    video_id = _extract_youtube_video_id(url)
    if not video_id:
        return False
    oembed_url = f"https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={video_id}&format=json"
    try:
        with urlopen(oembed_url, timeout=4) as resp:
            status = getattr(resp, "status", 200)
            return status == 200
    except (HTTPError, URLError, TimeoutError, ValueError):
        return False


def _clean_topic_query(topic: str) -> str:
    cleaned = " ".join(str(topic or "").split()).strip()
    lowered = cleaned.lower()
    if lowered.endswith(" tutorial"):
        cleaned = cleaned[: -len(" tutorial")].strip()
    return cleaned


def _normalize_day_youtube_fields(roadmap_title: str, day: Dict[str, Any], fallback_topic: str = "") -> None:
    content = _normalize_text(
        roadmap_title,
        day.get("topic", "") or fallback_topic,
        " ".join(day.get("learning_objectives", []) or [])
    )
    is_coding_topic = _contains_any(content, CODING_KEYWORDS) or _contains_any(content, DSA_KEYWORDS)
    topic = _clean_topic_query(day.get("topic", "") or fallback_topic or "coding")
    current_title = (day.get("youtube_video_title") or "").strip()
    current_url = (day.get("youtube_video_url") or "").strip()
    current_url_valid = bool(current_url and _is_youtube_video_available(current_url))

    if is_coding_topic:
        # Keep existing URL only if it is currently valid.
        if current_url_valid:
            day["youtube_search_term"] = topic
            return

        # Fallback is exact-topic search so results stay relevant and avoid dead links.
        exact_query = topic
        day["youtube_search_term"] = exact_query
        day["youtube_video_url"] = _build_youtube_search_url(exact_query)
        if not current_title:
            day["youtube_video_title"] = f"{topic} - Top YouTube result"
        day["youtube_channel_priority"] = PREFERRED_CODING_YT_CHANNELS
        return

    if current_url_valid:
        if not day.get("youtube_search_term"):
            day["youtube_search_term"] = topic
        return

    generic_query = f"{topic} tutorial"
    day["youtube_search_term"] = generic_query
    day["youtube_video_url"] = _build_youtube_search_url(generic_query)
    if not current_title:
        day["youtube_video_title"] = f"{topic} - Top YouTube results"


def _normalize_day_practice_fields(roadmap_title: str, day: Dict[str, Any]) -> None:
    source = (day.get("practice_source") or "").strip().lower()
    inferred_source = _infer_practice_source(roadmap_title, day)
    if source not in ("hackerrank", "leetcode", "ai_generated"):
        source = inferred_source

    practice_url = (day.get("practice_url") or "").strip()
    is_coding_topic = bool(inferred_source)

    if is_coding_topic and not practice_url and source in ("hackerrank", "leetcode"):
        practice_url = _build_practice_url(source, day)

    practice_question = day.get("practice_question")
    if is_coding_topic and not practice_url:
        if not isinstance(practice_question, dict) or not practice_question.get("question"):
            practice_question = _build_fallback_practice_question(day)
        source = "ai_generated"
    elif not is_coding_topic:
        practice_question = None
        source = ""

    day["practice_source"] = source
    day["practice_url"] = practice_url
    day["practice_question"] = practice_question


def _normalize_roadmap_practice_fields(roadmap_data: Dict[str, Any]) -> None:
    roadmap_title = roadmap_data.get("title", "")
    for week in roadmap_data.get("weeks", []) or []:
        for day in week.get("days", []) or []:
            _normalize_day_youtube_fields(roadmap_title, day)
            _normalize_day_practice_fields(roadmap_title, day)


def _is_engineering_productivity_request(prompt: str, roadmap_data: Dict[str, Any]) -> bool:
    combined = _normalize_text(
        prompt,
        roadmap_data.get("title", ""),
        roadmap_data.get("description", "")
    )
    return _contains_any(combined, CODING_KEYWORDS) or _contains_any(combined, ENGINEERING_PRODUCTIVITY_KEYWORDS)


def _extract_all_days(roadmap_data: Dict[str, Any]) -> List[Dict[str, Any]]:
    days: List[Dict[str, Any]] = []
    for week in roadmap_data.get("weeks", []) or []:
        for day in week.get("days", []) or []:
            if isinstance(day, dict):
                days.append(day)
    return days


def _build_default_interview_questions(topic: str) -> List[Dict[str, str]]:
    prompts = [
        "How would you explain the core concepts of {topic} to a junior engineer?",
        "What are the most common mistakes teams make when implementing {topic}?",
        "Which trade-offs matter most when designing a solution using {topic}?",
        "How do you evaluate whether a {topic} solution is scalable?",
        "What metrics would you track to measure success for {topic} in production?",
        "How would you debug a production issue related to {topic}?",
        "What are the security concerns to keep in mind with {topic}?",
        "How do you test systems built around {topic}?",
        "How would you optimize performance in a system that uses {topic} heavily?",
        "When would you avoid using {topic}, and why?",
        "How does {topic} affect developer productivity in a team environment?",
        "How would you roll out a major change involving {topic} safely?",
        "What failure modes should you anticipate with {topic}?",
        "How would you design observability for a platform centered on {topic}?",
        "How do you reason about reliability and availability in {topic}-driven systems?",
        "How would you mentor a new hire to become productive with {topic}?",
        "What design patterns are commonly used with {topic}, and when?",
        "How would you estimate effort for a project focused on {topic}?",
        "How do you balance short-term delivery and long-term maintainability in {topic}?",
        "Which code review checks are most important for {topic}-related changes?",
        "How would you design an interview problem to assess knowledge of {topic}?",
        "What are practical ways to improve team workflow using {topic}?",
        "How do you handle technical debt around {topic}?",
        "How do you ensure documentation quality for {topic}-centric systems?",
        "How would you benchmark two approaches to {topic} objectively?",
        "What anti-patterns have you seen in {topic} implementations?",
        "How do architectural decisions influence the success of {topic} adoption?",
        "How would you communicate complex {topic} decisions to non-technical stakeholders?",
        "How do you choose tools and libraries for {topic} in a new project?",
        "What advanced interview question about {topic} do you find most revealing, and why?"
    ]
    return [{"question": p.format(topic=topic), "type": "interview", "hint": "Focus on practical trade-offs and real-world examples."} for p in prompts]


def _generate_interview_questions(topic: str, user_prompt: str) -> List[Dict[str, str]]:
    interview_prompt = f"""Generate exactly 30 software engineering interview questions in strict JSON.

Topic: {topic}
User goal: {user_prompt}

Output format:
{{
  "questions": [
    {{"question": "question text", "type": "interview", "hint": "short guidance"}}
  ]
}}

Rules:
- Return exactly 30 unique, highly repeated and relevant interview questions for the topic.
- Keep each question concise and interview-ready.
- Keep hints short (one sentence).
- `type` must always be `interview`.
- Return only JSON with the top-level key `questions`.
"""
    try:
        response = client.models.generate_content(
            model='gemini-2.0-flash',
            contents=interview_prompt
        )
        text = (response.text or "").strip()
        if text.startswith("```json"):
            text = text[7:]
        if text.endswith("```"):
            text = text[:-3]
        parsed = json.loads(repair_json(text))
        raw_questions = parsed.get("questions", []) if isinstance(parsed, dict) else []
        normalized: List[Dict[str, str]] = []
        seen = set()
        for entry in raw_questions:
            q = (entry or {}).get("question", "").strip()
            if not q:
                continue
            key = q.lower()
            if key in seen:
                continue
            seen.add(key)
            hint = (entry or {}).get("hint", "").strip() or "Explain using a practical, production-oriented example."
            normalized.append({"question": q, "type": "interview", "hint": hint})
            if len(normalized) == 30:
                break

        if len(normalized) < 30:
            fallback = _build_default_interview_questions(topic)
            for item in fallback:
                key = item["question"].strip().lower()
                if key in seen:
                    continue
                seen.add(key)
                normalized.append(item)
                if len(normalized) == 30:
                    break
        return normalized[:30]
    except Exception as err:
        print(f"⚠️ Interview question generation failed, using fallback list: {err}")
        return _build_default_interview_questions(topic)


def _apply_engineering_interview_last_day_rule(roadmap_data: Dict[str, Any], user_prompt: str) -> None:
    if not _is_engineering_productivity_request(user_prompt, roadmap_data):
        return

    all_days = _extract_all_days(roadmap_data)
    if not all_days:
        return

    last_day = max(all_days, key=lambda d: int(d.get("day_number", 0)))
    topic = roadmap_data.get("title") or user_prompt or "Software Engineering"
    interview_questions = _generate_interview_questions(topic, user_prompt)

    last_day["topic"] = f"{topic} - Interview Questions"
    last_day["learning_objectives"] = [
        "Practice high-frequency interview questions",
        "Strengthen explanation depth and trade-off reasoning",
        "Build confidence for real interview rounds"
    ]
    last_day["youtube_video_title"] = ""
    last_day["youtube_video_url"] = ""
    last_day["youtube_search_term"] = ""
    last_day["youtube_fallback_url"] = ""
    last_day["practice_source"] = "ai_generated"
    last_day["practice_url"] = ""
    last_day["practice_question"] = None
    last_day["reference_content"] = (
        "Interview-only day. Focus on solving and explaining the 30 questions below. "
        "Practice concise answers, trade-offs, and production examples."
    )
    last_day["questions"] = interview_questions

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
                        "practice_source": "hackerrank | leetcode | ai_generated | ''",
                        "practice_url": "URL to a relevant practice page. Use HackerRank for most CS/coding courses, but use LeetCode for DSA-focused topics. Leave empty only when no suitable link exists.",
                        "practice_question": {"question": "Fallback coding question when no URL can be found", "hint": "How to approach it"} or null,
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
                        "practice_source": "",
                        "practice_url": "",
                        "practice_question": null,
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
    - For coding/computer-science courses:
      - YouTube recommendations must prioritize videos from these channels first: Apna College, Coding with Harry, freeCodeCamp.org.
      - If no suitable video from those channels is found for the exact topic, choose the next best top YouTube result for the exact day heading.
      - Validate that suggested video URLs are currently available; avoid broken/unavailable links.
      - Use HackerRank links by default (`practice_source = "hackerrank"`).
      - If the topic is DSA-focused, prefer LeetCode (`practice_source = "leetcode"`).
      - If you cannot find a reliable practice link, set `practice_url` to "" and provide `practice_source = "ai_generated"` with a good `practice_question`.
    - For non-coding topics, keep `practice_source` empty and `practice_question` null.
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
            _normalize_roadmap_practice_fields(roadmap_data)
            _apply_engineering_interview_last_day_rule(roadmap_data, prompt)
        except Exception as parse_err:
            print(f"❌ Critical JSON parsing failure even after repair: {parse_err}")
            print(f"Raw text generated: {text}")
            return {"error": f"Failed to parse AI response: {parse_err}"}

        roadmap_id = str(uuid.uuid4())
        
        # Add metadata
        roadmap_data["id"] = roadmap_id
        roadmap_data["session_id"] = session_id
        roadmap_data["owner_user_key"] = session_id
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
                owner_key = data.get("owner_user_key") or data.get("session_id")
                if owner_key == session_id:
                    roadmaps.append({
                        "id": data["id"],
                        "title": data["title"],
                        "progress": data["progress_percentage"],
                        "status": data["status"],
                        "created_at": data["created_at"]
                    })
    return roadmaps


def roadmap_belongs_to_user(roadmap: Dict[str, Any], user_key: str) -> bool:
    owner_key = roadmap.get("owner_user_key") or roadmap.get("session_id")
    return owner_key == user_key


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
    "practice_source": "hackerrank | leetcode | ai_generated | ''",
    "practice_url": "Practice link based on topic/platform",
    "practice_question": {{"question": "Fallback coding question when no link can be found", "hint": "How to approach it"}} or null,
    "reference_content": "A comprehensive, in-depth tutorial of at least 400 words. For coding topics: include exact syntax, data types, library functions with code examples. For math topics: include formulas, derivations, and worked examples. Write as if it is the primary learning material the student will read.",
    "questions": [
        {{"question": "A concept-checking question", "type": "recall", "hint": "Detailed answer/explanation"}},
        {{"question": "A scenario-based question", "type": "application", "hint": "Detailed answer/explanation"}}
    ]
}}

IMPORTANT for practice fields:
- For coding/computer-science topics, use HackerRank as default (`practice_source = "hackerrank"`).
- If this day is DSA-focused, use LeetCode (`practice_source = "leetcode"`).
- If no reliable URL can be found, set `practice_url` to "" and provide `practice_source = "ai_generated"` with a meaningful `practice_question`.
- If it's not a coding topic, keep practice fields empty (`practice_source = ""`, `practice_url = ""`, `practice_question = null`).

    IMPORTANT for YouTube recommendation:
- For coding/computer-science topics, prioritize these channels in order: Apna College, Coding with Harry, freeCodeCamp.org.
- If none of those channels has a suitable topic-specific video, choose the next top relevant YouTube result for the exact day heading.
- Always provide a currently available working YouTube link. Do not return unavailable/deleted videos.

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
            day_data = json.loads(repair_json(text))
            _normalize_day_youtube_fields(roadmap_title, day_data, fallback_topic=day.get("topic", ""))
            _normalize_day_practice_fields(roadmap_title, day_data)
            return {"success": True, "data": day_data}
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
                "youtube_search_term": new_day_data.get("youtube_search_term", day.get("topic", "")),
                "youtube_fallback_url": new_day_data.get("youtube_fallback_url", ""),
                "practice_source": new_day_data.get("practice_source", ""),
                "practice_url": new_day_data.get("practice_url", ""),
                "practice_question": new_day_data.get("practice_question"),
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
