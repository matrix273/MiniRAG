"""向量搜索服务：DashScope Embedding + Milvus Lite"""

import logging
from typing import Optional
from openai import OpenAI
from pymilvus import MilvusClient, DataType, CollectionSchema, FieldSchema

from app.core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

# Milvus Lite 本地存储
_milvus_client: Optional[MilvusClient] = None

# DashScope embedding 客户端（OpenAI 兼容）
_embedding_client: Optional[OpenAI] = None

EMBEDDING_MODEL = "text-embedding-v3"
EMBEDDING_DIM = 1024
COLLECTION_NAME = "document_descriptions"


def _get_milvus_client() -> MilvusClient:
    global _milvus_client
    if _milvus_client is None:
        _milvus_client = MilvusClient(uri=settings.MILVUS_DB_PATH)
    return _milvus_client


def _get_embedding_client() -> OpenAI:
    global _embedding_client
    if _embedding_client is None:
        api_key = settings.DASHSCOPE_API_KEY or settings.OPENAI_API_KEY
        base_url = settings.OPENAI_BASE_URL
        _embedding_client = OpenAI(api_key=api_key, base_url=base_url)
    return _embedding_client


def ensure_collection():
    """确保 Milvus collection 存在并已加载"""
    client = _get_milvus_client()
    if client.has_collection(COLLECTION_NAME):
        client.load_collection(COLLECTION_NAME)
        return

    schema = CollectionSchema(fields=[
        FieldSchema(name="id", dtype=DataType.INT64, is_primary=True, auto_id=True),
        FieldSchema(name="document_id", dtype=DataType.VARCHAR, max_length=36),
        FieldSchema(name="description", dtype=DataType.VARCHAR, max_length=2000),
        FieldSchema(name="embedding", dtype=DataType.FLOAT_VECTOR, dim=EMBEDDING_DIM),
    ])
    index_params = client.prepare_index_params()
    index_params.add_index(field_name="embedding", metric_type="COSINE", index_type="FLAT")
    client.create_collection(
        collection_name=COLLECTION_NAME,
        schema=schema,
        index_params=index_params,
    )
    logger.info("Milvus collection '%s' created", COLLECTION_NAME)


def embed_text(text: str) -> list[float]:
    """调用 DashScope text-embedding-v3 生成向量"""
    client = _get_embedding_client()
    resp = client.embeddings.create(model=EMBEDDING_MODEL, input=text)
    return resp.data[0].embedding


def index_document(doc_id: str, description: str):
    """为文档建立向量索引"""
    ensure_collection()
    if not description or not description.strip():
        logger.warning("Document %s has empty description, skipping indexing", doc_id)
        return

    embedding = embed_text(description)
    client = _get_milvus_client()
    client.load_collection(COLLECTION_NAME)

    # 删除旧索引（如有）
    client.delete(
        collection_name=COLLECTION_NAME,
        filter=f'document_id == "{doc_id}"',
    )

    client.insert(
        collection_name=COLLECTION_NAME,
        data=[{
            "document_id": doc_id,
            "description": description,
            "embedding": embedding,
        }],
    )
    logger.info("Document %s indexed in Milvus", doc_id)


def remove_document(doc_id: str):
    """删除文档的向量索引"""
    client = _get_milvus_client()
    if not client.has_collection(COLLECTION_NAME):
        return
    client.load_collection(COLLECTION_NAME)
    client.delete(
        collection_name=COLLECTION_NAME,
        filter=f'document_id == "{doc_id}"',
    )
    logger.info("Document %s removed from Milvus", doc_id)


def search_similar(query: str, top_k: int = 5, threshold: float = 0.3) -> list[dict]:
    """
    向量相似度搜索，返回 [{document_id, distance, description}]
    threshold: 余弦相似度阈值（低于此值的不返回）
    """
    ensure_collection()
    client = _get_milvus_client()
    client.load_collection(COLLECTION_NAME)

    # 检查 collection 是否有数据
    stats = client.get_collection_stats(COLLECTION_NAME)
    if int(stats.get("row_count", 0)) == 0:
        return []

    embedding = embed_text(query)
    results = client.search(
        collection_name=COLLECTION_NAME,
        data=[embedding],
        limit=top_k,
        output_fields=["document_id", "description"],
    )

    matches = []
    for hit in results[0]:
        distance = hit["distance"]
        if distance >= threshold:
            matches.append({
                "document_id": hit["entity"]["document_id"],
                "distance": distance,
                "description": hit["entity"]["description"],
            })

    return matches
