import os
import json
import re
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
# Tier 1 has 2000 RPM but 1M TPM. Keeping this low prevents hitting the TPM limit with large chunks.
api_semaphore = threading.BoundedSemaphore(3)
# Note: Google's 429 error is often wrapped in an InternalServerError or similar in LangChain,
# but we can retry on general exceptions if they look like rate limits.

load_dotenv(override=True)

# --- CONFIGURATION ---
# Using local embeddings to avoid 429 rate limits during bulk upload

LOCAL_EMBEDDINGS = HuggingFaceEmbeddings(model_name="sentence-transformers/all-MiniLM-L6-v2")
CHROMA_PATH = "./chroma_db"

# --- CORE FUNCTIONS (Replicated from your notebook) ---

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
            # Fallback (text-only, very stable)
            return partition_pdf(
                filename=file_path,
                strategy="fast",
            )
        except Exception as e:
            print(f"❌ Failed to process PDF entirely: {e}")
            return []


def create_chunks_by_title(elements):
    """Uses your specific chunking strategy from the notebook."""
    return chunk_by_title(
        elements,
        max_characters=3000,
        new_after_n_chars=2400,
        combine_text_under_n_chars=500
    )

def separate_content_types(chunk):
    """Helper to extract text, tables, and images from Unstructured chunks."""
    content_data = {'text': chunk.text, 'tables': [], 'images': [], 'types': ['text']}
    if hasattr(chunk, 'metadata') and hasattr(chunk.metadata, 'orig_elements'):
        for element in chunk.metadata.orig_elements:
            element_type = type(element).__name__
            if element_type == 'Table':
                content_data['types'].append('table')
                content_data['tables'].append(getattr(element.metadata, 'text_as_html', element.text))
            elif element_type == 'Image' and hasattr(element.metadata, 'image_base64'):
                img_b64 = element.metadata.image_base64
                # --- FILTERING: Skip small icons/logos (< 10KB base64) to save Gemini quota ---
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
    before_sleep=lambda retry_state: print(f"⚠️ API Limit hit. Retrying in {retry_state.next_action.sleep} seconds...")
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
        return len(results['ids']) > 0
    except Exception:
        return False

def process_files_to_docs(directory_path: str) -> List[Document]:
    """Iterates through all PDFs in the session directory with batching, locking, and checkpointing."""
    all_docs = []
    session_id = os.path.basename(directory_path)
    
    files = [f for f in os.listdir(directory_path) if f.lower().endswith(".pdf")]
    total_files = len(files)
    
    print(f"🚀 Starting ingestion for {total_files} files in session {session_id}")

    for idx, filename in enumerate(files):
        print(f"\n--- 📄 Processing File {idx+1}/{total_files}: {filename} ---")
        
        # --- CHECKPOINTING: Skip if already in DB ---
        if is_already_ingested(filename, session_id):
            print(f"⏭️ Skipping {filename}: Already fully ingested in this session.")
            continue
            
        file_path = os.path.join(directory_path, filename)

        # 1. Partition
        elements = partitioning_documents(file_path)
        if not elements:
            print(f"⚠️ Skipping {filename}: No elements extracted.")
            continue
        print(f"✅ Partitioning complete: {len(elements)} elements found.")
        
        # 2. Map Elements to Topics (Hierarchical Grouping)
        topics = group_elements_by_topic(elements)
        print(f"✅ Topic mapping complete: {len(topics)} major topics identified.")

        topic_docs = []
        for topic in topics:
            topic_title = topic["title"]
            topic_elements = topic["elements"]

            # 3. Chunk elements within this topic
            chunks = create_chunks_by_title(topic_elements)
            
            # 4. Prepare contents and identify batch candidates
            chunk_data_list = []
            multimodal_indices = []
            
            for i, chunk in enumerate(chunks):
                content = separate_content_types(chunk)
                content['parent_topic'] = topic_title # Attach parent topic info
                chunk_data_list.append(content)
                if len(content['types']) > 1:
                    multimodal_indices.append(len(chunk_data_list) - 1)
            
            # 5. Process Multimodal Chunks in Parallel Batches for this Topic
            batch_size = 5
            if multimodal_indices:
                print(f"🤖 Processing {len(multimodal_indices)} multimodal chunks in topic: {topic_title}...")
                
                batches = []
                for i in range(0, len(multimodal_indices), batch_size):
                    batch_idxs = multimodal_indices[i : i + batch_size]
                    batches.append((batch_idxs, [chunk_data_list[idx] for idx in batch_idxs]))

                def process_batch(batch_data):
                    idxs, contents = batch_data
                    summaries = create_batch_ai_summaries(contents)
                    return idxs, summaries

                with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
                    results = list(executor.map(process_batch, batches))

                    for batch_idxs, summaries in results:
                        for idx, summary in zip(batch_idxs, summaries):
                            chunk_data_list[idx]['ai_summary'] = summary

            # 6. Convert to LangChain Documents for this Topic
            for content in chunk_data_list:
                raw_text = content['text']
                ai_summary = content.get('ai_summary', '')
                
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
            
        # 6. Inter-file cooldown (Removed for Tier 1)
        pass
            
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

# --- MAIN INGESTION ENTRY POINT ---

def ingest_directory(directory_path: str):
    """Function called by your FastAPI backend."""
    # 1. Process all files in the directory into chunks
    processed_docs = process_files_to_docs(directory_path)
    
    # 2. Store them in the vector database
    if processed_docs:
        create_vector_store(processed_docs)
        print(f"Successfully ingested session: {os.path.basename(directory_path)}")
    else:
        print("No valid documents found for ingestion.")

if __name__ == "__main__":
    # Standard test logic for standalone execution
    TEST_DIR = "./docs"
    if os.path.exists(TEST_DIR):
        print(f"🚀 Starting standalone test ingestion for: {TEST_DIR}")
        ingest_directory(TEST_DIR)
    else:
        print(f"⚠️ Test directory {TEST_DIR} not found. Please create it and add PDFs to test.")
