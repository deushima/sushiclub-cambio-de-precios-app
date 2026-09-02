import base64
import csv
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.parse import urljoin
from urllib.request import pathname2url

from lxml import etree
from PIL import Image, ImageDraw, ImageFont


SVG_NS = "http://www.w3.org/2000/svg"
PRICE_SYMBOL_SCALE = 0.66
PRICE_SYMBOL_GAP_EM = 0.12


def clean_text(value):
    return re.sub(r"\s+", " ", value or "").strip()


def token_text(value):
    return re.sub(r"[\s\u00a0]+", "", clean_text(value))


def local_name(node):
    return etree.QName(node).localname if isinstance(node.tag, str) else ""


def number_attr(node, name):
    value = node.get(name)
    if value is None:
        return None
    try:
        return float(str(value).removesuffix("px"))
    except ValueError:
        return None


def node_number_attr(node, name):
    current = node
    while current is not None:
        value = number_attr(current, name)
        if value is not None:
            return value
        current = current.getparent()
    return None


def text_element_for(node):
    current = node
    while current is not None:
        if local_name(current) == "text":
            return current
        current = current.getparent()
    return node


def selectable_placeholders(root, matcher):
    candidates = [
        node
        for node in root.iter()
        if local_name(node) in ("text", "tspan") and matcher("".join(node.itertext()))
    ]
    candidate_ids = {id(node) for node in candidates}
    selectable = []
    for node in candidates:
        descendants = [child for child in node.iterdescendants() if local_name(child) in ("text", "tspan")]
        if not any(id(child) in candidate_ids for child in descendants):
            selectable.append(node)
    return selectable


def rect_info(rect):
    x = number_attr(rect, "x")
    y = number_attr(rect, "y")
    width = number_attr(rect, "width")
    height = number_attr(rect, "height")
    rx = number_attr(rect, "rx") or 0
    if x is None or y is None or width is None or height is None:
        return None
    if width < 80 or height < 24 or rx < 8:
        return None
    return {
        "element": rect,
        "x": x,
        "y": y,
        "width": width,
        "height": height,
        "center_x": x + width / 2,
        "center_y": y + height / 2,
    }


def find_nearest_pill(root, node):
    x = node_number_attr(node, "x")
    y = node_number_attr(node, "y")
    if x is None or y is None:
        return None

    candidates = []
    for rect in root.iter():
        if local_name(rect) != "rect":
            continue
        info = rect_info(rect)
        if not info:
            continue
        inside_y = y >= info["y"] - info["height"] * 0.35 and y <= info["y"] + info["height"] * 1.35
        inside_x = x >= info["x"] - info["width"] * 0.2 and x <= info["x"] + info["width"] * 1.2
        vertical_penalty = 0 if inside_y else abs(y - info["center_y"])
        horizontal_penalty = 0 if inside_x else abs(x - info["center_x"])
        info["score"] = vertical_penalty * 3 + horizontal_penalty + abs(info["center_y"] - y) * 0.2
        candidates.append(info)

    return sorted(candidates, key=lambda item: item["score"])[0] if candidates else None


def estimate_text_width(text, font_size):
    width = 0
    for char in text:
        if char == "$":
            width += font_size * 0.62 * PRICE_SYMBOL_SCALE + font_size * PRICE_SYMBOL_GAP_EM
        elif char == ".":
            width += font_size * 0.3
        elif char == ",":
            width += font_size * 0.28
        elif char.isdigit():
            width += font_size * 0.74
        else:
            width += font_size * 0.7
    return width


def clear_children(node):
    for child in list(node):
        node.remove(child)


def price_tspan(node):
    namespace = etree.QName(node).namespace or SVG_NS
    return etree.SubElement(node, f"{{{namespace}}}tspan")


def set_price_text(node, price_text, font_size):
    clear_children(node)
    node.text = None

    if not price_text.startswith("$"):
        node.text = price_text
        return

    symbol = price_tspan(node)
    symbol.text = "$"
    symbol.set("data-sushiclub-price-symbol", "true")
    symbol.set("font-size", f"{font_size * PRICE_SYMBOL_SCALE:.3f}".rstrip("0").rstrip("."))
    symbol.set("dominant-baseline", "middle")
    symbol.set("alignment-baseline", "middle")

    value = price_tspan(node)
    value.text = price_text[1:]
    value.set("dx", f"{font_size * PRICE_SYMBOL_GAP_EM:.3f}".rstrip("0").rstrip("."))


def set_price_font_size(node, text, font_size):
    next_size_value = f"{font_size:.3f}".rstrip("0").rstrip(".")
    if text is not None:
        text.set("font-size", next_size_value)
    node.set("font-size", next_size_value)

    symbol_size = f"{font_size * PRICE_SYMBOL_SCALE:.3f}".rstrip("0").rstrip(".")
    for child in node.iterdescendants():
        if local_name(child) == "tspan" and child.get("data-sushiclub-price-symbol") == "true":
            child.set("font-size", symbol_size)


