#!/usr/bin/env python3
"""
CCCD Deep QR Scanner Module
Port của logic quét sâu từ TypeScript app (src/lib/cccd-qr.ts)

Các kỹ thuật:
- Priority regions: Tập trung vào vùng góc phải trên và phải giữa
- Smart upscaling: Tăng resolution lên 1600-2000px
- Contrast enhancement: Histogram equalization
- Binarization: Otsu's thresholding
- Rotation: 90°, 180°, 270° (full mode)
"""

import cv2
import numpy as np
from PIL import Image
from pyzbar import pyzbar
from typing import Optional, Dict, List, Tuple, Callable
from io import BytesIO
import time

# Constants (ported from TypeScript)
SCAN_REGION_OVERLAP_RATIO = 0.08
AUTO_LONG_EDGE = 1600
BASIC_LONG_EDGE = 1200
FULL_LONG_EDGE = 2000
MAX_UPSCALE = 3


class ScanMode:
    AUTO = "auto"
    BASIC = "basic"
    FULL = "full"


class ScanResult:
    def __init__(self, success: bool, data: Optional[Dict] = None, reason: Optional[str] = None):
        self.success = success
        self.data = data
        self.reason = reason


def parse_cccd_qr_text(text: str) -> Optional[Dict]:
    """
    Parse QR code text theo format CCCD Việt Nam
    Format: cccd|oldIdentity|fullName|dob|gender|address|issuedDate
    """
    if not text:
        return None

    # Normalize text
    normalized = text.replace('\u0000', '').replace('\r', '').replace('\n', '').strip()
    parts = [p.strip() for p in normalized.split('|')]

    if len(parts) < 6:
        return None

    return {
        'cccd': parts[0].strip() if len(parts) > 0 else '',
        'oldIdentity': parts[1].strip() if len(parts) > 1 else '',
        'fullName': parts[2].strip() if len(parts) > 2 else '',
        'dateOfBirth': normalize_date(parts[3]) if len(parts) > 3 else '',
        'gender': parts[4].strip() if len(parts) > 4 else '',
        'address': parts[5].strip() if len(parts) > 5 else '',
        'issuedDate': normalize_date(parts[6]) if len(parts) > 6 else ''
    }


def normalize_date(value: str) -> str:
    """Normalize date từ format DDMMYYYY sang DD-MM-YYYY"""
    if not value:
        return ''

    text = str(value).strip()

    # Format DDMMYYYY (8 digits)
    if len(text) == 8 and text.isdigit():
        return f"{text[0:2]}-{text[2:4]}-{text[4:8]}"

    return text


def build_priority_regions(width: int, height: int) -> List[Dict]:
    """
    Tạo danh sách các vùng ưu tiên để quét
    Mẫu cũ có QR ở góc trên phải; mẫu mới thường nằm gần trung tâm bên phải
    """
    half_width = width / 2
    half_height = height / 2
    overlap_x = (width * SCAN_REGION_OVERLAP_RATIO) / 2
    overlap_y = (height * SCAN_REGION_OVERLAP_RATIO) / 2
    right_x = max(0, half_width - overlap_x)

    return [
        # Góc phải trên (thường chứa QR trong CCCD mẫu cũ)
        {
            'x': int(right_x),
            'y': 0,
            'width': int(width - right_x),
            'height': int(half_height + overlap_y)
        },
        # Phải toàn bộ (thường chứa QR trong CCCD mẫu mới)
        {
            'x': int(right_x),
            'y': 0,
            'width': int(width - right_x),
            'height': height
        }
    ]


def render_scan_region(image: np.ndarray, region: Dict, target_long_edge: int) -> Optional[np.ndarray]:
    """
    Render một vùng của ảnh với upscaling thông minh
    """
    height, width = image.shape[:2]

    # Crop region
    x = max(0, int(region['x']))
    y = max(0, int(region['y']))
    w = min(width - x, int(region['width']))
    h = min(height - y, int(region['height']))

    if w <= 0 or h <= 0:
        return None

    cropped = image[y:y+h, x:x+w]

    # Calculate scale
    source_long_edge = max(w, h)
    requested_scale = target_long_edge / source_long_edge
    scale = min(requested_scale, MAX_UPSCALE) if requested_scale > 1 else requested_scale

    if scale == 1:
        return cropped

    # Upscale with high quality interpolation
    new_w = max(1, int(w * scale))
    new_h = max(1, int(h * scale))

    # INTER_CUBIC cho upscaling, INTER_AREA cho downscaling
    interpolation = cv2.INTER_CUBIC if scale > 1 else cv2.INTER_AREA
    resized = cv2.resize(cropped, (new_w, new_h), interpolation=interpolation)

    return resized


def enhance_qr_image(image: np.ndarray) -> np.ndarray:
    """
    Tăng độ tương phản bằng histogram equalization
    Port của enhanceQrImage từ TypeScript
    """
    # Convert to grayscale if needed
    if len(image.shape) == 3:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    else:
        gray = image.copy()

    # Calculate histogram
    hist = cv2.calcHist([gray], [0], None, [256], [0, 256])
    pixel_count = gray.shape[0] * gray.shape[1]

    # Find percentiles (1% and 99%)
    cumsum = np.cumsum(hist)
    low = np.argmax(cumsum >= pixel_count * 0.01)
    high = np.argmax(cumsum >= pixel_count * 0.99)

    # Stretch contrast
    range_val = max(24, high - low)
    normalized = ((gray.astype(float) - low) * 255 / range_val)

    # Apply additional contrast
    contrasted = ((normalized - 128) * 1.2 + 128)
    contrasted = np.clip(contrasted, 0, 255).astype(np.uint8)

    return contrasted


