"""Agent service: creates Agent with tools, runs with guardrails and fallback."""

import os
import asyncio
import time
from typing import Optional, List, Tuple
from openai import AsyncOpenAI
from agents import Agent, Runner, function_tool, OpenAIChatCompletionsModel, set_tracing_disabled

from app.services.system_config_service import get_llm_config

# Disable agents SDK tracing — it sends data to OpenAI servers, not needed with DashScope
set_tracing_disabled(True)


class TrackedPageIndexClient:
    """Wrapper around PageIndexClient that tracks page accesses."""
    
    def __init__(self, doc_client, doc_id: str):
        self.doc_client = doc_client
        self.doc_id = doc_id
        self.accessed_pages: set = set()
        self.tool_timings = {}
    
    def get_document(self) -> str:
        """Get document metadata."""
        start = time.perf_counter()
        result = self.doc_client.get_document(self.doc_id)
        end = time.perf_counter()
        self._log_tool_call("get_document", start, end)
        return result
    
    def get_document_structure(self) -> str:
        """Get document structure."""
        start = time.perf_counter()
        result = self.doc_client.get_document_structure(self.doc_id)
        end = time.perf_counter()
        self._log_tool_call("get_document_structure", start, end)
        return result
    
    def get_page_content(self, pages: str) -> str:
        """Get page content and track which pages were accessed."""
        # Parse pages like "5-7", "3,8", "12"
        self._track_pages(pages)
        start = time.perf_counter()
        result = self.doc_client.get_page_content(self.doc_id, pages)
        end = time.perf_counter()
        self._log_tool_call("get_page_content", start, end)
        return result
    
    def get_page_images(self, pages: str) -> list:
        """Get page images and track which pages were accessed."""
        # Parse pages like "5-7", "3,8", "12"
        self._track_pages(pages)
        start = time.perf_counter()
        result = self.doc_client.get_page_images(self.doc_id, pages)
        end = time.perf_counter()
        self._log_tool_call("get_page_images", start, end)
        return result
    
    def get_page_images_base64(self, pages: str) -> list:
        """Get page images as base64 and track which pages were accessed."""
        # Parse pages like "5-7", "3,8", "12"
        self._track_pages(pages)
        start = time.perf_counter()
        result = self.doc_client.get_page_images_base64(self.doc_id, pages)
        end = time.perf_counter()
        self._log_tool_call("get_page_images_base64", start, end)
        return result
    
    def _track_pages(self, pages_str: str):
        """Parse and track accessed pages."""
        for part in pages_str.split(','):
            part = part.strip()
            if '-' in part:
                start, end = part.split('-', 1)
                try:
                    for p in range(int(start), int(end) + 1):
                        self.accessed_pages.add(p)
                except ValueError:
                    pass
            else:
                try:
                    self.accessed_pages.add(int(part))
                except ValueError:
                    pass
    
    def _log_tool_call(self, tool_name: str, start: float, end: float):
        """Log tool call duration."""
        import logging
        _perf = logging.getLogger("perf")
        duration = end - start
        self.tool_timings[tool_name] = self.tool_timings.get(tool_name, 0) + duration
        _perf.info(f"[perf] tool_call: {tool_name}, {duration:.3f}s")
    
    def get_accessed_pages(self) -> List[int]:
        """Return sorted list of accessed page numbers."""
        return sorted(self.accessed_pages)


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
        async def search_visual_content(query: str) -> str:
            """Search for visual content (figures, charts, formulas) location by searching text.
            
            Use this tool when you need to find which page contains a specific figure, chart,
            or diagram. This tool searches the document text to find where the figure is mentioned.
            
            Example: search_visual_content(query="Figure 2") or 
                     search_visual_content(query="Scaled Dot-Product Attention")
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
            
            # Search for the figure in text, chunk by chunk
            chunk_size = 10 if page_count < 50 else 20
            search_terms = [query, query.lower(), query.upper()]
            
            for start in range(1, page_count + 1, chunk_size):
                end = min(start + chunk_size - 1, page_count)
                content = tracked.get_page_content(f"{start}-{end}")
                
                # Check if query is mentioned in this chunk
                for term in search_terms:
                    if term in content:
                        # Found it! Now find the exact page
                        # Search page by page in this chunk
                        for page in range(start, end + 1):
                            page_content = tracked.get_page_content(str(page))
                            if term in page_content:
                                return f"找到 '{query}' 在第 {page} 页。\n\n相关文本片段:\n{page_content[:500]}..."
            
            return f"未在文档中找到 '{query}' 的明确提及。请尝试使用 get_page_content() 搜索更广泛的范围。"
        
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
