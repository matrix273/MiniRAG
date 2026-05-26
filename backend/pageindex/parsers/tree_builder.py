"""通用树结构构建器 — 将 sections 列表转为嵌套树结构 JSON。"""


def build_tree_from_sections(sections: list[dict]) -> list[dict]:
    """
    将平铺的 sections 列表转为嵌套树结构。

    sections: [{level, title, text, ...}]
    输出: [{title, node_id, text, nodes: [...]}]

    与 page_index_md.py 中 build_tree_from_nodes() 的输出格式一致。
    """
    if not sections:
        return []

    stack: list[tuple[dict, int]] = []  # (node, level)
    root_nodes: list[dict] = []
    node_counter = 1

    for section in sections:
        level = section["level"]
        node = {
            "title": section["title"],
            "node_id": str(node_counter).zfill(4),
            "text": section.get("text", ""),
            "nodes": [],
        }
        node_counter += 1

        # 回溯栈，找到当前节点的父节点
        while stack and stack[-1][1] >= level:
            stack.pop()

        if not stack:
            root_nodes.append(node)
        else:
            parent_node, _ = stack[-1]
            parent_node["nodes"].append(node)

        stack.append((node, level))

    return root_nodes
