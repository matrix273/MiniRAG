"""Agent service: creates Agent with tools, runs with guardrails and fallback."""

import os
import json
import asyncio
import time
from typing import Optional, List, Tuple
from openai import AsyncOpenAI
from agents import Agent, Runner, function_tool, OpenAIChatCompletionsModel, set_tracing_disabled

from app.services.system_config_service import get_llm_config

# Disable agents SDK tracing — it sends data to OpenAI servers, not needed with DashScope
set_tracing_disabled(True)


class TrackedPageIndexClient:
    """Wrapper around PageIndexClient that tracks page accesses.
    
    Supports both single-doc mode (default doc_id) and multi-doc mode
    (doc_id passed per call).
    """
    
    def __init__(self, doc_client, doc_id: str = ""):
        self.doc_client = doc_client
        self.doc_id = doc_id  # default doc_id for single-doc mode
        self.accessed_pages: dict[str, set] = {}  # doc_id -> set of pages
        self.tool_timings = {}
    
    def _get_default_doc_id(self) -> str:
        return self.doc_id
    
    def _track_page_access(self, doc_id: str, pages_str: str):
        """Parse and track accessed pages for a specific document."""
        if doc_id not in self.accessed_pages:
            self.accessed_pages[doc_id] = set()
        for part in pages_str.split(','):
            part = part.strip()
            if '-' in part:
                start, end = part.split('-', 1)
                try:
                    for p in range(int(start), int(end) + 1):
                        self.accessed_pages[doc_id].add(p)
                except ValueError:
                    pass
            else:
                try:
                    self.accessed_pages[doc_id].add(int(part))
                except ValueError:
                    pass
    
    def get_document(self, doc_id: str = "") -> str:
        """Get document metadata. doc_id='' uses default."""
        did = doc_id or self._get_default_doc_id()
        start = time.perf_counter()
        result = self.doc_client.get_document(did)
        end = time.perf_counter()
        self._log_tool_call("get_document", start, end)
        return result
    
    def get_document_structure(self, doc_id: str = "") -> str:
        """Get document structure. doc_id='' uses default."""
        did = doc_id or self._get_default_doc_id()
        start = time.perf_counter()
        result = self.doc_client.get_document_structure(did)
        end = time.perf_counter()
        self._log_tool_call("get_document_structure", start, end)
        return result
    
    def get_page_content(self, pages: str, doc_id: str = "") -> str:
        """Get page content. doc_id='' uses default."""
        did = doc_id or self._get_default_doc_id()
        self._track_page_access(did, pages)
        start = time.perf_counter()
        result = self.doc_client.get_page_content(did, pages)
        end = time.perf_counter()
        self._log_tool_call("get_page_content", start, end)
        return result
    
    def get_page_images(self, pages: str, doc_id: str = "") -> list:
        """Get page images. doc_id='' uses default."""
        did = doc_id or self._get_default_doc_id()
        self._track_page_access(did, pages)
        start = time.perf_counter()
        result = self.doc_client.get_page_images(did, pages)
        end = time.perf_counter()
        self._log_tool_call("get_page_images", start, end)
        return result
    
    def get_page_images_base64(self, pages: str, doc_id: str = "") -> list:
        """Get page images as base64. doc_id='' uses default."""
        did = doc_id or self._get_default_doc_id()
        self._track_page_access(did, pages)
        start = time.perf_counter()
        result = self.doc_client.get_page_images_base64(did, pages)
        end = time.perf_counter()
        self._log_tool_call("get_page_images_base64", start, end)
        return result
    
    def get_page_images_info(self, doc_id: str = "") -> str:
        """Get per-page embedded image counts (metadata only). doc_id='' uses default."""
        did = doc_id or self._get_default_doc_id()
        start = time.perf_counter()
        result = self.doc_client.get_page_images_info(did)
        end = time.perf_counter()
        self._log_tool_call("get_page_images_info", start, end)
        return result
    
    def _log_tool_call(self, tool_name: str, start: float, end: float):
        """Log tool call duration."""
        import logging
        _perf = logging.getLogger("perf")
        duration = end - start
        self.tool_timings[tool_name] = self.tool_timings.get(tool_name, 0) + duration
        _perf.info(f"[perf] tool_call: {tool_name}, {duration:.3f}s")
    
    def get_accessed_pages(self, doc_id: str = "") -> List[int]:
        """Return sorted list of accessed page numbers.
        If doc_id is empty, return all accessed pages across all documents.
        """
        if doc_id:
            return sorted(self.accessed_pages.get(doc_id, set()))
        # Return all pages across all docs
        all_pages = set()
        for pages in self.accessed_pages.values():
            all_pages.update(pages)
        return sorted(all_pages)
    
    def get_accessed_pages_by_doc(self) -> dict[str, List[int]]:
        """Return accessed pages grouped by document ID."""
        return {did: sorted(pages) for did, pages in self.accessed_pages.items()}


