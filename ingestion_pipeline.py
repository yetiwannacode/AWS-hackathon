import os
import json
from typing import List
from topic_mapper import group_elements_by_topic
from unstructured.partition.pdf import partition_pdf
from unstructured.chunking.title import chunk_by_title
from langchain_core.documents import Document
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_chroma import Chroma
from bedrock_utils import invoke_bedrock_multimodal
from dotenv import load_dotenv
from tenacity import (
    retry,
    stop_after_attempt,
    wait_exponential,
    retry_if_exception_type
)
import concurrent.futures
import threading

# Global semaphore to limit TOTAL concurrent API calls across all files
api_semaphore = threading.BoundedSemaphore(3)

load_dotenv(override=True)

# --- CONFIGURATION ---
LOCAL_EMBEDDINGS = HuggingFaceEmbeddings(model_name="sentence-transformers/all-MiniLM-L6-v2")
CHROMA_PATH = "./chroma_db"


def get_file_timestamp(file_path: str) -> float:
    """Returns the creation time of the file."""
    try:
        return os.path.getctime(file_path)
    except Exception:
        return 0.0


def is_valid_pdf(file_path: str) -> bool:
    try:
        with open(file_path, "rb") as f:
            header = f.read(5)
        return header == b"%PDF-"
    except Exception:
        return False


def partitioning_documents(file_path: str):
    """Safely extract elements from PDF with fallback strategies."""
    print(f"📄 Partitioning: {file_path}")

    if not is_valid_pdf(file_path):
        print(f"❌ Skipping invalid PDF: {file_path}")
        return []

    try:
        # Primary (best quality)
        return partition_pdf(
            filename=file_path,
            strategy="hi_res",
            infer_table_structure=True,
            extract_image_block_types=["Image"],
            extract_image_block_to_payload=True,
        )

    except Exception as e:
        print(f"⚠️ hi_res failed, falling back: {e}")

        try:
            # Fallback (text-only, more stable)
            return partition_pdf(
                filename=file_path,
                strategy="fast",
            )
        except Exception as e:
            print(f"❌ Failed to process PDF entirely: {e}")
            return []


def create_chunks_by_title(elements):
    """Uses title-based chunking."""
    return chunk_by_title(
        elements,
        max_characters=3000,
        new_after_n_chars=2400,
        combine_text_under_n_chars=500
    )


def separate_content_types(chunk):
    """Helper to extract text, tables, and images from Unstructured chunks."""
    content_data = {
        'text': getattr(chunk, "text", "") or "",
        'tables': [],
        'images': [],
        'types': ['text']
    }

    if hasattr(chunk, 'metadata') and hasattr(chunk.metadata, 'orig_elements'):
        for element in chunk.metadata.orig_elements:
            element_type = type(element).__name__

            if element_type == 'Table':
                content_data['types'].append('table')
                content_data['tables'].append(
                    getattr(element.metadata, 'text_as_html', getattr(element, "text", ""))
                )

            elif element_type == 'Image' and hasattr(element.metadata, 'image_base64'):
                img_b64 = element.metadata.image_base64
                if len(img_b64) > 10000:
                    content_data['types'].append('image')
                    content_data['images'].append(img_b64)
                else:
                    print("🔍 Skipping small image/icon to save API quota.")

    content_data['types'] = list(set(content_data['types']))
    return content_data


@retry(
    stop=stop_after_attempt(10),
    wait=wait_exponential(multiplier=1, min=4, max=60),
    retry=retry_if_exception_type(Exception),
    before_sleep=lambda retry_state: print(
        f"⚠️ API Limit hit. Retrying in {retry_state.next_action.sleep} seconds..."
    )
)
def create_batch_ai_summaries(batch_contents: List[dict]) -> List[str]:
    with api_semaphore:
        summaries = []

        for content in batch_contents:
            prompt = (
                "You are an expert at analyzing mixed-content chunks from technical documents.\n"
                "Provide a concise summary capturing the key facts and concepts.\n\n"
                f"TEXT:\n{content['text']}\n"
            )

            if content["tables"]:
                prompt += "\nTABLES:\n" + "\n".join(content["tables"])

            try:
                response = invoke_bedrock_multimodal(
                    prompt,
                    content["images"]
                )
                summaries.append(response.strip())

            except Exception as e:
                print(f"⚠️ Bedrock multimodal failed: {e}")
                summaries.append(content["text"])

        return summaries


def is_already_ingested(filename: str, session_id: str) -> bool:
    """Checks ChromaDB to see if this file has already been processed for this session."""
    try:
        db = Chroma(
            persist_directory=CHROMA_PATH,
            embedding_function=LOCAL_EMBEDDINGS,
            collection_name="hackathon_collection"
        )
        results = db.get(where={"$and": [{"source": filename}, {"session_id": session_id}]})
        return len(results.get("ids", [])) > 0
    except Exception:
        return False


class SimpleChunk:
    """Fallback chunk object when chunk_by_title returns nothing."""
    def __init__(self, text: str):
        self.text = text
        self.metadata = type("Meta", (), {"orig_elements": []})()


