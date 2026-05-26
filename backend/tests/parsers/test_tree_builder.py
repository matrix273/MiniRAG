from pageindex.parsers.tree_builder import build_tree_from_sections


def test_flat_sections():
    sections = [
        {"level": 1, "title": "Intro", "text": "Hello"},
        {"level": 1, "title": "Body", "text": "World"},
    ]
    tree = build_tree_from_sections(sections)
    assert len(tree) == 2
    assert tree[0]["title"] == "Intro"
    assert tree[0]["node_id"] == "0001"
    assert tree[1]["node_id"] == "0002"


def test_nested_sections():
    sections = [
        {"level": 1, "title": "Chapter 1", "text": ""},
        {"level": 2, "title": "Section 1.1", "text": "Content"},
        {"level": 2, "title": "Section 1.2", "text": "More"},
        {"level": 1, "title": "Chapter 2", "text": ""},
    ]
    tree = build_tree_from_sections(sections)
    assert len(tree) == 2
    assert tree[0]["title"] == "Chapter 1"
    assert len(tree[0]["nodes"]) == 2
    assert tree[0]["nodes"][0]["title"] == "Section 1.1"
    assert tree[1]["title"] == "Chapter 2"
    assert len(tree[1]["nodes"]) == 0


def test_node_id_assigned():
    sections = [
        {"level": 1, "title": "A", "text": ""},
        {"level": 2, "title": "A.1", "text": ""},
    ]
    tree = build_tree_from_sections(sections)
    assert tree[0]["node_id"] == "0001"
    assert tree[0]["nodes"][0]["node_id"] == "0002"


def test_empty_sections():
    assert build_tree_from_sections([]) == []


def test_deeply_nested():
    sections = [
        {"level": 1, "title": "L1", "text": ""},
        {"level": 2, "title": "L2", "text": ""},
        {"level": 3, "title": "L3", "text": "Deep"},
    ]
    tree = build_tree_from_sections(sections)
    assert len(tree) == 1
    assert len(tree[0]["nodes"]) == 1
    assert len(tree[0]["nodes"][0]["nodes"]) == 1
    assert tree[0]["nodes"][0]["nodes"][0]["title"] == "L3"