class TrackedChatCompletionsModel(OpenAIChatCompletionsModel):
    """Subclass that logs per-turn LLM call timing."""
    
    turn_timings: list = []

    async def get_response(self, *args, **kwargs):
        import time as _time
        import logging
        _perf = logging.getLogger("perf")
        turn_idx = len(self.turn_timings)
        _t = _time.perf_counter()
        result = await super().get_response(*args, **kwargs)
        elapsed = _time.perf_counter() - _t
        self.turn_timings.append(elapsed)
        _perf.info(f"[perf] llm_call: turn={turn_idx}, {elapsed:.3f}s")
        return result


async def create_model() -> TrackedChatCompletionsModel:
    """Create TrackedChatCompletionsModel from database config."""
    llm_config = await get_llm_config()
    
    # 确定 API Key: 优先 DashScope，其次 OpenAI
    api_key = llm_config["dashscope_key"] or llm_config["openai_key"]
    base_url = llm_config["api_base_url"]
    
    # 设置环境变量供其他库使用
    if api_key:
        os.environ["OPENAI_API_KEY"] = api_key
    if base_url:
        os.environ["OPENAI_BASE_URL"] = base_url
    
    client = AsyncOpenAI(
        base_url=base_url,
        api_key=api_key,
    )
    
    # Strip dashscope/ prefix if present (e.g. "dashscope/qwen-plus" -> "qwen-plus")
    model_name = llm_config["default_model"]
    if "/" in model_name:
        model_name = model_name.split("/", 1)[1]

    return TrackedChatCompletionsModel(
        model=model_name,
        openai_client=client,
    )


async def create_vision_model() -> Tuple[AsyncOpenAI, str]:
    """Create an OpenAI client for the vision model from database config."""
    llm_config = await get_llm_config()
    
    api_key = llm_config["dashscope_key"] or llm_config["openai_key"]
    base_url = llm_config["api_base_url"]
    
    client = AsyncOpenAI(
        base_url=base_url,
        api_key=api_key,
    )
    
    model_name = llm_config["vision_model"]
    if "/" in model_name:
        model_name = model_name.split("/", 1)[1]
    
    return client, model_name


