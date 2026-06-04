import os
import uuid
import json
import asyncio
import concurrent.futures
from pathlib import Path

import PyPDF2

from .pdf_indexer import page_index
from .md_indexer import md_to_tree
from .retrieval import get_document, get_document_structure, get_page_content
from .utils import ConfigLoader, remove_fields

META_INDEX = "_meta.json"


def _normalize_retrieve_model(model: str) -> str:
    """Preserve supported Agents SDK prefixes and route other provider paths via LiteLLM."""
    passthrough_prefixes = ("litellm/", "openai/")
    if not model or "/" not in model:
        return model
    if model.startswith(passthrough_prefixes):
        return model
    return f"litellm/{model}"


class PageIndexClient:
    """
    A client for indexing and retrieving document content.
    Flow: index() -> get_document() / get_document_structure() / get_page_content()

    For agent-based QA, see examples/agentic_vectorless_rag_demo.py.
    """
    def __init__(self, api_key: str = None, model: str = None, retrieve_model: str = None, workspace: str = None, vision_model: str = None, vision_enabled: bool = False):
        if api_key:
            os.environ["OPENAI_API_KEY"] = api_key
        elif not os.getenv("OPENAI_API_KEY") and os.getenv("CHATGPT_API_KEY"):
            os.environ["OPENAI_API_KEY"] = os.getenv("CHATGPT_API_KEY")
        self.workspace = Path(workspace).expanduser() if workspace else None
        overrides = {}
        if model:
            overrides["model"] = model
        if retrieve_model:
            overrides["retrieve_model"] = retrieve_model
        opt = ConfigLoader().load(overrides or None)
        self.model = opt.model
        self.retrieve_model = _normalize_retrieve_model(opt.retrieve_model or self.model)
        self.vision_model = vision_model or "dashscope/qwen-vl-plus"
        self.vision_enabled = vision_enabled
        if self.workspace:
            self.workspace.mkdir(parents=True, exist_ok=True)
        self.documents = {}
        if self.workspace:
            self._load_workspace()

    def index(self, file_path: str, mode: str = "auto") -> str:
        """Index a document. Returns a document_id."""
        # Persist a canonical absolute path so workspace reloads do not
        # reinterpret caller-relative paths against the workspace directory.
        file_path = os.path.abspath(os.path.expanduser(file_path))
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"File not found: {file_path}")

        doc_id = str(uuid.uuid4())
        ext = os.path.splitext(file_path)[1].lower()

        is_pdf = ext == '.pdf'
        is_md = ext in ['.md', '.markdown']

        if mode == "pdf" or (mode == "auto" and is_pdf):
            print(f"Indexing PDF: {file_path}")
            result = page_index(
                doc=file_path,
                model=self.model,
                if_add_node_summary='yes',
                if_add_node_text='yes',
                if_add_node_id='yes',
                if_add_doc_description='yes'
            )
            # Extract per-page text so queries don't need the original PDF
            pages = []
            with open(file_path, 'rb') as f:
                pdf_reader = PyPDF2.PdfReader(f)
                for i, page in enumerate(pdf_reader.pages, 1):
                    pages.append({'page': i, 'content': page.extract_text() or ''})

            self.documents[doc_id] = {
                'id': doc_id,
                'type': 'pdf',
                'path': file_path,
                'doc_name': result.get('doc_name', ''),
                'doc_description': result.get('doc_description', ''),
                'page_count': len(pages),
                'structure': result['structure'],
                'pages': pages,
            }

        elif mode == "md" or (mode == "auto" and is_md):
            print(f"Indexing Markdown: {file_path}")
            coro = md_to_tree(
                md_path=file_path,
                if_thinning=False,
                if_add_node_summary='yes',
                summary_token_threshold=200,
                model=self.model,
                if_add_doc_description='yes',
                if_add_node_text='yes',
                if_add_node_id='yes'
            )
            try:
                asyncio.get_running_loop()
                with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                    result = pool.submit(asyncio.run, coro).result()
            except RuntimeError:
                result = asyncio.run(coro)
            self.documents[doc_id] = {
                'id': doc_id,
                'type': 'md',
                'path': file_path,
                'doc_name': result.get('doc_name', ''),
                'doc_description': result.get('doc_description', ''),
                'line_count': result.get('line_count', 0),
                'structure': result['structure'],
            }

        elif mode == "docx" or (mode == "auto" and ext == '.docx'):
            print(f"Indexing DOCX: {file_path}")
            from .parsers.office_to_tree import docx_to_tree
            result = docx_to_tree(
                file_path,
                model=self.model,
                if_add_node_summary='yes',
                if_add_node_text='yes',
                if_add_node_id='yes',
                if_add_doc_description='yes',
            )
            self.documents[doc_id] = {
                'id': doc_id,
                'type': 'docx',
                'path': file_path,
                'doc_name': result.get('doc_name', ''),
                'doc_description': result.get('doc_description', ''),
                'page_count': result.get('metadata', {}).get('paragraph_count', 0),
                'structure': result['structure'],
            }

        elif mode == "xlsx" or (mode == "auto" and ext == '.xlsx'):
            print(f"Indexing XLSX: {file_path}")
            from .parsers.office_to_tree import xlsx_to_tree
            result = xlsx_to_tree(
                file_path,
                model=self.model,
                if_add_node_summary='yes',
                if_add_node_text='yes',
                if_add_node_id='yes',
                if_add_doc_description='yes',
            )
            self.documents[doc_id] = {
                'id': doc_id,
                'type': 'xlsx',
                'path': file_path,
                'doc_name': result.get('doc_name', ''),
                'doc_description': result.get('doc_description', ''),
                'page_count': result.get('metadata', {}).get('sheet_count', 0),
                'structure': result['structure'],
            }

        elif mode == "pptx" or (mode == "auto" and ext == '.pptx'):
            print(f"Indexing PPTX: {file_path}")
            from .parsers.office_to_tree import pptx_to_tree
            result = pptx_to_tree(
                file_path,
                model=self.model,
                if_add_node_summary='yes',
                if_add_node_text='yes',
                if_add_node_id='yes',
                if_add_doc_description='yes',
            )
            # Extract per-slide text so queries get the right slide content
            structure = result['structure']
            pages = []
            def _walk_pptx_nodes(nodes):
                for node in nodes:
                    slide_num = node.get('start_index') or node.get('end_index', 0)
                    if slide_num:
                        pages.append({
                            'page': slide_num,
                            'content': f"## {node.get('title', '')}\n{node.get('text', '')}"
                        })
                    if node.get('nodes'):
                        _walk_pptx_nodes(node['nodes'])
            _walk_pptx_nodes(structure)

            self.documents[doc_id] = {
                'id': doc_id,
                'type': 'pptx',
                'path': file_path,
                'doc_name': result.get('doc_name', ''),
                'doc_description': result.get('doc_description', ''),
                'page_count': result.get('metadata', {}).get('slide_count', 0),
                'structure': structure,
                'pages': pages,
            }

        else:
            raise ValueError(f"Unsupported file format for: {file_path}")

        print(f"Indexing complete. Document ID: {doc_id}")
        if self.workspace:
            self._save_doc(doc_id)
        return doc_id

    @staticmethod
    def _make_meta_entry(doc: dict) -> dict:
        """Build a lightweight meta entry from a document dict."""
        entry = {
            'type': doc.get('type', ''),
            'doc_name': doc.get('doc_name', ''),
            'doc_description': doc.get('doc_description', ''),
            'path': doc.get('path', ''),
        }
        if doc.get('type') == 'pdf':
            entry['page_count'] = doc.get('page_count')
        elif doc.get('type') == 'md':
            entry['line_count'] = doc.get('line_count')
        elif doc.get('type') in ('docx', 'xlsx', 'pptx'):
            entry['page_count'] = doc.get('page_count')
        return entry

    @staticmethod
    def _read_json(path) -> dict | None:
        """Read a JSON file, returning None on any error."""
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError) as e:
            print(f"Warning: corrupt {Path(path).name}: {e}")
            return None

    def _save_doc(self, doc_id: str):
        doc = self.documents[doc_id].copy()
        # Strip text from structure nodes — redundant with pages (PDF only)
        if doc.get('structure') and doc.get('type') == 'pdf':
            doc['structure'] = remove_fields(doc['structure'], fields=['text'])
        path = self.workspace / f"{doc_id}.json"
        with open(path, "w", encoding="utf-8") as f:
            json.dump(doc, f, ensure_ascii=False, indent=2)
        self._save_meta(doc_id, self._make_meta_entry(doc))
        # Drop heavy fields; will lazy-load on demand
        self.documents[doc_id].pop('structure', None)
        self.documents[doc_id].pop('pages', None)

    def _rebuild_meta(self) -> dict:
        """Scan individual doc JSON files and return a meta dict."""
        meta = {}
        for path in self.workspace.glob("*.json"):
            if path.name == META_INDEX:
                continue
            doc = self._read_json(path)
            if doc and isinstance(doc, dict):
                meta[path.stem] = self._make_meta_entry(doc)
        return meta

    def _read_meta(self) -> dict | None:
        """Read and validate _meta.json, returning None on any corruption."""
        meta = self._read_json(self.workspace / META_INDEX)
        if meta is not None and not isinstance(meta, dict):
            print(f"Warning: {META_INDEX} is not a JSON object, ignoring")
            return None
        return meta

    def _save_meta(self, doc_id: str, entry: dict):
        meta = self._read_meta() or self._rebuild_meta()
        meta[doc_id] = entry
        meta_path = self.workspace / META_INDEX
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump(meta, f, ensure_ascii=False, indent=2)

    def _load_workspace(self):
        meta = self._read_meta()
        if meta is None:
            meta = self._rebuild_meta()
            if meta:
                print(f"Loaded {len(meta)} document(s) from workspace (legacy mode).")
        for doc_id, entry in meta.items():
            doc = dict(entry, id=doc_id)
            if doc.get('path') and not os.path.isabs(doc['path']):
                doc['path'] = str((self.workspace / doc['path']).resolve())
            self.documents[doc_id] = doc

    def _ensure_doc_loaded(self, doc_id: str):
        """Load full document JSON on demand (structure, pages, etc.)."""
        doc = self.documents.get(doc_id)
        if not doc or doc.get('structure') is not None:
            return
        full = self._read_json(self.workspace / f"{doc_id}.json")
        if not full:
            return
        doc['structure'] = full.get('structure', [])
        if full.get('pages'):
            doc['pages'] = full['pages']

    def get_document(self, doc_id: str) -> str:
        """Return document metadata JSON."""
        return get_document(self.documents, doc_id)

    def get_document_structure(self, doc_id: str) -> str:
        """Return document tree structure JSON (without text fields)."""
        if self.workspace:
            self._ensure_doc_loaded(doc_id)
        return get_document_structure(self.documents, doc_id)

    def get_page_content(self, doc_id: str, pages: str) -> str:
        """Return page content for the given pages string (e.g. '5-7', '3,8', '12')."""
        if self.workspace:
            self._ensure_doc_loaded(doc_id)
        return get_page_content(self.documents, doc_id, pages)
    
    def get_page_images(self, doc_id: str, pages: str, output_dir: str = None, dpi: int = 150) -> list:
        """
        Get page images for the given pages string.
        
        Args:
            doc_id: Document ID
            pages: Pages string (e.g. '5-7', '3,8', '12')
            output_dir: Directory to save images (default: temp directory)
            dpi: Image resolution (dots per inch)
        
        Returns:
            List of dicts with page number and image path
        """
        from .vision import pdf_pages_to_images
        
        doc_info = self.documents.get(doc_id)
        if not doc_info:
            return []
        
        if doc_info.get('type') != 'pdf':
            return []
        
        # Parse pages string
        page_nums = self._parse_pages_string(pages)
        if not page_nums:
            return []
        
        # Convert pages to images
        return pdf_pages_to_images(
            pdf_path=doc_info['path'],
            start_page=min(page_nums),
            end_page=max(page_nums),
            output_dir=output_dir,
            dpi=dpi,
        )
    
    def get_page_images_base64(self, doc_id: str, pages: str, dpi: int = 150) -> list:
        """
        Get page images as base64 encoded strings.
        
        Args:
            doc_id: Document ID
            pages: Pages string (e.g. '5-7', '3,8', '12')
            dpi: Image resolution (dots per inch)
        
        Returns:
            List of dicts with page number and base64 encoded image
        """
        from .vision import pdf_pages_to_base64
        
        doc_info = self.documents.get(doc_id)
        if not doc_info:
            return []
        
        if doc_info.get('type') != 'pdf':
            return []
        
        # Parse pages string
        page_nums = self._parse_pages_string(pages)
        if not page_nums:
            return []
        
        # Convert pages to base64
        return pdf_pages_to_base64(
            pdf_path=doc_info['path'],
            start_page=min(page_nums),
            end_page=max(page_nums),
            dpi=dpi,
        )
    
    def _parse_pages_string(self, pages: str) -> list:
        """Parse pages string like '5-7', '3,8', or '12' into a sorted list of ints."""
        result = []
        for part in pages.split(','):
            part = part.strip()
            if '-' in part:
                start, end = int(part.split('-', 1)[0].strip()), int(part.split('-', 1)[1].strip())
                if start > end:
                    continue
                result.extend(range(start, end + 1))
            else:
                try:
                    result.append(int(part))
                except ValueError:
                    continue
        return sorted(set(result))
