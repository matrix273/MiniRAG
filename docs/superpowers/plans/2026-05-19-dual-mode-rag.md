# 双模式 RAG 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 PageIndex 添加"快速/深度"两种 RAG 查询模式切换功能

**Architecture:** 前端传递 mode 参数，后端根据模式路由到不同的查询方法。快速模式使用树结构搜索 + 单次 LLM 调用，深度模式保留现有 Agent 实现。

**Tech Stack:** Python (FastAPI), TypeScript (React + axios), PageIndex SDK

---

## 文件结构

```
backend/app/
├── schemas/schemas.py          # 修改 ChatMessageCreate
├── main.py                     # 修改 send_message 路由
└── services/document_service.py  # 新增 query_document_fast

frontend/src/
├── pages/ChatPage.tsx          # 添加模式切换 UI
└── services/api.ts             # 修改 sendMessage API
```

---

## Task 1: 后端 Schema 修改

**Files:**
- Modify: `backend/app/schemas/schemas.py`

- [ ] **Step 1: 查找 ChatMessageCreate 定义**

```bash
grep -n "class ChatMessageCreate" backend/app/schemas/schemas.py
```

- [ ] **Step 2: 修改 ChatMessageCreate 添加 mode 字段**

在 `content: str` 后添加：
```python
mode: str = "fast"  # "fast" | "deep"
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/schemas/schemas.py
git commit -m "feat: 添加 ChatMessageCreate mode 字段"
```

---

## Task 2: 后端实现 query_document_fast 方法

**Files:**
- Modify: `backend/app/services/document_service.py`

- [ ] **Step 1: 在 ChatService 类中添加 query_document_fast 方法（约 line 271 之后）**

```python
async def query_document_fast(
    self,
    document: Document,
    query: str,
    chat_history: list = None,
) -> tuple[str, list]:
    """
    使用简单 RAG（无 Agent）查询文档。
    
    流程：树搜索 -> 内容提取 -> 回答生成 -> 引用生成
    """
    import json
    from pageindex.utils import remove_fields, create_node_mapping

    doc_structure = document.structure
    if not doc_structure:
        return "Document structure not available. Please reindex the document.", []

    # 阶段 1: 树结构搜索
    relevant_node_ids = await self._tree_search_fast(query, doc_structure)

    # 阶段 2: 内容提取
    context = self._extract_node_content_fast(doc_structure, relevant_node_ids)

    # 阶段 3: 生成回答
    answer = await self._generate_answer_fast(
        query=query,
        context=context,
        document=document,
        chat_history=chat_history,
    )

    # 阶段 4: 生成引用
    citations = self._generate_citations_fast(
        doc_structure=doc_structure,
        node_ids=relevant_node_ids,
        doc_id=document.id,
    )

    return answer, citations
```

- [ ] **Step 2: 添加 _tree_search_fast 方法**

```python
async def _tree_search_fast(self, query: str, tree) -> list:
    """使用 LLM 在树结构中搜索相关节点"""
    import json
    from litellm import acompletion
    from pageindex.utils import remove_fields

    # 移除 text 字段，仅保留 title 和 summary
    tree_without_text = remove_fields(
        tree if isinstance(tree, list) else [tree],
        fields=['text']
    )

    # 构造搜索提示词
    search_prompt = f"""You are given a question and a tree structure of a document.
Each node contains a node id, node title, and a corresponding summary.
Your task is to find all nodes that are likely to contain the answer to the question.

Question: {query}

Document tree structure:
{json.dumps(tree_without_text, indent=2)}

Please reply in the following JSON format:
{{
    "thinking": "<Your thinking process on which nodes are relevant to the question>",
    "node_list": ["node_id_1", "node_id_2", ...]
}}
Directly return the final JSON structure. Do not output anything else."""

    model = os.environ.get("DEFAULT_MODEL", settings.DEFAULT_MODEL)
    if os.environ.get("DASHSCOPE_API_KEY"):
        os.environ["OPENAI_API_KEY"] = os.environ.get("DASHSCOPE_API_KEY")

    response = await acompletion(
        model=model,
        messages=[{"role": "user", "content": search_prompt}],
        temperature=0,
    )

    result = json.loads(response.choices[0].message.content)
    return result.get("node_list", [])
```

