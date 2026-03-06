import json
import os
from typing import List, Union
import boto3
from dotenv import load_dotenv

load_dotenv(override=True)

AWS_REGION = os.getenv("AWS_REGION", "ap-southeast-2")
BEDROCK_MODEL_ID = os.getenv("BEDROCK_MODEL_ID", "amazon.nova-lite-v1:0")

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

        # LangChain HumanMessage / SystemMessage style
        role = getattr(msg, "type", None) or msg.__class__.__name__.replace("Message", "").lower()
        content = getattr(msg, "content", "")
        parts.append(f"{str(role).upper()}: {content}")

    return "\n\n".join(parts).strip()


def invoke_bedrock_text(prompt_or_messages, temperature: float = 0.2, max_tokens: int = 2000) -> str:
    prompt = (
        prompt_or_messages
        if isinstance(prompt_or_messages, str)
        else _normalize_messages(prompt_or_messages)
    )

    body = {
        "messages": [
            {
                "role": "user",
                "content": [{"text": prompt}]
            }
        ],
        "inferenceConfig": {
            "temperature": temperature,
            "maxTokens": max_tokens
        }
    }

    response = bedrock_runtime.invoke_model(
        modelId=BEDROCK_MODEL_ID,
        body=json.dumps(body),
        contentType="application/json",
        accept="application/json"
    )

    response_body = json.loads(response["body"].read())
    output_message = response_body.get("output", {}).get("message", {})
    content = output_message.get("content", [])

    texts = []
    for item in content:
        if "text" in item:
            texts.append(item["text"])

    return "\n".join(texts).strip()
