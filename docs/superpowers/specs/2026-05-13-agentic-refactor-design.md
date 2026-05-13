# Agentic Refactor Design: Agent + Prompt 版本管理

## 概述

参照 VectifyAI/PageIndex 的 `agentic_vectorless_rag_demo.py`，将 `ChatService` 中的 `litellm.completion()` 直接调用重构为 OpenAI Agents SDK Agent 自主推理 + 工具调用模式。同时新增提示词版本管理系统，支持四类提示词的数据库存储、版本管理和前端配置。

## 目标

1. ChatService 用 Agent SDK 替代关键词匹配 + litellm 直接调用
2. Agent 通过工具函数自主检索文档（`get_document` / `get_document_structure` / `get_page_content`）
3. 模型调用通过 DashScope OpenAI 兼容端点实现
4. 四类提示词（Agent System / RAG Template / Indexing / Post-processing）支持版本管理
5. 前端可配置默认提示词、查看历史版本、切换生效版本
6. 现有 API 接口保持不变，前端无感知

---

## 一、Agent 重构

### 1.1 现有流程

```
用户问题 → 关键词匹配检索 top-5 页 → 拼接 prompt → litellm.completion() → 后处理引用
```

关键词匹配逻辑位于 `ChatService._extract_relevant_content()`（约 100 行），将查询分词后与页面文本做子串匹配，取匹配数最高的 5 页。

### 1.2 重构后流程

```
用户问题 → Agent 自主推理 → Agent 按需调用工具 → Agent 整合结果 → 后处理引用
```

Agent 通过三个 `@function_tool` 自主决定何时获取文档信息、结构、具体页面内容，不再依赖关键词匹配。

### 1.3 模型配置

使用 DashScope 的 OpenAI 兼容端点，通过 `OpenAIChatCompletionsModel` 接入 Agent SDK：

```python
from openai import AsyncOpenAI
from agents import OpenAIChatCompletionsModel

client = AsyncOpenAI(
    base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
    api_key=settings.DASHSCOPE_API_KEY,
)
model = OpenAIChatCompletionsModel(
    model=settings.DEFAULT_MODEL,  # e.g. "qwen-plus"
    openai_client=client,
)
```

索引构建仍使用 LiteLLM（`dashscope/qwen-plus`），不做改动。

### 1.4 Agent 工具函数

封装 `PageIndexClient` 的三个核心方法，每个工具返回 JSON 字符串：

```python
@function_tool
def get_document() -> str:
    """获取文档元信息：状态、页数、描述"""
    return client.get_document(doc_id)

@function_tool
def get_document_structure() -> str:
    """获取文档层级树结构（无文本），用于定位相关章节"""
    return client.get_document_structure(doc_id)

@function_tool
def get_page_content(pages: str) -> str:
    """获取指定页面文本，格式: '5-7' 或 '3,8' 或 '12'"""
    return client.get_page_content(doc_id, pages)
```

### 1.5 Agent System Prompt

Agent 的 instructions 字段从数据库 `prompt_configs` 表读取，拼接方式：

```
instructions = agent_system 内容 + rag_template 内容
```

- `agent_system`：工具使用策略、推理行为控制
- `rag_template`：答案格式要求、LaTeX 规则、引用格式要求等

默认值示例（`agent_system`）：

```
You are PageIndex, a document QA assistant.
TOOL USE:
- Call get_document() first to confirm status and page/line count.
- Call get_document_structure() to identify relevant page ranges.
- Call get_page_content(pages="5-7") with tight ranges; never fetch the whole document.
- Before each tool call, output one short sentence explaining the reason.
Answer based only on tool output. Be concise.
```

默认值示例（`rag_template`）：

```
ANSWER FORMAT:
- Use $ ... $ for inline formulas, $$ ... $$ for display formulas.
  Do NOT use [ ... ] or \( ... \) for LaTeX.
- Cite sources with [1], [2] at the end of each sentence using document content.
- Only cite pages you actually used.
```

Agent 在回答时自动结合文档描述（从 `get_document()` 工具获取）和上述指令。后处理阶段仍然独立运行，执行 LaTeX bracket 转换和引用标记修正。

### 1.6 Agent 运行参数与兜底策略

