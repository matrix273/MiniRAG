"""Agent service: creates Agent with tools, runs with guardrails and fallback."""

import os
import asyncio
import json
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
    
    def get_document(self) -> str:
        """Get document metadata."""
        return self.doc_client.get_document(self.doc_id)
    
    def get_document_structure(self) -> str:
        """Get document structure."""
        return self.doc_client.get_document_structure(self.doc_id)
    
    def get_page_content(self, pages: str) -> str:
        """Get page content and track which pages were accessed."""
        # Parse pages like "5-7", "3,8", "12"
        self._track_pages(pages)
        return self.doc_client.get_page_content(self.doc_id, pages)
    
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
    
    def get_accessed_pages(self) -> List[int]:
        """Return sorted list of accessed page numbers."""
        return sorted(self.accessed_pages)


def create_model() -> OpenAIChatCompletionsModel:
    """Create OpenAIChatCompletionsModel pointed at DashScope."""
    client = AsyncOpenAI(
        base_url=settings.OPENAI_BASE_URL,
        api_key=settings.DASHSCOPE_API_KEY or settings.OPENAI_API_KEY,
    )
    # Strip dashscope/ prefix if present (e.g. "dashscope/qwen-plus" -> "qwen-plus")
    model_name = settings.DEFAULT_MODEL
    if "/" in model_name:
        model_name = model_name.split("/", 1)[1]

    return OpenAIChatCompletionsModel(
        model=model_name,
        openai_client=client,
    )


def create_agent(
    doc_client,
    doc_id: str,
    system_prompt: str,
    model: Optional[OpenAIChatCompletionsModel] = None,
) -> Tuple[Agent, TrackedPageIndexClient]:
    """Create Agent with document tools bound to a specific doc_id.
    
    Returns: (agent, tracked_client) - tracked_client can be used to get accessed pages
    """
    # Create tracking wrapper
    tracked = TrackedPageIndexClient(doc_client, doc_id)

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

    @function_tool
    def get_page_content(pages: str) -> str:
        """Get the text content of specific pages. Use tight ranges: e.g. '5-7', '3,8', '12'.
        
        Call this after understanding document structure to retrieve relevant content.
        """
        return tracked.get_page_content(pages)

    if model is None:
        model = create_model()

    agent = Agent(
        name="PageIndex",
        instructions=system_prompt,
        tools=[get_document, get_document_structure, get_page_content],
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
    try:
        result = await asyncio.wait_for(
            Runner.run(agent, query, max_turns=max_turns),
            timeout=timeout_seconds,
        )
        # Get pages that were accessed during tool calls
        accessed_pages = tracked_client.get_accessed_pages()
        return result.final_output or "", False, accessed_pages
    except (asyncio.TimeoutError, Exception):
        return "", True, []
