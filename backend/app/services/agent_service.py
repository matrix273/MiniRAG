"""Agent service: creates Agent with tools, runs with guardrails and fallback."""

import os
import asyncio
from typing import Optional
from openai import AsyncOpenAI
from agents import Agent, Runner, function_tool, OpenAIChatCompletionsModel

from app.core.config import get_settings

settings = get_settings()

# Set up env vars once at module load
api_key = settings.DASHSCOPE_API_KEY or settings.OPENAI_API_KEY
if api_key:
    os.environ["OPENAI_API_KEY"] = api_key


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
) -> Agent:
    """Create Agent with document tools bound to a specific doc_id."""

    @function_tool
    def get_document() -> str:
        """Get document metadata: status, page count, name, and description."""
        return doc_client.get_document(doc_id)

    @function_tool
    def get_document_structure() -> str:
        """Get the document's full tree structure (without text) to find relevant sections."""
        return doc_client.get_document_structure(doc_id)

    @function_tool
    def get_page_content(pages: str) -> str:
        """Get the text content of specific pages. Use tight ranges: e.g. '5-7', '3,8', '12'."""
        return doc_client.get_page_content(doc_id, pages)

    if model is None:
        model = create_model()

    return Agent(
        name="PageIndex",
        instructions=system_prompt,
        tools=[get_document, get_document_structure, get_page_content],
        model=model,
    )


async def run_agent_with_guardrails(
    agent: Agent,
    query: str,
    max_turns: int = 5,
    timeout_seconds: int = 60,
) -> tuple[str, bool]:
    """Run agent with max_turns and timeout guardrails.

    Returns: (answer, is_fallback)
    """
    try:
        result = await asyncio.wait_for(
            Runner.run(agent, query, max_turns=max_turns),
            timeout=timeout_seconds,
        )
        return result.final_output or "", False
    except (asyncio.TimeoutError, Exception):
        return "", True