Agent 每轮 tool call 都消耗 token 和时间，需要限制防止失控。这些参数存入数据库，前端可调整。

**参数定义：**

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `max_turns` | Agent 最大 tool call 轮数 | 5 |
| `max_tokens` | 单次 LLM 回答最大 token 数 | 2048 |
| `timeout_seconds` | Agent 整体超时（秒） | 60 |

**兜底策略：**

```
Agent 执行中
  ├─ 轮数达到 max_turns → 强制停止，返回已获取内容 + 最后一轮的部分回答
  ├─ 超过 timeout_seconds → 强制停止，同上
  └─ Agent SDK 异常 → fallback 到结构摘要 + litellm 直接调用路径
```

**实现方式：**

```python
async def query_with_guardrails(agent, prompt, params):
    max_turns = params.get("max_turns", 5)
    timeout = params.get("timeout_seconds", 60)

    try:
        result = await asyncio.wait_for(
            Runner.run(agent, prompt, max_turns=max_turns),
            timeout=timeout,
        )
        return result.final_output, False  # (answer, is_fallback)
    except asyncio.TimeoutError:
        # 超时兜底：用结构摘要 + 直接 LLM 调用
        return await fallback_query(...), True
    except Exception:
        return await fallback_query(...), True
```

`fallback_query` 保留现有的 `_extract_structure_summary()` + `litellm.completion()` 路径作为降级方案。

### 1.7 Agent 运行参数存储

将运行参数存入专用配置表（`system_configs`），与提示词版本管理分开，因为参数没有"版本"概念，只有当前生效值。

```python
class SystemConfig(Base):
    __tablename__ = "system_configs"

    key = Column(String, primary_key=True)        # e.g. agent_max_turns
    value = Column(String, nullable=False)         # 值，字符串存储
    description = Column(String)                   # 说明
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())
```

默认配置行：

| key | value | description |
|-----|-------|-------------|
| `agent_max_turns` | `5` | Agent 最大 tool call 轮数 |
| `agent_max_tokens` | `2048` | 单次 LLM 回答最大 token 数 |
| `agent_timeout_seconds` | `60` | Agent 整体超时秒数 |

**API：**

```
GET  /api/system-configs           — 获取所有配置
PUT  /api/system-configs/{key}     — 更新指定配置
```

**前端：** 在"系统配置"页面新增"Agent 参数"区域，表单直接编辑这三个值，保存后立即生效（无需重启）。

**缓存：** 与 prompt 缓存共用内存 dict，key 前缀 `config:` 区分。

### 1.8 错误处理与降级（汇总）

- Agent 轮数超限或超时 → 强制停止，返回已获取内容 + 部分回答
- Agent 工具调用失败 → 返回错误信息给 Agent，Agent 可尝试其他工具
- Agent SDK 整体异常 → fallback 回结构摘要 + litellm 直接调用
- 文本后处理（引用标记、LaTeX 转换）保持不变

---

## 二、提示词版本管理

### 2.1 提示词分类

| category | 说明 | 位置 |
|----------|------|------|
| `agent_system` | Agent 的 instructions，控制 Agent 行为和工具使用策略 | ChatService — Agent instructions 字段 |
| `rag_template` | RAG 问答模板，包含 LaTeX 格式要求、引用格式规则等，追加到 Agent system prompt 末尾 | ChatService — Agent instructions 字段 |
| `indexing` | 索引构建时的提示词（提取目录、生成摘要等），存储于 DB 供未来扩展读取；当前阶段索引逻辑在 pageindex 模块内部，暂不接入 DB 读取 | DocumentService / pageindex |
| `post_processing` | 后处理规则（引用标记格式、LaTeX 转换规则等），用于后处理函数的参考配置 | ChatService — 后处理阶段 |

**Agent 最终 instructions = agent_system 内容 + rag_template 内容（拼接）**

### 2.2 数据库模型

```python
class PromptConfig(Base):
    __tablename__ = "prompt_configs"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    category = Column(String, nullable=False)       # agent_system / rag_template / indexing / post_processing
    name = Column(String, nullable=False)           # 显示名称
    content = Column(Text, nullable=False)           # 提示词正文
    version = Column(Integer, nullable=False)        # 版本号，同 category 下自增
    is_active = Column(Boolean, default=False)       # 是否为当前生效版本
    description = Column(String)                     # 变更说明
    created_at = Column(DateTime, default=func.now())
```