- [ ] **Step 3: 添加 _extract_node_content_fast 方法**

```python
def _extract_node_content_fast(self, tree, node_ids: list) -> str:
    """从相关节点提取全文内容"""
    from pageindex.utils import create_node_mapping

    if isinstance(tree, list):
        all_nodes = tree
    else:
        all_nodes = [tree]

    node_map = create_node_mapping(all_nodes)

    content_parts = []
    for node_id in node_ids:
        if node_id in node_map:
            node = node_map[node_id]
            text = node.get("text", "")
            if text:
                content_parts.append(text)

    return "\n\n".join(content_parts)
```

- [ ] **Step 4: 添加 _generate_answer_fast 方法**

```python
async def _generate_answer_fast(
    self,
    query: str,
    context: str,
    document: Document,
    chat_history: list = None,
) -> str:
    """基于上下文生成回答"""
    from litellm import acompletion

    # 获取系统提示词
    agent_prompt = await get_active_prompt("agent_system")
    rag_template = await get_active_prompt("rag_template")
    if rag_template:
        agent_prompt = f"{agent_prompt}\n\n{rag_template}"

    # 添加文档上下文
    agent_prompt += f"\n\nDocument: {document.original_name}"
    if document.doc_description:
        agent_prompt += f"\nDescription: {document.doc_description}"
    if document.page_count:
        agent_prompt += f"\nPages: {document.page_count}"

    # 添加聊天历史
    if chat_history:
        history_text = "\n".join(
            f"{msg.get('role', 'user')}: {msg.get('content', '')}"
            for msg in chat_history[-5:]
        )
        agent_prompt += f"\n\nChat history:\n{history_text}"

    # 构造用户消息
    user_message = f"""Answer the question based on the context:

Question: {query}

Context:
{context}

Provide a clear, concise answer based only on the context provided."""

    model = os.environ.get("DEFAULT_MODEL", settings.DEFAULT_MODEL)
    if os.environ.get("DASHSCOPE_API_KEY"):
        os.environ["OPENAI_API_KEY"] = os.environ.get("DASHSCOPE_API_KEY")

    response = await acompletion(
        model=model,
        messages=[
            {"role": "system", "content": agent_prompt},
            {"role": "user", "content": user_message},
        ],
        temperature=0.7,
        max_tokens=2000,
    )

    answer = response.choices[0].message.content
    answer = self._cleanup_tool_references(answer)
    answer = self._convert_latex_brackets(answer)

    return answer
```

- [ ] **Step 5: 添加 _generate_citations_fast 方法**

