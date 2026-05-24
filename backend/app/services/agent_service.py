"""Agent service: creates Agent with tools, runs with guardrails and fallback."""

import os
import asyncio
import json
import time
from typing import Optional, List, Tuple
from openai import AsyncOpenAI
from agents import Agent, Runner, function_tool, OpenAIChatCompletionsModel, set_tracing_disabled

from app.core.config import get_settings

settings = get_settings()

# Disable agents SDK tracing — it sends data to OpenAI servers, not needed with DashScope
set_tracing_disabled(True)

# Set up env vars once at module load
api_key = settings.DASHSCOPE_API_KEY or settings.OPENAI_API_KEY
if api_key:
    os.environ["OPENAI_API_KEY"] = api_key


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


def create_model() -> TrackedChatCompletionsModel:
    """Create TrackedChatCompletionsModel pointed at DashScope."""
    client = AsyncOpenAI(
        base_url=settings.OPENAI_BASE_URL,
        api_key=settings.DASHSCOPE_API_KEY or settings.OPENAI_API_KEY,
    )
    # Strip dashscope/ prefix if present (e.g. "dashscope/qwen-plus" -> "qwen-plus")
    model_name = settings.DEFAULT_MODEL
    if "/" in model_name:
        model_name = model_name.split("/", 1)[1]

    return TrackedChatCompletionsModel(
        model=model_name,
        openai_client=client,
    )


def create_agent(
    doc_client,
    doc_id: str,
    system_prompt: str,
    model: Optional[OpenAIChatCompletionsModel] = None,
    include_metadata_tools: bool = True,
) -> Tuple[Agent, TrackedPageIndexClient]:
    """Create Agent with document tools bound to a specific doc_id.
    
    Args:
        include_metadata_tools: If True, includes get_document and get_document_structure tools.
                               If False, only includes get_page_content (for when structure_summary
                               is already injected into the prompt).
    
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
        """Get the text content of specific pages. Use tight ranges: e.g. '5-7', '3,8', '12'.
        
        Call this after understanding document structure to retrieve relevant content.
        """
        return tracked.get_page_content(pages)
    
    tools.append(get_page_content)

    if model is None:
        model = create_model()

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