约束：同一 `category` 下最多一个 `is_active=true`，应用层保证。

### 2.3 Alembic 迁移

新增迁移脚本创建 `prompt_configs` 表，并插入四条默认提示词（v1, is_active=true）。

### 2.4 API 设计

```
GET    /api/prompts                          — 列出所有 category 的当前生效版本
GET    /api/prompts/{category}               — 获取指定 category 的当前版本
GET    /api/prompts/{category}/versions      — 获取指定 category 的所有版本
POST   /api/prompts/{category}               — 创建新版本（自动设为 active）
PUT    /api/prompts/{category}/active/{id}   — 切换指定版本为 active
DELETE /api/prompts/{category}/versions/{id} — 删除指定版本（不能删 active）
```

### 2.5 缓存策略

内存缓存 dict `{category: content}`，写入时失效缓存。避免每次查询数据库。

```python
_prompt_cache: dict[str, str] = {}

async def get_active_prompt(category: str) -> str:
    if category in _prompt_cache:
        return _prompt_cache[category]
    # 从 DB 读取并缓存
    ...
    _prompt_cache[category] = content
    return content

def invalidate_cache(category: str = None):
    if category:
        _prompt_cache.pop(category, None)
    else:
        _prompt_cache.clear()
```

---

## 三、前端提示词管理

### 3.1 页面结构

新增"系统配置"入口（路由 `/prompts`），包含：

1. **提示词列表页** — 四个 Tab（Agent System / RAG Template / Indexing / Post-processing），每个 Tab 展示当前生效版本的名称和内容预览
2. **版本历史页** — 点击某个 category 后显示所有版本列表，标记 active 版本，支持切换
3. **编辑页** — 编辑提示词内容 + 填写变更说明，保存为新版本（自动设为 active）

### 3.2 前端组件

- `PromptConfig.tsx` — 提示词管理主页面
- `PromptVersionList.tsx` — 版本历史列表
- `PromptEditor.tsx` — 提示词编辑器（Monaco Editor 或 textarea）

---

## 四、完整数据流

```
用户发送问题
  ↓
ChatService.query_document()
  ↓
从 DB 读取 agent_system prompt + rag_template prompt
  ↓
创建 Agent（instructions=agent_system_prompt）
  ↓
Agent 自主推理，按需调用：
  - get_document()          → PageIndexClient → 返回 JSON
  - get_document_structure() → PageIndexClient → 返回 JSON
  - get_page_content(pages)  → PageIndexClient → 返回文本
  ↓
Agent 整合结果，生成回答
  ↓
后处理：LaTeX 转换 + 引用标记（规则从 DB 读取 post_processing prompt）
  ↓
返回 (answer, citations) → API 返回前端
```

---

## 五、文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `backend/app/models/database.py` | 修改 | 新增 `PromptConfig` 和 `SystemConfig` 模型 |
| `backend/alembic/versions/` | 新增 | 数据库迁移脚本（prompt_configs + system_configs 表） |
| `backend/app/schemas/schemas.py` | 修改 | 新增 Prompt / SystemConfig 相关 schema |
| `backend/app/services/document_service.py` | 重写 | ChatService 用 Agent 替代 litellm，含兜底策略 |
| `backend/app/services/prompt_service.py` | 新增 | 提示词 CRUD + 缓存 |
| `backend/app/main.py` | 修改 | 新增 `/api/prompts` 和 `/api/system-configs` 路由 |
| `frontend/src/pages/PromptConfig.tsx` | 新增 | 提示词管理 + Agent 参数配置页面 |
| `frontend/src/services/api.ts` | 修改 | 新增 Prompt / SystemConfig API 调用 |
| `frontend/src/App.tsx` | 修改 | 新增路由 |

---

## 六、测试策略

- 工具函数独立单测（mock `PageIndexClient`）
- 集成测试：mock `AsyncOpenAI` 验证 Agent 调用链路
- 提示词 CRUD 单测（版本创建、切换 active、删除校验）