def threshold_qr_image(image: np.ndarray) -> np.ndarray:
    """
    Binarization bằng Otsu's thresholding
    Port của thresholdQrImage từ TypeScript
    """
    # Convert to grayscale if needed
    if len(image.shape) == 3:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    else:
        gray = image.copy()

    # Apply Otsu's thresholding
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

    return binary


def rotate_image(image: np.ndarray, rotation: int) -> np.ndarray:
    """
    Xoay ảnh 90, 180, hoặc 270 độ
    """
    if rotation == 90:
        return cv2.rotate(image, cv2.ROTATE_90_CLOCKWISE)
    elif rotation == 180:
        return cv2.rotate(image, cv2.ROTATE_180)
    elif rotation == 270:
        return cv2.rotate(image, cv2.ROTATE_90_COUNTERCLOCKWISE)
    return image


def scan_qr_from_image(image: np.ndarray) -> Optional[str]:
    """
    Quét QR code từ một numpy array image
    Returns raw QR text hoặc None
    """
    # Try pyzbar
    decoded_objects = pyzbar.decode(image)
    for obj in decoded_objects:
        if obj.type == 'QRCODE' and obj.data:
            try:
                return obj.data.decode('utf-8')
            except:
                pass
    return None


def scan_cccd_qr_deep(
    image_bytes: bytes,
    mode: str = ScanMode.AUTO,
    timeout_ms: int = 8000,
    progress_callback: Optional[Callable] = None
) -> ScanResult:
    """
    Main function: Quét QR CCCD với deep scanning

    Args:
        image_bytes: Binary image data
        mode: "auto", "basic", hoặc "full"
        timeout_ms: Timeout in milliseconds
        progress_callback: Optional callback(message: str)

    Returns:
        ScanResult with success, data, or reason
    """
    start_time = time.time()
    deadline = start_time + (timeout_ms / 1000.0)

    def is_timed_out():
        return time.time() >= deadline

    def report_progress(message: str):
        if progress_callback:
            progress_callback(message)

    try:
        # Load image
        report_progress("Đang chuẩn bị ảnh CCCD...")
        pil_image = Image.open(BytesIO(image_bytes))
        image = cv2.cvtColor(np.array(pil_image), cv2.COLOR_RGB2BGR)
        height, width = image.shape[:2]

        if is_timed_out():
            return ScanResult(False, reason="timeout")

        # Try whole image first
        report_progress("Đang kiểm tra toàn ảnh...")
        qr_text = scan_qr_from_image(image)
        if qr_text:
            data = parse_cccd_qr_text(qr_text)
            if data:
                return ScanResult(True, data=data)

        if is_timed_out():
            return ScanResult(False, reason="timeout")

        # Build priority regions
        regions = build_priority_regions(width, height)
        target_edge = {
            ScanMode.BASIC: BASIC_LONG_EDGE,
            ScanMode.FULL: FULL_LONG_EDGE
        }.get(mode, AUTO_LONG_EDGE)

        # Scan regions with upscaling
        for idx, region in enumerate(regions):
            if is_timed_out():
                return ScanResult(False, reason="timeout")

            report_progress(f"Đang phóng to vùng {idx + 1}/{len(regions)}...")
            rendered = render_scan_region(image, region, target_edge)
            if rendered is not None:
                qr_text = scan_qr_from_image(rendered)
                if qr_text:
                    data = parse_cccd_qr_text(qr_text)
                    if data:
                        return ScanResult(True, data=data)

        # Enhancement pass (except basic mode)
        if mode != ScanMode.BASIC:
            for idx, region in enumerate(regions):
                if is_timed_out():
                    return ScanResult(False, reason="timeout")

                report_progress(f"Đang tăng độ rõ vùng {idx + 1}/{len(regions)}...")
                rendered = render_scan_region(image, region, target_edge)
                if rendered is None:
                    continue

                # Try enhanced
                enhanced = enhance_qr_image(rendered)
                qr_text = scan_qr_from_image(enhanced)
                if qr_text:
                    data = parse_cccd_qr_text(qr_text)
                    if data:
                        return ScanResult(True, data=data)

                # Try threshold
                thresholded = threshold_qr_image(enhanced)
                qr_text = scan_qr_from_image(thresholded)
                if qr_text:
                    data = parse_cccd_qr_text(qr_text)
                    if data:
                        return ScanResult(True, data=data)

        # Rotation pass (full mode only)
        if mode == ScanMode.FULL:
            rotations = [90, 180, 270]
            for idx, region in enumerate(regions):
                rendered = render_scan_region(image, region, FULL_LONG_EDGE)
                if rendered is None:
                    continue

                for rotation in rotations:
                    if is_timed_out():
                        return ScanResult(False, reason="timeout")

                    report_progress(f"Đang xoay thử vùng {idx + 1}/{len(regions)} ({rotation}°)...")
                    rotated = rotate_image(rendered, rotation)
                    qr_text = scan_qr_from_image(rotated)
                    if qr_text:
                        data = parse_cccd_qr_text(qr_text)
                        if data:
                            return ScanResult(True, data=data)

        if is_timed_out():
            return ScanResult(False, reason="timeout")

        return ScanResult(False, reason="not_found")

    except Exception as e:
        return ScanResult(False, reason=f"error: {str(e)}")