def apply_price_typography(node):
    text = text_element_for(node)
    for target in (text, node):
        if target is None:
            continue
        target.set("font-family", "Acumin Pro")
        target.set("font-weight", "600")
        target.set("font-style", "normal")
        target.set("letter-spacing", "0")
        target.set("dominant-baseline", "middle")
        target.set("alignment-baseline", "middle")
    if text is not None:
        text.set("data-sushiclub-price", "true")


def remove_price_filter_crop(node):
    current = node.getparent()
    while current is not None:
        if current.get("filter"):
            current.attrib.pop("filter", None)
            return
        current = current.getparent()


def ensure_font_face(root, font_data_url):
    defs = next((node for node in root if local_name(node) == "defs"), None)
    if defs is None:
        defs = etree.Element(f"{{{SVG_NS}}}defs")
        root.insert(0, defs)

    style = None
    for node in defs.iter():
        if local_name(node) == "style" and node.get("id") == "sushiclub-price-font-face":
            style = node
            break
    if style is None:
        style = etree.Element(f"{{{SVG_NS}}}style", id="sushiclub-price-font-face")
        defs.insert(0, style)

    style.text = f"""
@font-face {{
  font-family: "Acumin Pro";
  src: url("{font_data_url}") format("opentype");
  font-weight: 600;
  font-style: normal;
}}
text[data-sushiclub-price="true"] {{
  font-family: "Acumin Pro";
  font-weight: 600;
  font-style: normal;
}}""".strip()


def is_external_ref(value):
    return (
        not value
        or value.startswith("#")
        or value.startswith("data:")
        or value.startswith("file:")
        or re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*:", value)
    )


def absolutize_linked_assets(root, base_dir):
    href_names = ("href", "{http://www.w3.org/1999/xlink}href")
    for node in root.iter():
        for attr in href_names:
            value = node.get(attr)
            if is_external_ref(value):
                continue
            absolute = (base_dir / value).resolve()
            node.set(attr, file_url(absolute))


def center_and_fit_price(node, price_text, pill):
    original_marker = token_text("".join(node.itertext()))
    base_size = node_number_attr(node, "font-size") or 42
    set_price_text(node, price_text, base_size)
    apply_price_typography(node)
    remove_price_filter_crop(node)

    text = text_element_for(node)
    if pill:
        if text is not None:
            text.set("text-anchor", "middle")
            text.set("dominant-baseline", "middle")
            text.set("alignment-baseline", "middle")
        max_width = max(1, pill["width"] - max(54, pill["width"] * 0.28))
        node.set("x", f"{pill['center_x']:.3f}".rstrip("0").rstrip("."))
        node.set("y", f"{pill['center_y']:.3f}".rstrip("0").rstrip("."))
    else:
        placeholder_width = estimate_text_width(original_marker, base_size)
        marker_factor = 1.55 if original_marker.startswith("$") else 2.1
        max_width = max(1, placeholder_width * marker_factor)
    node.attrib.pop("textLength", None)
    node.attrib.pop("lengthAdjust", None)

    font_size = node_number_attr(node, "font-size") or 42
    estimated = estimate_text_width(price_text, font_size)
    if estimated <= max_width:
        return

    scale = max(0.62, min(1, max_width / estimated))
    next_size = font_size * scale
    set_price_font_size(node, text, next_size)

    if estimate_text_width(price_text, next_size) > max_width:
        node.set("textLength", f"{max_width:.3f}".rstrip("0").rstrip("."))
        node.set("lengthAdjust", "spacingAndGlyphs")


def parse_dimension(value):
    if not value:
        return None
    try:
        number = float(str(value).removesuffix("px"))
        return round(number) if number > 0 else None
    except ValueError:
        return None


def svg_size(root):
    width = parse_dimension(root.get("width"))
    height = parse_dimension(root.get("height"))
    if width and height:
        return width, height
    view_box = root.get("viewBox") or ""
    parts = [float(part) for part in re.split(r"[\s,]+", view_box.strip()) if part]
    if len(parts) == 4:
        return round(parts[2]), round(parts[3])
    raise ValueError("No pude detectar tamano SVG")


def replace_svg_prices(svg_path, normal_text, eminent_text, font_data_url):
    parser = etree.XMLParser(recover=True, remove_blank_text=False, huge_tree=True)
    tree = etree.parse(str(svg_path), parser)
    root = tree.getroot()
    ensure_font_face(root, font_data_url)
    absolutize_linked_assets(root, svg_path.parent)
    normal_nodes = selectable_placeholders(root, lambda value: re.match(r"^\${2,}$", token_text(value)))
    eminent_nodes = selectable_placeholders(root, lambda value: re.match(r"^@{2,}$", token_text(value)))
    warnings = []
    if not normal_nodes:
        warnings.append("No se encontro placeholder $$$$")
    if not eminent_nodes:
        warnings.append("No se encontro placeholder @@@@")
    for node in normal_nodes:
        center_and_fit_price(node, normal_text, find_nearest_pill(root, node))
    for node in eminent_nodes:
        center_and_fit_price(node, eminent_text, find_nearest_pill(root, node))
    return etree.tostring(root, encoding="utf-8", xml_declaration=False), svg_size(root), warnings