async def create_agent(
    doc_client,
    doc_id: str,
    system_prompt: str,
    model: Optional[OpenAIChatCompletionsModel] = None,
    include_metadata_tools: bool = True,
    include_vision_tools: bool = False,
) -> Tuple[Agent, TrackedPageIndexClient]:
    """Create Agent with document tools bound to a specific doc_id.
    
    Args:
        include_metadata_tools: If True, includes get_document and get_document_structure tools.
                               If False, only includes get_page_content (for when structure_summary
                               is already injected into the prompt).
        include_vision_tools: If True, includes visual tools for page image processing.
    
    Returns: (agent, tracked_client) - tracked_client can be used to get accessed pages
    """
    # Create tracking wrapper
    tracked = TrackedPageIndexClient(doc_client, doc_id)

    tools = []
    
    if include_metadata_tools:
        @function_tool
        def get_document() -> str:
            """Get document metadata: status, page count, name, and description.
            
            ALWAYS call this first to verify the document exists before other operations.
            """
            return tracked.get_document()

        @function_tool
        def get_document_structure() -> str:
            """Get the document's full tree structure (without text) to find relevant sections.
            
            Call this after get_document() to understand document organization.
            """
            return tracked.get_document_structure()
        
        tools.extend([get_document, get_document_structure])

    @function_tool
    def get_page_content(pages: str) -> str:
        """Get the text content of specific pages. Use ranges: '5-7', '3,8', '12'.
        For most queries, only read pages relevant to the question.
        Only read the full document ('1-N') when the user explicitly asks to see all content,
        requests a comprehensive summary of the entire document, or needs full translation.
        
        Call this after understanding document structure to retrieve relevant content.
        """
        return tracked.get_page_content(pages)
    
    tools.append(get_page_content)
    
    # Add vision tools if enabled
    if include_vision_tools:
        vision_client, vision_model_name = await create_vision_model()
        
        @function_tool
        def get_page_images_info() -> str:
            """Get per-page embedded image metadata for the document.
            
            Returns JSON with: pages_with_images [{page, image_count}], total_image_count.
            This tells you EXACTLY which pages have embedded images (figures, charts, diagrams).
            Use this BEFORE search_visual_content() to distinguish real figures from cross-references.
            
            IMPORTANT LIMITATIONS:
            - image_count is the RAW COUNT of embedded image objects, NOT the number of Figures.
            - One Figure may contain MULTIPLE sub-images (e.g., Figure 1 with (a), (b), (c) = 3 images but 1 Figure).
            - Some images may NOT be Figures (logos, decorations, table images, page headers/footers).
            - To determine ACTUAL Figure count and types, you MUST call analyze_page_images() for visual analysis.
            
            CRITICAL: Only pages listed in 'pages_with_images' actually contain embedded images.
            If search_visual_content finds "Figure X" on a page NOT in this list, it is a
            cross-reference (citation to another paper), NOT an actual figure in this document.
            
            USAGE: Use this to identify pages with images, then call analyze_page_images() on those
            pages to determine which images are actual Figures vs other types.
            """
            return tracked.get_page_images_info()
        
        tools.append(get_page_images_info)
        
        @function_tool
        async def search_visual_content(query: str) -> str:
            """Search for visual content (figures, charts, formulas) across the ENTIRE document.
            
            This tool traverses ALL pages to find every text occurrence matching the query.
            Each result now includes [N embedded images] showing how many embedded images
            actually exist on that page (detected from PDF structure, not text).
            
            IMPORTANT: Call get_page_images_info() FIRST for overview. Then use this tool
            with broad terms like "Figure" or "Table". A text mention on a page with 0
            embedded images is almost certainly a cross-reference, NOT an actual figure.
            
            NOTE ON FIGURES vs IMAGES:
            - image_count is the RAW COUNT of image objects, not the number of Figures.
            - One Figure may contain MULTIPLE sub-images (e.g., Figure 1 with (a), (b), (c)).
            - To determine which images are actual Figures, call analyze_page_images() on pages
              with image_count > 0.
            
            Example: search_visual_content(query="Figure 2") or 
                     search_visual_content(query="Figure")
            """
            # Get document info for page count
            doc_info = tracked.get_document()
            
            # Extract page count from doc_info
            page_count = 10  # default
            try:
                if isinstance(doc_info, str):
                    import ast
                    doc_dict = ast.literal_eval(doc_info)
                    page_count = doc_dict.get('page_count', 10)
            except:
                pass

            # Get per-page embedded image metadata
            page_image_counts: dict[int, int] = {}
            total_embedded_images = 0
            try:
                info_str = tracked.get_page_images_info()
                info = json.loads(info_str)
                for entry in info.get('pages_with_images', []):
                    page_image_counts[entry['page']] = entry['image_count']
                    total_embedded_images += entry['image_count']
            except:
                pass
            
            # Search for the figure in text, chunk by chunk - collect ALL matches
            chunk_size = 10 if page_count < 50 else 20
            search_terms = [query, query.lower(), query.upper()]
            results_with_images: list[str] = []
            results_without_images: list[str] = []
            seen_pages: set[int] = set()
            
            for start in range(1, page_count + 1, chunk_size):
                end = min(start + chunk_size - 1, page_count)
                content = tracked.get_page_content(f"{start}-{end}")
                
                # Check if query is mentioned in this chunk (any case)
                if not any(t in content for t in search_terms):
                    continue
                
                # Search page by page in this chunk, checking ALL case variants
                for page in range(start, end + 1):
                    if page in seen_pages:
                        continue
                    page_content = tracked.get_page_content(str(page))
                    if any(t in page_content for t in search_terms):
                        seen_pages.add(page)
                        # 截取相关内容片段，突出显示查询词
                        snippet = page_content[:500]
                        result_entry = f"📄 第{page}页: {snippet}..."
                        
                        if page in page_image_counts:
                            img_count = page_image_counts[page]
                            result_entry = f"🖼️ 第{page}页 [有{img_count}张嵌入图]: {snippet}..."
                            results_with_images.append(result_entry)
                        else:
                            result_entry = f"📝 第{page}页 [无嵌入图]: {snippet}..."
                            results_without_images.append(result_entry)
            
            if not results_with_images and not results_without_images:
                return f"❌ 未在文档中找到 '{query}' 的明确提及。\n\n💡 建议:\n1. 尝试使用更宽泛的关键词搜索\n2. 使用 get_page_content() 查看特定页面内容"
            
            # 构建结构化结果
            output_parts = []
            
            # 1. 摘要信息
            total_mentions = len(results_with_images) + len(results_without_images)
            output_parts.append(
                f"🔍 搜索 '{query}' 完成\n"
                f"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
                f"📊 统计: {total_mentions} 处文本提及 (共 {page_count} 页)\n"
                f"   • 有嵌入图的页面: {len(results_with_images)} 页 (共 {sum(page_image_counts.get(int(result.split('第')[1].split('页')[0]), 0) for result in results_with_images) if results_with_images else 0} 张图片)\n"
                f"   • 无嵌入图的页面: {len(results_without_images)} 页 (可能是交叉引用)\n"
                f"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
            )
            
            # 2. 有图片的页面（优先展示）
            if results_with_images:
                output_parts.append("🖼️ 【有嵌入图的页面】(可能是真实图表)")
                output_parts.append("这些页面包含嵌入图片，需要进一步分析确认是否为图表、公式等:")
                for result in results_with_images:
                    output_parts.append(result)
                output_parts.append("")
            
            # 3. 无图片的页面
            if results_without_images:
                output_parts.append("📝 【仅文本提及的页面】(可能是交叉引用)")
                output_parts.append("这些页面只包含文本提及，没有检测到嵌入图片:")
                for result in results_without_images:
                    output_parts.append(result)
                output_parts.append("")
            
            # 4. 下一步建议
            output_parts.append("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
            output_parts.append("🎯 下一步操作建议:")
            
            if results_with_images:
                # 提取有图片的页码
                pages_with_images = []
                for result in results_with_images:
                    try:
                        page_num = int(result.split('第')[1].split('页')[0])
                        pages_with_images.append(page_num)
                    except:
                        pass
                
                if pages_with_images:
                    pages_str = ','.join(str(p) for p in sorted(pages_with_images)[:5])  # 最多5页
                    output_parts.append(
                        f"1. 调用 analyze_page_images(pages='{pages_str}') 分析这些页面的视觉内容\n"
                        f"   → 确定哪些是真正的图表，哪些是子图 (a), (b), (c)\n"
                        f"   → 获取图表的详细描述"
                    )
            
            output_parts.append(
                f"2. 调用 get_page_content() 获取完整文本内容\n"
                f"3. 对于无嵌入图的页面，这些提及可能是引用其他论文的图表\n\n"
                f"⚠️ 注意: image_count 是原始图片对象数量，不是图表数量\n"
                f"   • 一个图表可能包含多个子图 (a), (b), (c)\n"
                f"   • 部分图片可能是 logo、装饰图等非图表内容\n"
                f"   • 必须调用 analyze_page_images() 才能确定实际图表类型"
            )
            
            return "\n".join(output_parts)
        
        tools.append(search_visual_content)
        
        @function_tool
        async def analyze_page_images(pages: str) -> str:
            """Analyze PDF pages visually. Use tight ranges: e.g. '5-7', '3,8', '12'.
            
            RENDERS the specified pages as images and sends them to a vision model
            for analysis. Returns a detailed description of charts, diagrams, formulas,
            tables, and visual elements found on those pages.
            Use this when text-based tools are insufficient for questions about
            visual content.
            """
            images = tracked.get_page_images_base64(pages)
            
            if not images:
                return "No images could be generated for the specified pages."
            
            # Build vision model request with images as proper image_url blocks
            # 获取请求的页码列表，用于提示视觉模型
            requested_pages = [img['page'] for img in images]
            pages_str = ", ".join(str(p) for p in requested_pages)
            
            content: list = [
                {
                    "type": "text",
                    "text": (
                        f"你正在分析 PDF 页面图像。请求的页码是: {pages_str}。\n\n"
                        "重要提示：对于你分析的每一页，请在描述开头清楚地标注页码"
                        "（例如：'第 4 页：'、'第 5-6 页：'）。\n\n"
                        "请详细描述你在这些页面上看到的内容。\n\n"
                        "针对不同类型的内容，请提供相应的详细描述：\n"
                        "1. **图表/图形**：描述图表类型（柱状图、折线图等）、数据趋势、关键数值\n"
                        "2. **数学公式**：写出完整的 LaTeX 公式，并解释每个符号的含义\n"
                        "3. **表格**：列出表头和关键数据行\n"
                        "4. **架构图/流程图**：描述各组件及其连接关系\n"
                        "5. **文本内容**：提取关键段落和要点\n\n"
                        "请确保描述足够详细，让读者无需查看图像就能完全理解内容。\n\n"
                        "请使用中文回答。"
                    ),
                }
            ]
            
            # Attach each page image
            for img in images:
                content.append({
                    "type": "image_url",
                    "image_url": {"url": f"data:image/png;base64,{img['base64']}"},
                })
            
            try:
                resp = await vision_client.chat.completions.create(
                    model=vision_model_name,
                    messages=[{"role": "user", "content": content}],
                    max_tokens=2048,
                )
                return resp.choices[0].message.content or "(vision model returned empty response)"
            except Exception as e:
                import logging
                logging.getLogger("agent_service").warning(f"Vision model call failed: {e}")
                return f"[Vision analysis failed: {e}]"
        
        tools.append(analyze_page_images)

    if model is None:
        model = await create_model()

    agent = Agent(
        name="PageIndex",
        instructions=system_prompt,
        tools=tools,
        model=model,
    )
    
    return agent, tracked


async def create_multi_doc_agent(
    doc_client,
    doc_ids: List[str],
    doc_names: dict[str, str],
    system_prompt: str,
    model: Optional[OpenAIChatCompletionsModel] = None,
    include_vision_tools: bool = False,
) -> Tuple[Agent, TrackedPageIndexClient]:
    """Create Agent with tools that can access MULTIPLE documents.
    
    Each tool accepts a doc_id parameter to specify which document to operate on.
    
    Args:
        doc_client: PageIndexClient instance
        doc_ids: List of document IDs
        doc_names: Mapping of doc_id -> doc_name (for tool descriptions)
        system_prompt: System prompt
        model: Optional model override
        include_vision_tools: If True, includes visual tools
    
    Returns: (agent, tracked_client)
    """
    # Create tracking wrapper (no default doc_id for multi-doc)
    tracked = TrackedPageIndexClient(doc_client, doc_id="")
    
    # Build doc_id list string for tool descriptions
    doc_list_str = ", ".join(
        f'"{did}" ({doc_names.get(did, did)})' for did in doc_ids
    )
    
    tools = []
    
    # Build doc descriptions for tools
    _get_page_content_desc = (
        f"Get the text content of specific pages from a specific document.\n\n"
        f"Args:\n    doc_id: The document ID. Available IDs: {doc_list_str}\n"
        f"    pages: Page range. Use ranges: '5-7', '3,8', '12'.\n\n"
        f"For most queries, only read pages relevant to the question.\n"
        f"Only read the full document ('1-N') when the user explicitly asks."
    )
    
    @function_tool(description_override=_get_page_content_desc)
    def get_page_content(doc_id: str, pages: str) -> str:
        return tracked.get_page_content(pages, doc_id)
    
    tools.append(get_page_content)
    
    if include_vision_tools:
        vision_client, vision_model_name = await create_vision_model()
        
        _images_info_desc = (
            f"Get per-page embedded image metadata for a specific document.\n\n"
            f"Args:\n    doc_id: The document ID. Available IDs: {doc_list_str}\n\n"
            f"Returns pages_with_images [{{page, image_count}}] and total_image_count.\n"
            f"Use BEFORE search_visual_content to distinguish real figures from cross-references.\n\n"
            f"IMPORTANT LIMITATIONS:\n"
            f"- image_count is the RAW COUNT of embedded image objects, NOT the number of Figures.\n"
            f"- One Figure may contain MULTIPLE sub-images (e.g., Figure 1 with (a), (b), (c) = 3 images but 1 Figure).\n"
            f"- Some images may NOT be Figures (logos, decorations, table images, page headers/footers).\n"
            f"- To determine ACTUAL Figure count and types, you MUST call analyze_page_images() for visual analysis."
        )
        
        @function_tool(description_override=_images_info_desc)
        def get_page_images_info(doc_id: str) -> str:
            return tracked.get_page_images_info(doc_id)
        
        tools.append(get_page_images_info)
        
        _search_visual_desc = (
            f"Search for visual content (figures, charts, formulas) in a specific document.\n\n"
            f"Args:\n    doc_id: The document ID. Available IDs: {doc_list_str}\n"
            f"    query: Description of the visual content to find.\n\n"
            f"Each result includes [N embedded images] tag showing how many embedded images\n"
            f"actually exist on that page. Text mention on a page with 0 embedded images is\n"
            f"almost certainly a cross-reference, not an actual figure.\n\n"
            f"NOTE ON FIGURES vs IMAGES:\n"
            f"- image_count is the RAW COUNT of image objects, not the number of Figures.\n"
            f"- One Figure may contain MULTIPLE sub-images (e.g., Figure 1 with (a), (b), (c)).\n"
            f"- To determine which images are actual Figures, call analyze_page_images() on pages\n"
            f"  with image_count > 0."
        )
        
        @function_tool(description_override=_search_visual_desc)
        async def search_visual_content(doc_id: str, query: str) -> str:
            # Get document info for page count
            doc_info = tracked.get_document(doc_id)
            doc_name = doc_names.get(doc_id, doc_id)
            
            page_count = 10
            try:
                if isinstance(doc_info, str):
                    import ast
                    doc_dict = ast.literal_eval(doc_info)
                    page_count = doc_dict.get('page_count', 10)
            except:
                pass

            # Get per-page embedded image metadata
            page_image_counts: dict[int, int] = {}
            total_embedded_images = 0
            try:
                info_str = tracked.get_page_images_info(doc_id)
                info = json.loads(info_str)
                for entry in info.get('pages_with_images', []):
                    page_image_counts[entry['page']] = entry['image_count']
                    total_embedded_images += entry['image_count']
            except:
                pass
            
            chunk_size = 10 if page_count < 50 else 20
            search_terms = [query, query.lower(), query.upper()]
            results_with_images: list[str] = []
            results_without_images: list[str] = []
            seen_pages: set[int] = set()
            
            for start in range(1, page_count + 1, chunk_size):
                end = min(start + chunk_size - 1, page_count)
                content = tracked.get_page_content(f"{start}-{end}", doc_id)
                
                # Check if query is mentioned in this chunk (any case)
                if not any(t in content for t in search_terms):
                    continue
                
                # Search page by page in this chunk, checking ALL case variants
                for page in range(start, end + 1):
                    if page in seen_pages:
                        continue
                    page_content = tracked.get_page_content(str(page), doc_id)
                    if any(t in page_content for t in search_terms):
                        seen_pages.add(page)
                        # 截取相关内容片段
                        snippet = page_content[:500]
                        
                        if page in page_image_counts:
                            img_count = page_image_counts[page]
                            result_entry = f"🖼️ [{doc_name}] 第{page}页 [有{img_count}张嵌入图]: {snippet}..."
                            results_with_images.append(result_entry)
                        else:
                            result_entry = f"📝 [{doc_name}] 第{page}页 [无嵌入图]: {snippet}..."
                            results_without_images.append(result_entry)
            
            if not results_with_images and not results_without_images:
                return f"❌ 在文档 '{doc_name}' 中未找到 '{query}' 的明确提及。\n\n💡 建议:\n1. 尝试使用更宽泛的关键词搜索\n2. 使用 get_page_content() 查看特定页面内容"
            
            # 构建结构化结果
            output_parts = []
            
            # 1. 摘要信息
            total_mentions = len(results_with_images) + len(results_without_images)
            output_parts.append(
                f"🔍 搜索 '{query}' 完成 — 文档: {doc_name}\n"
                f"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
                f"📊 统计: {total_mentions} 处文本提及 (共 {page_count} 页)\n"
                f"   • 有嵌入图的页面: {len(results_with_images)} 页\n"
                f"   • 无嵌入图的页面: {len(results_without_images)} 页 (可能是交叉引用)\n"
                f"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
            )
            
            # 2. 有图片的页面（优先展示）
            if results_with_images:
                output_parts.append("🖼️ 【有嵌入图的页面】(可能是真实图表)")
                output_parts.append("这些页面包含嵌入图片，需要进一步分析确认是否为图表、公式等:")
                for result in results_with_images:
                    output_parts.append(result)
                output_parts.append("")
            
            # 3. 无图片的页面
            if results_without_images:
                output_parts.append("📝 【仅文本提及的页面】(可能是交叉引用)")
                output_parts.append("这些页面只包含文本提及，没有检测到嵌入图片:")
                for result in results_without_images:
                    output_parts.append(result)
                output_parts.append("")
            
            # 4. 下一步建议
            output_parts.append("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
            output_parts.append("🎯 下一步操作建议:")
            
            if results_with_images:
                # 提取有图片的页码
                pages_with_images = []
                for result in results_with_images:
                    try:
                        # 从结果中提取页码
                        page_num = int(result.split('第')[1].split('页')[0])
                        pages_with_images.append(page_num)
                    except:
                        pass
                
                if pages_with_images:
                    pages_str = ','.join(str(p) for p in sorted(pages_with_images)[:5])  # 最多5页
                    output_parts.append(
                        f"1. 调用 analyze_page_images(doc_id='{doc_id}', pages='{pages_str}') 分析这些页面的视觉内容\n"
                        f"   → 确定哪些是真正的图表，哪些是子图 (a), (b), (c)\n"
                        f"   → 获取图表的详细描述"
                    )
            
            output_parts.append(
                f"2. 调用 get_page_content(doc_id='{doc_id}', pages='...') 获取完整文本内容\n"
                f"3. 对于无嵌入图的页面，这些提及可能是引用其他论文的图表\n\n"
                f"⚠️ 注意: image_count 是原始图片对象数量，不是图表数量\n"
                f"   • 一个图表可能包含多个子图 (a), (b), (c)\n"
                f"   • 部分图片可能是 logo、装饰图等非图表内容\n"
                f"   • 必须调用 analyze_page_images() 才能确定实际图表类型"
            )
            
            return "\n".join(output_parts)
        
        tools.append(search_visual_content)
        
        _analyze_images_desc = (
            f"Analyze PDF pages visually from a specific document.\n\n"
            f"Args:\n    doc_id: The document ID. Available IDs: {doc_list_str}\n"
            f"    pages: Page range. Use tight ranges: e.g. '5-7', '3,8', '12'.\n\n"
            f"Renders pages as images and analyzes with vision model for charts, diagrams, formulas, tables."
        )
        
        @function_tool(description_override=_analyze_images_desc)
        async def analyze_page_images(doc_id: str, pages: str) -> str:
            images = tracked.get_page_images_base64(pages, doc_id)
            
            if not images:
                return "No images could be generated for the specified pages."
            
            requested_pages = [img['page'] for img in images]
            pages_str = ", ".join(str(p) for p in requested_pages)
            
            content: list = [
                {
                    "type": "text",
                    "text": (
                        f"You are analyzing PDF page images. Requested pages: {pages_str}.\n\n"
                        "Important: For each page analyzed, clearly label the page number "
                        "(e.g., 'Page 4:', 'Page 5-6:').\n\n"
                        "Provide detailed descriptions of content found on these pages.\n\n"
                        "Please respond in the same language as the user's question."
                    ),
                }
            ]
            
            for img in images:
                content.append({
                    "type": "image_url",
                    "image_url": {"url": f"data:image/png;base64,{img['base64']}"},
                })
            
            try:
                resp = await vision_client.chat.completions.create(
                    model=vision_model_name,
                    messages=[{"role": "user", "content": content}],
                    max_tokens=2048,
                )
                return resp.choices[0].message.content or "(vision model returned empty response)"
            except Exception as e:
                import logging
                logging.getLogger("agent_service").warning(f"Vision model call failed: {e}")
                return f"[Vision analysis failed: {e}]"
        
        tools.append(analyze_page_images)
    
    if model is None:
        model = await create_model()
    
    agent = Agent(
        name="PageIndex",
        instructions=system_prompt,
        tools=tools,
        model=model,
    )
    
    return agent, tracked


async def run_agent_with_guardrails(
    agent: Agent,
    tracked_client: TrackedPageIndexClient,
    query: str,
    max_turns: int = 5,
    timeout_seconds: int = 60,
) -> tuple[str, bool, List[int]]:
    """Run agent with max_turns and timeout guardrails.

    Returns: (answer, is_fallback, accessed_pages)
    """
    import time as _time
    import logging
    _perf = logging.getLogger("perf")

    try:
        _t_agent = _time.perf_counter()
        result = await asyncio.wait_for(
            Runner.run(agent, query, max_turns=max_turns),
            timeout=timeout_seconds,
        )
        elapsed_agent = _time.perf_counter() - _t_agent
        
        # Extract tracked model timing info
        model = agent.model
        llm_turns = getattr(model, 'turn_timings', []) if hasattr(model, 'turn_timings') else []
        total_llm = sum(llm_turns)
        
        # Tool call summary
        tool_calls = tracked_client.tool_timings
        total_tool = sum(tool_calls.values()) if tool_calls else 0
        
        # Compute overhead (LLM + tool < total means there's other overhead)
        overhead = elapsed_agent - total_llm - total_tool
        
        _perf.info(
            f"[perf] agent_run: {elapsed_agent:.3f}s | "
            f"llm_turns={len(llm_turns)}, llm_total={total_llm:.3f}s | "
            f"tool_calls={sum(tool_calls.values()) if tool_calls else 0:.3f}s | "
            f"overhead={overhead:.3f}s"
        )
        for i, t in enumerate(llm_turns):
            _perf.info(f"[perf]   llm_turn[{i}]: {t:.3f}s")
        
        accessed_pages = tracked_client.get_accessed_pages()
        return result.final_output or "", False, accessed_pages
    except (asyncio.TimeoutError, Exception) as e:
        _perf.info(f"[perf] agent_run FAILED: {_time.perf_counter()-_t_agent:.3f}s, error={type(e).__name__}")
        return "", True, []


async def run_agent_streaming(
    agent: Agent,
    tracked_client: TrackedPageIndexClient,
    query: str,
    max_turns: int = 5,
    timeout_seconds: int = 60,
):
    """Run agent in streaming mode, yielding text deltas as they arrive.

    Yields dictionaries with event types:
      {"type": "text_delta", "content": "..."}
      {"type": "tool_call", "tool": "get_page_content", "pages": "1-3"}
      {"type": "done", "citations": [...], "full_text": "..."}
      {"type": "error", "message": "..."}
    """
    import time as _time
    import logging
    _perf = logging.getLogger("perf")

    try:
        _t_agent = _time.perf_counter()
        result = Runner.run_streamed(agent, query, max_turns=max_turns)

        full_text = ""
        async for event in result.stream_events():
            # 只处理文本增量事件，跳过函数调用参数等其他事件
            if event.type == "raw_response_event":
                event_data = event.data
                event_data_type = getattr(event_data, "type", None)
                # 检查是否是文本增量事件 (ResponseTextDeltaEvent)
                # 事件类型是 response.output_text.delta
                if hasattr(event_data, 'delta') and event_data_type == "response.output_text.delta":
                    delta = event_data.delta
                    if delta:
                        full_text += delta
                        yield {"type": "text_delta", "content": delta}
            elif event.type == "agent_tool_call_event":
                tool_name = event.item.name if hasattr(event.item, "name") else "unknown"
                yield {"type": "tool_call", "tool": tool_name}

        # Get final result for citations
        final_text = result.final_output or full_text
        accessed_pages = tracked_client.get_accessed_pages()

        elapsed = _time.perf_counter() - _t_agent
        _perf.info(f"[perf] agent_run_streaming: {elapsed:.3f}s")

        yield {
            "type": "done",
            "citations": accessed_pages,
            "full_text": final_text,
        }
    except Exception as e:
        _perf.info(f"[perf] agent_run_streaming FAILED: {type(e).__name__}: {e}")
        yield {"type": "error", "message": str(e)}