```python
def _generate_citations_fast(
    self,
    tree,
    node_ids: list,
    doc_id: str,
) -> list:
    """从节点 ID 生成引用"""
    from pageindex.utils import create_node_mapping

    if isinstance(tree, list):
        all_nodes = tree
    else:
        all_nodes = [tree]

    node_map = create_node_mapping(all_nodes)
    citations = []

    for node_id in node_ids:
        if node_id in node_map:
            node = node_map[node_id]
            citations.append({
                "page": node.get("page_index", 0),
                "text": node.get("text", "")[:2000],
                "node_title": node.get("title", ""),
                "document_id": doc_id,
            })

    return citations[:5]  # 限制最多 5 条引用
```

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/document_service.py
git commit -m "feat: 实现 query_document_fast 简单 RAG 方法"
```

---

## Task 3: 后端路由修改

**Files:**
- Modify: `backend/app/main.py`

- [ ] **Step 1: 修改 send_message 函数参数**

在 `message_data: ChatMessageCreate` 后添加对 mode 的读取：
```python
# 获取查询模式
query_mode = message_data.mode if hasattr(message_data, 'mode') else 'fast'
```

- [ ] **Step 2: 修改路由逻辑（约 line 550）**

在 `if len(documents) == 1:` 块中：
```python
if len(documents) == 1:
    # Single document query
    if query_mode == "fast":
        answer, citations = await chat_service.query_document_fast(
            document=documents[0],
            query=message_data.content,
            chat_history=chat_history,
        )
    else:
        answer, citations = await chat_service.query_document(
            document=documents[0],
            query=message_data.content,
            chat_history=chat_history,
        )
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/main.py
git commit -m "feat: 添加根据 mode 路由到不同查询方法"
```

---

## Task 4: 前端 API 修改

**Files:**
- Modify: `frontend/src/services/api.ts`

- [ ] **Step 1: 查找 sendMessage 方法定义**

```bash
grep -n "sendMessage" frontend/src/services/api.ts
```

- [ ] **Step 2: 修改 sendMessage 方法签名和请求**

```typescript
async sendMessage(
  sessionId: string,
  content: string,
  mode: "fast" | "deep" = "fast"
): Promise<ChatMessage> {
  const response = await axios.post<ChatMessage>(
    `/api/chat/${sessionId}/message`,
    { content, mode }
  );
  return response.data;
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/services/api.ts
git commit -m "feat: sendMessage API 支持 mode 参数"
```

---

## Task 5: 前端模式切换 UI

**Files:**
- Modify: `frontend/src/pages/ChatPage.tsx`

- [ ] **Step 1: 添加模式状态**

在现有状态声明附近添加：
```typescript
const [mode, setMode] = useState<"fast" | "deep">(
  () => (localStorage.getItem("chatMode") as "fast" | "deep") || "fast"
);
```

- [ ] **Step 2: 修改 handleSendMessage 传递 mode**

找到 `handleSendMessage` 函数，将 `chatApi.sendMessage(currentSession, inputMessage)` 修改为：
```typescript
chatApi.sendMessage(currentSession, inputMessage, mode)
```

- [ ] **Step 3: 添加模式切换组件**

在输入框上方添加：
```tsx
<div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
  <Button
    type={mode === "fast" ? "primary" : "default"}
    icon={<LightningOutlined />}
    onClick={() => {
      setMode("fast");
      localStorage.setItem("chatMode", "fast");
    }}
  >
    快速
  </Button>
  <Button
    type={mode === "deep" ? "primary" : "default"}
    icon={<SettingOutlined />}
    onClick={() => {
      setMode("deep");
      localStorage.setItem("chatMode", "deep");
    }}
  >
    深度
  </Button>
</div>
```

- [ ] **Step 4: 确认已导入图标**

确保文件顶部有：
```typescript
import { LightningOutlined, SettingOutlined } from '@ant-design/icons';
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/ChatPage.tsx
git commit -m "feat: 添加模式切换 UI 组件"
```

---

## Task 6: 测试验证

**Files:**
- Test: 手动测试

- [ ] **Step 1: 启动后端服务**

```bash
cd backend && uv run uvicorn app.main:app --reload
```

- [ ] **Step 2: 启动前端服务**

```bash
cd frontend && npm run dev
```

- [ ] **Step 3: 测试快速模式**

1. 打开浏览器 chat 页面
2. 选择"快速"模式（默认）
3. 发送问题，观察响应时间
4. 检查引用是否正确显示

- [ ] **Step 4: 测试深度模式**

1. 切换到"深度"模式
2. 发送相同问题
3. 对比响应时间和引用精度

- [ ] **Step 5: 测试模式切换持久化**

1. 刷新页面
2. 确认模式保持不变

---

## 执行选择

**Plan complete and saved to `docs/superpowers/plans/2026-05-19-dual-mode-rag.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**