def process_files_to_docs(directory_path: str) -> List[Document]:
    """Iterates through all PDFs in the session directory with batching, locking, and checkpointing."""
    all_docs = []
    session_id = os.path.basename(directory_path)

    files = [f for f in os.listdir(directory_path) if f.lower().endswith(".pdf")]
    total_files = len(files)

    print(f"🚀 Starting ingestion for {total_files} files in session {session_id}")

    for idx, filename in enumerate(files):
        print(f"\n--- 📄 Processing File {idx + 1}/{total_files}: {filename} ---")

        if is_already_ingested(filename, session_id):
            print(f"⏭️ Skipping {filename}: Already fully ingested in this session.")
            continue

        file_path = os.path.join(directory_path, filename)

        # 1. Partition
        elements = partitioning_documents(file_path)
        print(f"DEBUG {filename}: elements count = {len(elements)}")
        if elements:
            print("DEBUG first 5 element types =", [type(e).__name__ for e in elements[:5]])

        if not elements:
            print(f"⚠️ Skipping {filename}: No elements extracted.")
            continue

        # 2. Map elements to topics
        topics = group_elements_by_topic(elements)
        print(f"DEBUG {filename}: topics count = {len(topics)}")
        if topics:
            print("DEBUG topic titles =", [t.get('title') for t in topics[:10]])

        # Fallback: if no topics found, treat the whole file as one topic
        if not topics:
            fallback_title = os.path.splitext(filename)[0]
            print(f"⚠️ No topics found for {filename}. Falling back to one topic: {fallback_title}")
            topics = [{
                "title": fallback_title,
                "elements": elements
            }]

        for topic in topics:
            topic_title = topic["title"]
            topic_elements = topic["elements"]

            # 3. Chunk elements within topic
            chunks = create_chunks_by_title(topic_elements)
            print(f"DEBUG topic '{topic_title}': chunks count = {len(chunks)}")

            # Fallback: if no chunks found, create one raw text chunk
            if not chunks:
                raw_text = "\n".join(
                    [getattr(el, "text", "") for el in topic_elements if getattr(el, "text", "").strip()]
                ).strip()

                if raw_text:
                    print(f"⚠️ No chunks found for topic '{topic_title}'. Falling back to one raw chunk.")
                    chunks = [SimpleChunk(raw_text)]
                else:
                    print(f"⚠️ Topic '{topic_title}' has no usable text. Skipping topic.")
                    continue

            # 4. Prepare contents and identify multimodal chunks
            chunk_data_list = []
            multimodal_indices = []

            for chunk in chunks:
                content = separate_content_types(chunk)
                content['parent_topic'] = topic_title
                chunk_data_list.append(content)

                if len(content['types']) > 1:
                    multimodal_indices.append(len(chunk_data_list) - 1)

            print(f"DEBUG topic '{topic_title}': chunk_data_list count = {len(chunk_data_list)}")

            # 5. Process multimodal chunks in batches
            batch_size = 5
            if multimodal_indices:
                print(f"🤖 Processing {len(multimodal_indices)} multimodal chunks in topic: {topic_title}...")

                batches = []
                for i in range(0, len(multimodal_indices), batch_size):
                    batch_idxs = multimodal_indices[i:i + batch_size]
                    batches.append((batch_idxs, [chunk_data_list[idx] for idx in batch_idxs]))

                def process_batch(batch_data):
                    idxs, contents = batch_data
                    summaries = create_batch_ai_summaries(contents)
                    return idxs, summaries

                with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
                    results = list(executor.map(process_batch, batches))

                    for batch_idxs, summaries in results:
                        for idx2, summary in zip(batch_idxs, summaries):
                            chunk_data_list[idx2]['ai_summary'] = summary

            # 6. Convert to LangChain Documents
            for content in chunk_data_list:
                raw_text = content['text']
                ai_summary = content.get('ai_summary', '')

                if not raw_text.strip() and not ai_summary.strip():
                    print(f"⚠️ Empty content found in topic '{topic_title}', skipping one chunk.")
                    continue

                if ai_summary:
                    indexed_content = f"TOPIC: {topic_title}\nSUMMARY: {ai_summary}\n\nORIGINAL TEXT: {raw_text}"
                else:
                    indexed_content = f"TOPIC: {topic_title}\n\n{raw_text}"

                doc = Document(
                    page_content=indexed_content,
                    metadata={
                        "session_id": session_id,
                        "source": filename,
                        "parent_topic": topic_title,
                        "timestamp": get_file_timestamp(file_path),
                        "original_content": json.dumps({
                            "raw_text": raw_text,
                            "tables_html": content['tables'],
                            "images_base64": content['images']
                        })
                    }
                )
                all_docs.append(doc)

        print(f"DEBUG after file '{filename}': total docs so far = {len(all_docs)}")

    print(f"DEBUG total docs created for session {session_id} = {len(all_docs)}")
    return all_docs


def create_vector_store(documents: List[Document]):
    """Stores documents in a persistent local ChromaDB."""
    print(f"Storing {len(documents)} chunks in ChromaDB...")
    return Chroma.from_documents(
        documents=documents,
        embedding=LOCAL_EMBEDDINGS,
        persist_directory=CHROMA_PATH,
        collection_name="hackathon_collection"
    )


def ingest_directory(directory_path: str):
    """Function called by FastAPI backend."""
    processed_docs = process_files_to_docs(directory_path)

    if processed_docs:
        create_vector_store(processed_docs)
        print(f"Successfully ingested session: {os.path.basename(directory_path)}")
    else:
        print("No valid documents found for ingestion.")


if __name__ == "__main__":
    TEST_DIR = "./docs"
    if os.path.exists(TEST_DIR):
        print(f"🚀 Starting standalone test ingestion for: {TEST_DIR}")
        ingest_directory(TEST_DIR)
    else:
        print(f"⚠️ Test directory {TEST_DIR} not found. Please create it and add PDFs to test.")