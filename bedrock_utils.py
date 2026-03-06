import base64
import os
from typing import List, Union
import boto3
from dotenv import load_dotenv

load_dotenv(override=True)

AWS_REGION = os.getenv("AWS_REGION", "us-east-1")
BEDROCK_MODEL_ID = os.getenv("BEDROCK_MODEL_ID", "amazon.nova-2-lite-v1:0")

bedrock_runtime = boto3.client("bedrock-runtime", region_name=AWS_REGION)


def _normalize_messages(messages: List[Union[str, dict, object]]) -> str:
    parts = []

    for msg in messages:
        if isinstance(msg, str):
            parts.append(msg)
            continue

        if isinstance(msg, dict):
            role = msg.get("role", "user").upper()
            content = msg.get("content", "")
            parts.append(f"{role}: {content}")
            continue

        role = getattr(msg, "type", None) or msg.__class__.__name__.replace("Message", "").lower()
        content = getattr(msg, "content", "")
        parts.append(f"{str(role).upper()}: {content}")

    return "\n\n".join(parts).strip()


def _guess_image_format(image_bytes: bytes) -> str:
    if image_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if image_bytes.startswith(b"\xff\xd8\xff"):
        return "jpeg"
    if image_bytes.startswith(b"GIF87a") or image_bytes.startswith(b"GIF89a"):
        return "gif"
    if image_bytes[:4] == b"RIFF" and image_bytes[8:12] == b"WEBP":
        return "webp"
    return "jpeg"


def invoke_bedrock_text(
    prompt_or_messages,
    temperature: float = 0.2,
    max_tokens: int = 2000
) -> str:
    prompt = (
        prompt_or_messages
        if isinstance(prompt_or_messages, str)
        else _normalize_messages(prompt_or_messages)
    )

    response = bedrock_runtime.converse(
        modelId=BEDROCK_MODEL_ID,
        messages=[
            {
                "role": "user",
                "content": [
                    {"text": prompt}
                ]
            }
        ],
        inferenceConfig={
            "temperature": temperature,
            "maxTokens": max_tokens
        }
    )

    content_blocks = response.get("output", {}).get("message", {}).get("content", [])
    texts = []

    for block in content_blocks:
        if "text" in block:
            texts.append(block["text"])

    return "\n".join(texts).strip()


def invoke_bedrock_multimodal(
    prompt: str,
    images_base64: List[str],
    temperature: float = 0.2,
    max_tokens: int = 2000
) -> str:
    content_blocks = [{"text": prompt}]

    for img_b64 in images_base64:
        image_bytes = base64.b64decode(img_b64)
        image_format = _guess_image_format(image_bytes)

        content_blocks.append({
            "image": {
                "format": image_format,
                "source": {
                    "bytes": image_bytes
                }
            }
        })

    response = bedrock_runtime.converse(
        modelId=BEDROCK_MODEL_ID,
        messages=[
            {
                "role": "user",
                "content": content_blocks
            }
        ],
        inferenceConfig={
            "temperature": temperature,
            "maxTokens": max_tokens
        }
    )

    content_blocks = response.get("output", {}).get("message", {}).get("content", [])
    texts = []

    for block in content_blocks:
        if "text" in block:
            texts.append(block["text"])

    return "\n".join(texts).strip()