"""Vision utilities for PDF page image extraction and processing."""

import os
import base64
import tempfile
from pathlib import Path
from typing import List, Dict, Optional, Tuple
import pymupdf  # PyMuPDF


def pdf_page_to_image(
    pdf_path: str,
    page_num: int,
    output_dir: Optional[str] = None,
    image_format: str = "png",
    dpi: int = 150,
) -> str:
    """
    Convert a single PDF page to an image file.
    
    Args:
        pdf_path: Path to the PDF file
        page_num: Page number (1-indexed)
        output_dir: Directory to save the image (default: temp directory)
        image_format: Image format (png, jpg, jpeg)
        dpi: Image resolution (dots per inch)
    
    Returns:
        Path to the generated image file
    """
    if not os.path.exists(pdf_path):
        raise FileNotFoundError(f"PDF file not found: {pdf_path}")
    
    # Open the PDF
    doc = pymupdf.open(pdf_path)
    
    if page_num < 1 or page_num > len(doc):
        raise ValueError(f"Page number {page_num} is out of range (1-{len(doc)})")
    
    # Get the page (0-indexed internally)
    page = doc[page_num - 1]
    
    # Calculate zoom factor based on DPI (default PDF is 72 DPI)
    zoom = dpi / 72
    matrix = pymupdf.Matrix(zoom, zoom)
    
    # Render page to pixmap
    pix = page.get_pixmap(matrix=matrix)
    
    # Determine output path
    if output_dir:
        os.makedirs(output_dir, exist_ok=True)
        output_path = os.path.join(output_dir, f"page_{page_num}.{image_format}")
    else:
        # Use temp directory
        temp_dir = tempfile.mkdtemp()
        output_path = os.path.join(temp_dir, f"page_{page_num}.{image_format}")
    
    # Save the image
    if image_format.lower() in ("jpg", "jpeg"):
        pix.save(output_path, jpg_quality=95)
    else:
        pix.save(output_path)
    
    doc.close()
    return output_path


def pdf_pages_to_images(
    pdf_path: str,
    start_page: int = 1,
    end_page: Optional[int] = None,
    output_dir: Optional[str] = None,
    image_format: str = "png",
    dpi: int = 150,
) -> List[Dict]:
    """
    Convert multiple PDF pages to images.
    
    Args:
        pdf_path: Path to the PDF file
        start_page: Starting page number (1-indexed, default: 1)
        end_page: Ending page number (1-indexed, default: last page)
        output_dir: Directory to save images (default: temp directory)
        image_format: Image format (png, jpg, jpeg)
        dpi: Image resolution (dots per inch)
    
    Returns:
        List of dicts with page number and image path
    """
    if not os.path.exists(pdf_path):
        raise FileNotFoundError(f"PDF file not found: {pdf_path}")
    
    # Open the PDF to get total pages
    doc = pymupdf.open(pdf_path)
    total_pages = len(doc)
    doc.close()
    
    # Validate page range
    if end_page is None:
        end_page = total_pages
    
    if start_page < 1:
        start_page = 1
    if end_page > total_pages:
        end_page = total_pages
    
    if start_page > end_page:
        raise ValueError(f"Invalid page range: {start_page}-{end_page}")
    
    # Create output directory if specified
    if output_dir:
        os.makedirs(output_dir, exist_ok=True)
    else:
        output_dir = tempfile.mkdtemp()
    
    # Convert pages to images
    results = []
    for page_num in range(start_page, end_page + 1):
        image_path = pdf_page_to_image(
            pdf_path=pdf_path,
            page_num=page_num,
            output_dir=output_dir,
            image_format=image_format,
            dpi=dpi,
        )
        results.append({
            "page": page_num,
            "image_path": image_path,
            "format": image_format,
            "dpi": dpi,
        })
    
    return results


def pdf_page_to_base64(
    pdf_path: str,
    page_num: int,
    image_format: str = "png",
    dpi: int = 150,
) -> str:
    """
    Convert a PDF page to base64 encoded image.
    
    Args:
        pdf_path: Path to the PDF file
        page_num: Page number (1-indexed)
        image_format: Image format (png, jpg, jpeg)
        dpi: Image resolution (dots per inch)
    
    Returns:
        Base64 encoded image string
    """
    if not os.path.exists(pdf_path):
        raise FileNotFoundError(f"PDF file not found: {pdf_path}")
    
    # Open the PDF
    doc = pymupdf.open(pdf_path)
    
    if page_num < 1 or page_num > len(doc):
        raise ValueError(f"Page number {page_num} is out of range (1-{len(doc)})")
    
    # Get the page
    page = doc[page_num - 1]
    
    # Calculate zoom factor
    zoom = dpi / 72
    matrix = pymupdf.Matrix(zoom, zoom)
    
    # Render page to pixmap
    pix = page.get_pixmap(matrix=matrix)
    
    # Convert to bytes
    if image_format.lower() in ("jpg", "jpeg"):
        img_bytes = pix.tobytes("jpeg")
    else:
        img_bytes = pix.tobytes("png")
    
    # Encode to base64
    base64_str = base64.b64encode(img_bytes).decode("utf-8")
    
    doc.close()
    return base64_str


def pdf_pages_to_base64(
    pdf_path: str,
    start_page: int = 1,
    end_page: Optional[int] = None,
    image_format: str = "png",
    dpi: int = 150,
) -> List[Dict]:
    """
    Convert multiple PDF pages to base64 encoded images.
    
    Args:
        pdf_path: Path to the PDF file
        start_page: Starting page number (1-indexed, default: 1)
        end_page: Ending page number (1-indexed, default: last page)
        image_format: Image format (png, jpg, jpeg)
        dpi: Image resolution (dots per inch)
    
    Returns:
        List of dicts with page number and base64 encoded image
    """
    if not os.path.exists(pdf_path):
        raise FileNotFoundError(f"PDF file not found: {pdf_path}")
    
    # Open the PDF to get total pages
    doc = pymupdf.open(pdf_path)
    total_pages = len(doc)
    doc.close()
    
    # Validate page range
    if end_page is None:
        end_page = total_pages
    
    if start_page < 1:
        start_page = 1
    if end_page > total_pages:
        end_page = total_pages
    
    if start_page > end_page:
        raise ValueError(f"Invalid page range: {start_page}-{end_page}")
    
    # Convert pages to base64
    results = []
    for page_num in range(start_page, end_page + 1):
        base64_str = pdf_page_to_base64(
            pdf_path=pdf_path,
            page_num=page_num,
            image_format=image_format,
            dpi=dpi,
        )
        results.append({
            "page": page_num,
            "base64": base64_str,
            "format": image_format,
            "dpi": dpi,
        })
    
    return results


def get_pdf_page_count(pdf_path: str) -> int:
    """Get the total number of pages in a PDF file."""
    if not os.path.exists(pdf_path):
        raise FileNotFoundError(f"PDF file not found: {pdf_path}")
    
    doc = pymupdf.open(pdf_path)
    page_count = len(doc)
    doc.close()
    return page_count


def cleanup_temp_images(image_paths: List[str]) -> None:
    """Clean up temporary image files."""
    for path in image_paths:
        try:
            if os.path.exists(path):
                os.remove(path)
        except Exception as e:
            print(f"Warning: Failed to delete temp image {path}: {e}")


def cleanup_temp_dir(dir_path: str) -> None:
    """Clean up temporary directory."""
    try:
        if os.path.exists(dir_path):
            import shutil
            shutil.rmtree(dir_path)
    except Exception as e:
        print(f"Warning: Failed to delete temp directory {dir_path}: {e}")