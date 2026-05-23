"""回填已有文档的向量索引。

使用方法:
    cd backend && uv run python -m app.scripts.backfill_embeddings
"""

import asyncio
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

from sqlalchemy import select
from app.models.database import Document, async_session
from app.services.vector_service import index_document, ensure_collection


async def main():
    ensure_collection()

    async with async_session() as db:
        result = await db.execute(
            select(Document).where(Document.status == "completed")
        )
        docs = result.scalars().all()

    print(f"Found {len(docs)} completed documents")

    for doc in docs:
        desc = doc.doc_description or ""
        if not desc.strip():
            print(f"  Skip {doc.id} ({doc.original_name}): empty description")
            continue
        try:
            index_document(doc.id, desc)
            print(f"  Indexed {doc.id} ({doc.original_name})")
        except Exception as e:
            print(f"  Error indexing {doc.id}: {e}")

    print("Done!")


if __name__ == "__main__":
    asyncio.run(main())
