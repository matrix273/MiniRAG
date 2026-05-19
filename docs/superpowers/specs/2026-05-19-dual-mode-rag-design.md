# 双模式 RAG 设计文档

## 概述

为 PageIndex 添加"快速/深度"两种查询模式。快速模式采用无 Agent 的简单 RAG（参照 `pageindex_RAG_simple.ipynb`），深度模式保留当前的 Agentic RAG 实现。

---

## 1. 需求分析

### 1.1 用户需求
- 前端支持切换查询模式（快速/深度）
- 快速模式响应速度显著优于当前 Agent 模式
- 快速模式需支持精确引用生成

### 1.2 性能目标
| 指标 | 深度模式 | 快速模式 |
|------|----------|----------|
| 响应时间 | 30-60s | 3-5s |
| 调用次数 | 多次（Agent 循环） | 2次（树搜索 + 回答） |
| 引用精度 | 高 | 中-高 |

---

## 2. 系统架构

### 2.1 当前架构
```
前端 → POST /api/chat/{session_id}/message → 后端
        ↓
    ChatService.query_document()
        ↓
    Agent SDK (多轮工具调用)
        ↓
    生成回答 + 引用
```

### 2.2 新架构
```
前端 → POST /api/chat/{session_id}/message { mode: "fast" | "deep" }
        ↓
    根据 mode 路由
        ├── mode="fast"  → ChatService.query_document_fast()
        └── mode="deep"  → ChatService.query_document() [现有]
```

---

## 3. 模式切换设计

### 3.1 前端设计

#### 3.1.1 模式切换位置
在 ChatPage 输入框左侧添加模式切换按钮。

#### 3.1.2 交互设计
- 两种模式：快速（闪电图标）、深度（齿轮图标）
- 默认选中"快速"模式
- 切换时保持当前会话
- 模式选择持久化到 localStorage

#### 3.1.3 UI 组件
```
┌─────────────────────────────────────────────┐
│  [⚡ 快速] [🔧 深度]                        │
│                                             │
│  输入框内容...                          [发送]│
└─────────────────────────────────────────────┘
```

### 3.2 后端设计

#### 3.2.1 请求格式
```json
POST /api/chat/{session_id}/message
{
  "content": "用户的问题",
  "mode": "fast"  // 或 "deep"
}
```

#### 3.2.2 响应格式
保持现有格式不变，引用精度由后端保证。

---

## 4. 快速模式实现

### 4.1 核心流程（参照 `pageindex_RAG_simple.ipynb`）

#### 阶段 1: 树结构搜索
1. 获取文档树结构（仅包含 title、summary，不含全文）
2. 使用 LLM 分析树结构，识别与问题相关的节点
3. 返回相关节点 ID 列表

#### 阶段 2: 内容提取
1. 从相关节点提取全文内容
2. 组织为上下文文本

#### 阶段 3: 回答生成
1. 将问题 + 上下文 + 系统提示词发送给 LLM
2. 生成最终回答

### 4.2 引用生成

从阶段 1 识别的相关节点中提取引用：
- 每个相关节点生成一条引用
- 引用包含：页码、节点标题、节点内容摘要

```python
citations = [
    {
        "page": node["page_index"],
        "text": node["text"][:2000],  # 限制长度
        "node_title": node["title"],
        "document_id": doc_id
    }
    for node in relevant_nodes
]
```

---

## 5. 代码实现

### 5.1 前端文件

#### `frontend/src/pages/ChatPage.tsx`
1. 添加模式状态：`const [mode, setMode] = useState<"fast" | "deep">("fast")`
2. 修改 `handleSendMessage`，传递 mode 参数
3. 添加模式切换 UI 组件

#### `frontend/src/services/api.ts`
1. 修改 `sendMessage` 方法，接受 mode 参数
2. 传递到请求体

### 5.2 后端文件

#### `backend/app/schemas/schemas.py`
1. 修改 `ChatMessageCreate`，添加 `mode` 字段：
```python
class ChatMessageCreate(BaseModel):
    content: str
    mode: str = "fast"  # "fast" | "deep"
```

#### `backend/app/main.py`
1. 修改 `send_message` 函数，根据 mode 路由：
```python
if message_data.mode == "fast":
    answer, citations = await chat_service.query_document_fast(
        document=documents[0],
        query=message_data.content,
        chat_history=chat_history,
    )
else:
    # 现有深度模式逻辑
```

#### `backend/app/services/document_service.py`
1. 新增 `query_document_fast()` 方法，实现简单 RAG：
```python
async def query_document_fast(
    self,
    document: Document,
    query: str,
    chat_history: list = None,
) -> tuple[str, list]:
    # 1. 获取树结构
    tree = document.structure
    
    # 2. 树结构搜索
    relevant_nodes = await self._tree_search(query, tree)
    
    # 3. 提取内容
    context = self._extract_node_content(relevant_nodes)
    
    # 4. 生成回答
    answer = await self._generate_answer(query, context, chat_history)
    
    # 5. 生成引用
    citations = self._generate_citations(relevant_nodes, document.id)
    
    return answer, citations
```

2. 新增 `_tree_search()` 方法：
```python
async def _tree_search(self, query: str, tree: dict) -> list:
    """使用 LLM 在树结构中搜索相关节点"""
    # 移除 text 字段，仅保留 title 和 summary
    tree_without_text = self._remove_text_fields(tree.copy())
    
    # 构造搜索提示词
    search_prompt = f"""
    You are given a question and a tree structure of a document.
    Each node contains a node id, node title, and a corresponding summary.
    Your task is to find all nodes that are likely to contain the answer to the question.
    
    Question: {query}
    
    Document tree structure:
    {json.dumps(tree_without_text, indent=2)}
    
    Please reply in the following JSON format:
    {{
        "thinking": "Your thinking process",
        "node_list": ["node_id_1", "node_id_2"]
    }}
    """
    
    # 调用 LLM
    response = await acompletion(model=model, messages=[...])
    result = json.loads(response)
    return result["node_list"]
```

3. 新增 `_generate_citations()` 方法：
```python
def _generate_citations(self, node_ids: list, doc_id: str) -> list:
    """从节点 ID 生成引用"""
    node_map = create_node_mapping(self.current_tree)
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
    
    return citations
```

---

## 6. 测试策略

### 6.1 单元测试
- `_tree_search()` 返回正确的节点 ID
- `_generate_citations()` 生成正确的引用格式
- 模式路由逻辑正确

### 6.2 集成测试
- 快速模式端到端测试
- 模式切换不影响现有功能
- 引用准确性验证

### 6.3 性能测试
- 快速模式响应时间 < 5s
- 深度模式性能无退化

---

## 7. 实施计划

### Phase 1: 后端核心
1. 修改 schema 添加 mode 字段
2. 实现 `query_document_fast()` 方法
3. 实现 `_tree_search()` 和 `_generate_citations()`
4. 修改路由逻辑

### Phase 2: 前端集成
1. 添加模式切换 UI
2. 修改 API 调用传递 mode
3. 添加模式状态持久化

### Phase 3: 测试与优化
1. 编写单元测试
2. 集成测试
3. 性能优化

---

## 8. 风险与缓解

### 8.1 风险
- 快速模式引用精度不如深度模式
- 树搜索可能遗漏重要节点

### 8.2 缓解
- 明确告知用户两种模式的差异
- 可考虑添加"中等"模式作为折中
- 树搜索使用更详细的 summary

---

## 9. 未来扩展

- 添加流式响应支持
- 添加搜索结果高亮
- 添加用户反馈机制（标记引用准确性）
