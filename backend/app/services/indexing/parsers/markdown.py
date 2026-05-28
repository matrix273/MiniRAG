"""
Markdown 解析器
从 Markdown 文件中提取结构化的节点和树结构
"""

import re
import asyncio
from typing import List, Dict, Tuple, Optional

from ..utils import (
    write_node_id, structure_to_list, format_structure, 
    print_json, print_toc
)
from app.utils.llm import count_tokens


def extract_nodes_from_markdown(markdown_content: str) -> Tuple[List[Dict], List[str]]:
    """
    从 Markdown 内容中提取所有标题节点
    
    Args:
        markdown_content: Markdown 文本内容
        
    Returns:
        (node_list, lines): 节点列表和原始行列表
    """
    header_pattern = r'^(#{1,6})\s+(.+)$'
    code_block_pattern = r'^```'
    node_list = []
    
    lines = markdown_content.split('\n')
    in_code_block = False
    
    for line_num, line in enumerate(lines, 1):
        stripped_line = line.strip()
        
        # 检查代码块边界
        if re.match(code_block_pattern, stripped_line):
            in_code_block = not in_code_block
            continue
        
        # 跳过空行
        if not stripped_line:
            continue
        
        # 仅在代码块外查找标题
        if not in_code_block:
            match = re.match(header_pattern, stripped_line)
            if match:
                title = match.group(2).strip()
                node_list.append({'node_title': title, 'line_num': line_num})

    return node_list, lines


def extract_node_text_content(node_list: List[Dict], markdown_lines: List[str]) -> List[Dict]:
    """
    为每个节点提取对应的文本内容
    
    Args:
        node_list: 节点列表
        markdown_lines: Markdown 原始行列表
        
    Returns:
        包含文本内容的节点列表
    """
    all_nodes = []
    for node in node_list:
        line_content = markdown_lines[node['line_num'] - 1]
        header_match = re.match(r'^(#{1,6})', line_content)
        
        if header_match is None:
            print(f"Warning: Line {node['line_num']} does not contain a valid header: '{line_content}'")
            continue
            
        processed_node = {
            'title': node['node_title'],
            'line_num': node['line_num'],
            'level': len(header_match.group(1))
        }
        all_nodes.append(processed_node)
    
    # 提取每个节点的文本内容
    for i, node in enumerate(all_nodes):
        start_line = node['line_num'] - 1 
        if i + 1 < len(all_nodes):
            end_line = all_nodes[i + 1]['line_num'] - 1 
        else:
            end_line = len(markdown_lines)
        
        node['text'] = '\n'.join(markdown_lines[start_line:end_line]).strip()
    
    return all_nodes


def update_node_list_with_text_token_count(node_list: List[Dict], model: str = None) -> List[Dict]:
    """
    计算每个节点（包含子节点）的 token 数量
    
    Args:
        node_list: 节点列表
        model: LLM 模型名称
        
    Returns:
        更新了 token 计数的节点列表
    """
    def find_all_children(parent_index: int, parent_level: int, nodes: List[Dict]) -> List[int]:
        """查找所有子节点的索引"""
        children_indices = []
        for i in range(parent_index + 1, len(nodes)):
            current_level = nodes[i]['level']
            if current_level <= parent_level:
                break
            children_indices.append(i)
        return children_indices
    
    result_list = node_list.copy()
    
    # 从后向前处理，确保子节点先于父节点处理
    for i in range(len(result_list) - 1, -1, -1):
        current_node = result_list[i]
        current_level = current_node['level']
        
        children_indices = find_all_children(i, current_level, result_list)
        
        # 合并节点自身和所有子节点的文本
        total_text = current_node.get('text', '')
        for child_index in children_indices:
            child_text = result_list[child_index].get('text', '')
            if child_text:
                total_text += '\n' + child_text
        
        result_list[i]['text_token_count'] = count_tokens(total_text, model=model)
    
    return result_list


