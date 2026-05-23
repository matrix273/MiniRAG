import asyncio
import time
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.database import Document, async_session
from app.services.document_service import chat_service

async def evaluate_mode(mode_name, query_func, query, doc):
    """评估单个模式"""
    print(f"\n{'='*60}")
    print(f"Testing {mode_name} Mode")
    print(f"Query: {query}")
    print(f"Document: {doc.original_name}")
    print(f"{'='*60}")
    
    start_time = time.time()
    
    try:
        answer, citations = await query_func(doc, query)
        end_time = time.time()
        
        print(f"\nAnswer:\n{answer}")
        print(f"\nCitations: {len(citations)}")
        for i, citation in enumerate(citations):
            print(f"  {i+1}. Page {citation['page']}: {citation['text'][:100]}...")
        
        print(f"\nResponse time: {end_time - start_time:.2f} seconds")
        print(f"Answer length: {len(answer)} characters")
        
        # 检查是否包含功耗信息
        has_power_info = "功耗" in answer and ("400" in answer or "800" in answer)
        print(f"Contains power info: {'✓' if has_power_info else '✗'}")
        
        return {
            "mode": mode_name,
            "answer": answer,
            "citations": len(citations),
            "time": end_time - start_time,
            "length": len(answer),
            "has_power_info": has_power_info
        }
        
    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()
        return {
            "mode": mode_name,
            "error": str(e),
            "time": time.time() - start_time
        }

async def main():
    async with async_session() as db:
        # 查找 LL-120 CDU.pdf 文档
        result = await db.execute(
            select(Document).where(Document.original_name == "LL-120 CDU.pdf")
        )
        doc = result.scalar_one_or_none()
        
        if not doc:
            print("Document not found")
            return
        
        print(f"Document: {doc.original_name} (ID: {doc.id})")
        print(f"Pages: {doc.page_count}")
        
        # 测试查询
        query = "LL-120 CDU 的功耗"
        
        # 评估快速模式
        fast_result = await evaluate_mode(
            "Fast",
            lambda d, q: chat_service.query_document_fast(d, q),
            query,
            doc
        )
        
        # 评估深度模式
        deep_result = await evaluate_mode(
            "Deep",
            lambda d, q: chat_service.query_document(d, q),
            query,
            doc
        )
        
        # 比较结果
        print(f"\n{'='*60}")
        print("COMPARISON RESULTS")
        print(f"{'='*60}")
        
        print(f"\n{'Metric':<20} {'Fast Mode':<15} {'Deep Mode':<15} {'Winner':<15}")
        print("-" * 65)
        
        # 响应时间
        fast_time = fast_result.get('time', 0)
        deep_time = deep_result.get('time', 0)
        time_winner = "Fast" if fast_time < deep_time else "Deep"
        print(f"{'Response Time':<20} {fast_time:.2f}s{'':<10} {deep_time:.2f}s{'':<10} {time_winner}")
        
        # 回答长度
        fast_len = fast_result.get('length', 0)
        deep_len = deep_result.get('length', 0)
        len_winner = "Fast" if fast_len < deep_len else "Deep"
        print(f"{'Answer Length':<20} {fast_len} chars{'':<8} {deep_len} chars{'':<8} {len_winner}")
        
        # 引用数量
        fast_citations = fast_result.get('citations', 0)
        deep_citations = deep_result.get('citations', 0)
        cite_winner = "Fast" if fast_citations > deep_citations else "Deep"
        print(f"{'Citations':<20} {fast_citations:<15} {deep_citations:<15} {cite_winner}")
        
        # 功耗信息
        fast_power = fast_result.get('has_power_info', False)
        deep_power = deep_result.get('has_power_info', False)
        power_winner = "Fast" if fast_power and not deep_power else ("Deep" if deep_power and not fast_power else "Tie")
        print(f"{'Power Info':<20} {'✓' if fast_power else '✗':<15} {'✓' if deep_power else '✗':<15} {power_winner}")
        
        # 总体推荐
        print(f"\n{'='*60}")
        print("RECOMMENDATION")
        print(f"{'='*60}")
        
        if fast_power and not deep_power:
            print("Fast Mode is recommended for this type of query.")
            print("Reasons:")
            print("1. Correctly extracts power consumption data from table")
            print("2. Faster response time")
            print("3. Specialized prompt for table data handling")
        elif deep_power and not fast_power:
            print("Deep Mode is recommended for this type of query.")
            print("Reasons:")
            print("1. Correctly extracts power consumption data")
            print("2. More flexible with tool calls")
        elif fast_power and deep_power:
            print("Both modes work correctly.")
            print("Fast Mode is recommended for efficiency.")
        else:
            print("Neither mode correctly extracted power information.")
            print("May need further prompt optimization.")

if __name__ == "__main__":
    asyncio.run(main())