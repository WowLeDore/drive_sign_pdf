"""
PDF signing and stamping service using pypdf and reportlab.
Applies an official administrative electronic signature stamp onto a PDF.
"""

import io
import logging
from datetime import datetime
from django.utils import timezone
from pypdf import PdfReader, PdfWriter
from reportlab.lib import colors
from reportlab.pdfgen import canvas

logger = logging.getLogger(__name__)


def stamp_pdf_with_signature(
    pdf_bytes: bytes,
    page_index: int,
    x_pct: float,
    y_pct: float,
    w_pct: float,
    h_pct: float,
    signer_name: str,
    signed_at: datetime | None = None,
) -> bytes:
    """
    Apply a visual signature stamp onto the PDF at specified coordinates (percentages).
    Coordinates are 0-indexed and origin is top-left in web view.
    """
    if not signed_at:
        signed_at = timezone.now()

    # Format administrative date
    date_str = signed_at.strftime("%d/%m/%Y  -  %H:%M")

    reader = PdfReader(io.BytesIO(pdf_bytes))
    writer = PdfWriter()

    total_pages = len(reader.pages)
    if total_pages == 0:
        return pdf_bytes

    target_idx = min(max(0, page_index), total_pages - 1)

    for idx, page in enumerate(reader.pages):
        if idx == target_idx:
            page_w = float(page.mediabox.width)
            page_h = float(page.mediabox.height)

            box_w = max(50.0, (w_pct / 100.0) * page_w)
            box_h = max(30.0, (h_pct / 100.0) * page_h)
            box_x = (x_pct / 100.0) * page_w
            # PDF coordinates have (0,0) at bottom-left
            box_y = page_h - ((y_pct / 100.0) * page_h) - box_h

            packet = io.BytesIO()
            can = canvas.Canvas(packet, pagesize=(page_w, page_h))

            # Background and border (Marianne blue #000091)
            can.setFillColor(colors.HexColor("#F5F5FE"))
            can.setStrokeColor(colors.HexColor("#000091"))
            can.setLineWidth(1.5)
            can.roundRect(box_x, box_y, box_w, box_h, 3, fill=1, stroke=1)

            # Colors & font sizes
            can.setFillColor(colors.HexColor("#000091"))
            sub_font_size = max(6.0, min(8.5, box_h * 0.18))
            title_font_size = max(8.0, min(12.0, box_h * 0.28))

            # Signer Name (auto-adjust font size to fit width)
            can.setFont("Helvetica-Bold", title_font_size)
            name_text = signer_name or "Signataire"
            while title_font_size > 6.0 and can.stringWidth(name_text, "Helvetica-Bold", title_font_size) > (box_w - 12):
                title_font_size -= 0.5
                can.setFont("Helvetica-Bold", title_font_size)

            can.drawString(box_x + 6, box_y + box_h - (box_h * 0.58), name_text)

            # Date and verification info
            can.setFont("Helvetica", sub_font_size)
            can.drawString(box_x + 6, box_y + 6, f"{date_str}")

            can.save()
            packet.seek(0)

            writer.add_page(page)
            stamp_page = PdfReader(packet).pages[0]
            writer.pages[-1].merge_page(stamp_page)
        else:
            writer.add_page(page)

    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()