def tree_thinning_for_index(node_list: List[Dict], min_node_token: int = None, model: str = None) -> List[Dict]:
    """
    树瘦身：将 token 数量少于阈值的节点合并到父节点
    
    Args:
        node_list: 节点列表
        min_node_token: 最小 token 阈值
        model: LLM 模型名称
        
    Returns:
        瘦身后的节点列表
    """
    def find_all_children(parent_index: int, parent_level: int, nodes: List[Dict]) -> List[int]:
        children_indices = []
        for i in range(parent_index + 1, len(nodes)):
            current_level = nodes[i]['level']
            if current_level <= parent_level:
                break
            children_indices.append(i)
        return children_indices
    
    result_list = node_list.copy()
    nodes_to_remove = set()
    
    for i in range(len(result_list) - 1, -1, -1):
        if i in nodes_to_remove:
            continue
            
        current_node = result_list[i]
        current_level = current_node['level']
        total_tokens = current_node.get('text_token_count', 0)
        
        if total_tokens < min_node_token:
            children_indices = find_all_children(i, current_level, result_list)
            
            children_texts = []
            for child_index in sorted(children_indices):
                if child_index not in nodes_to_remove:
                    child_text = result_list[child_index].get('text', '')
                    if child_text.strip():
                        children_texts.append(child_text)
                    nodes_to_remove.add(child_index)
            
            if children_texts:
                parent_text = current_node.get('text', '')
                merged_text = parent_text
                for child_text in children_texts:
                    if merged_text and not merged_text.endswith('\n'):
                        merged_text += '\n\n'
                    merged_text += child_text
                
                result_list[i]['text'] = merged_text
                result_list[i]['text_token_count'] = count_tokens(merged_text, model=model)
    
    for index in sorted(nodes_to_remove, reverse=True):
        result_list.pop(index)
    
    return result_list


def build_tree_from_nodes(node_list: List[Dict]) -> List[Dict]:
    """
    从扁平节点列表构建树结构
    
    Args:
        node_list: 扁平节点列表（包含 level 字段）
        
    Returns:
        树结构列表
    """
    if not node_list:
        return []
    
    stack = []
    root_nodes = []
    node_counter = 1
    
    for node in node_list:
        current_level = node['level']
        
        tree_node = {
            'title': node['title'],
            'node_id': str(node_counter).zfill(4),
            'text': node['text'],
            'line_num': node['line_num'],
            'nodes': []
        }
        node_counter += 1
        
        while stack and stack[-1][1] >= current_level:
            stack.pop()
        
        if not stack:
            root_nodes.append(tree_node)
        else:
            parent_node, parent_level = stack[-1]
            parent_node['nodes'].append(tree_node)
        
        stack.append((tree_node, current_level))
    
    return root_nodes


def clean_tree_for_output(tree_nodes: List[Dict]) -> List[Dict]:
    """
    清理树结构，移除不需要的字段
    
    Args:
        tree_nodes: 树节点列表
        
    Returns:
        清理后的树节点列表
    """
    cleaned_nodes = []
    
    for node in tree_nodes:
        cleaned_node = {
            'title': node['title'],
            'node_id': node['node_id'],
            'text': node['text'],
            'line_num': node['line_num']
        }
        
        if node['nodes']:
            cleaned_node['nodes'] = clean_tree_for_output(node['nodes'])
        
        cleaned_nodes.append(cleaned_node)
    
    return cleaned_nodes


def parse_markdown_file(file_path: str) -> Tuple[List[Dict], int]:
    """
    解析 Markdown 文件，返回节点列表和行数
    
    Args:
        file_path: Markdown 文件路径
        
    Returns:
        (node_list, line_count): 节点列表和行数
    """
    with open(file_path, 'r', encoding='utf-8') as f:
        markdown_content = f.read()
    
    line_count = markdown_content.count('\n') + 1
    
    node_list, markdown_lines = extract_nodes_from_markdown(markdown_content)
    nodes_with_content = extract_node_text_content(node_list, markdown_lines)
    
    return nodes_with_content, line_count


def build_markdown_tree(
    nodes: List[Dict],
    if_thinning: bool = False,
    min_token_threshold: int = None,
    if_add_node_id: str = 'yes',
    model: str = None
) -> List[Dict]:
    """
    构建 Markdown 树结构
    
    Args:
        nodes: 解析后的节点列表
        if_thinning: 是否进行树瘦身
        min_token_threshold: 瘦身的 token 阈值
        if_add_node_id: 是否添加节点 ID
        model: LLM 模型名称
        
    Returns:
        树结构
    """
    if if_thinning:
        nodes = update_node_list_with_text_token_count(nodes, model=model)
        nodes = tree_thinning_for_index(nodes, min_token_threshold, model=model)
    
    tree_structure = build_tree_from_nodes(nodes)
    
    if if_add_node_id == 'yes':
        write_node_id(tree_structure)
    
    return tree_structure


# 便捷函数
if __name__ == "__main__":
    import os
    import json
    
    # 测试用例
    test_md = """
# Chapter 1

This is chapter 1 content.

## Section 1.1

Section 1.1 content.

### Subsection 1.1.1

Subsection content.

## Section 1.2

Section 1.2 content.

# Chapter 2

Chapter 2 content.
"""
    
    node_list, lines = extract_nodes_from_markdown(test_md)
    print("Extracted nodes:")
    for node in node_list:
        print(f"  Line {node['line_num']}: {node['node_title']}")
    
    nodes_with_content = extract_node_text_content(node_list, lines)
    tree = build_tree_from_nodes(nodes_with_content)
    
    print("\nTree structure:")
    print_json(tree)