def file_url(path):
    return urljoin("file:", pathname2url(str(path.resolve())))


def render_png(chrome_path, svg_path, png_path, size):
    width, height = size
    png_path.parent.mkdir(parents=True, exist_ok=True)
    command = [
        chrome_path,
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--force-device-scale-factor=1",
        f"--window-size={width},{height}",
        f"--screenshot={png_path}",
        file_url(svg_path),
    ]
    result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=45)
    if result.returncode != 0:
        command[1] = "--headless"
        result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=45)
    if result.returncode != 0 or not png_path.exists():
        raise RuntimeError(result.stderr or result.stdout or "Chrome no genero PNG")


def make_contact_sheet(action_name, png_paths, output_path):
    thumbs = []
    for path in png_paths[:24]:
        try:
            image = Image.open(path).convert("RGB")
        except Exception:
            continue
        image.thumbnail((220, 220))
        thumbs.append((path, image.copy()))
    if not thumbs:
        return

    cols = 4
    rows = math.ceil(len(thumbs) / cols)
    cell_w, cell_h = 260, 270
    sheet = Image.new("RGB", (cols * cell_w, rows * cell_h + 42), "#1c1c1d")
    draw = ImageDraw.Draw(sheet)
    draw.text((12, 12), action_name, fill="#ffffff")
    for index, (path, image) in enumerate(thumbs):
        x = (index % cols) * cell_w + 12
        y = (index // cols) * cell_h + 42
        sheet.paste(image, (x, y))
        draw.text((x, y + image.height + 6), path.parent.name[:34], fill="#d0d3d7")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(output_path)


def main():
    plan_path = Path(sys.argv[1])
    plan = json.loads(plan_path.read_text(encoding="utf-8"))
    chrome_path = plan["chromePath"]
    output_root = Path(plan["outputRoot"])
    font_path = Path(plan["fontPath"])
    font_data_url = "data:font/otf;base64," + base64.b64encode(font_path.read_bytes()).decode("ascii")
    temp_dir = Path(tempfile.mkdtemp(prefix="sushiclub-render-"))
    rows = []

    try:
        for action in plan["actions"]:
            generated_for_preview = []
            for job in action["jobs"]:
                if "copySourcePath" in job:
                    source = Path(job["copySourcePath"])
                    output = output_root / job["outputPath"]
                    output.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(source, output)
                    generated_for_preview.append(output)
                    rows.append({
                        "accion": action["name"],
                        "archivo": str(output.relative_to(output_root)),
                        "locales": " / ".join(job["branches"]),
                        "plantilla": job["templateName"],
                        "precio_normal": job["normalText"],
                        "precio_eminent": job["eminentText"],
                        "avisos": "COPIADO PNG BASE",
                    })
                    continue
                source = Path(job["sourcePath"])
                output = output_root / job["outputPath"]
                if output.exists() and output.stat().st_size > 0:
                    generated_for_preview.append(output)
                    rows.append({
                        "accion": action["name"],
                        "archivo": str(output.relative_to(output_root)),
                        "locales": " / ".join(job["branches"]),
                        "plantilla": job["templateName"],
                        "precio_normal": job["normalText"],
                        "precio_eminent": job["eminentText"],
                        "avisos": "OK",
                    })
                    continue
                temp_svg = temp_dir / f"{len(rows):06d}.svg"
                svg_text, size, warnings = replace_svg_prices(source, job["normalText"], job["eminentText"], font_data_url)
                temp_svg.write_bytes(svg_text)
                render_png(chrome_path, temp_svg, output, size)
                generated_for_preview.append(output)
                rows.append({
                    "accion": action["name"],
                    "archivo": str(output.relative_to(output_root)),
                    "locales": " / ".join(job["branches"]),
                    "plantilla": job["templateName"],
                    "precio_normal": job["normalText"],
                    "precio_eminent": job["eminentText"],
                    "avisos": " | ".join(warnings) if warnings else "OK",
                })
            make_contact_sheet(action["name"], generated_for_preview, output_root / "_PREVIEWS" / f"{action['safeName']}.jpg")
            print(f"{action['name']}: {len(generated_for_preview)} PNG")
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)

    report_path = output_root / "_reporte_exportacion.csv"
    with report_path.open("w", encoding="utf-8-sig", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=["accion", "archivo", "locales", "plantilla", "precio_normal", "precio_eminent", "avisos"])
        writer.writeheader()
        writer.writerows(rows)
    print(f"TOTAL: {len(rows)} PNG")
    print(output_root)


if __name__ == "__main__":
    main()
