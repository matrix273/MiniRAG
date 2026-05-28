from dataclasses import dataclass, field


@dataclass
class ParseResult:
    """统一的解析结果数据类。"""
    content: str                              # 提取的文本内容（Markdown 格式）
    metadata: dict = field(default_factory=dict)  # 元信息
    sections: list[dict] = field(default_factory=list)  # 结构化章节列表