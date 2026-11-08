#!/usr/bin/env python3
"""Read-only, fail-closed preflight for a deliberately small static SVG subset.

No renderer, sanitizer, source authentication, coordinate mapping, or Quran review.
Unknown features are rejected; original bytes are never rewritten.
"""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import stat
import sys
from xml.parsers import expat

MAX_BYTES = 8 * 1024 * 1024
MAX_NODES, MAX_DEPTH, MAX_ATTRIBUTES = 50000, 64, 64
MAX_PATH_LENGTH, MAX_PATH_TOKENS, MAX_EXPANDED_NODES = 1000000, 200000, 200000
MAX_CSS_RULES, MAX_CSS_DECLARATIONS = 1000, 10000
MAX_STYLESHEET_LENGTH, MAX_EXPANDED_GEOMETRY = 128 * 1024, 2000000
SVG, XLINK = "http://www.w3.org/2000/svg", "http://www.w3.org/1999/xlink"
NUMBER = r"[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?"
IDENT = r"[A-Za-z_][A-Za-z0-9_.:-]*"
GEOMETRY = {"path", "rect", "circle", "ellipse", "line", "polyline", "polygon"}
PAINT = {"fill", "stroke", "stop-color"}
SCALARS = {"stroke-width", "stroke-miterlimit", "stroke-dashoffset", "opacity", "fill-opacity", "stroke-opacity", "stop-opacity"}
ENUMS = {"fill-rule": {"nonzero", "evenodd"}, "clip-rule": {"nonzero", "evenodd"},
         "stroke-linecap": {"butt", "round", "square"}, "stroke-linejoin": {"miter", "round", "bevel"},
         "display": {"inline", "none"}, "visibility": {"visible", "hidden", "collapse"},
         "vector-effect": {"none", "non-scaling-stroke"}, "shape-rendering": {"auto", "optimizeSpeed", "crispEdges", "geometricPrecision"}}
PRESENTATION = PAINT | SCALARS | set(ENUMS) | {"stroke-dasharray", "clip-path"}
COMMON = PRESENTATION | {"id", "class", "style", "transform"}
EXTRA = {"svg": {"viewBox", "width", "height", "version", "preserveAspectRatio"}, "g": set(), "defs": set(),
         "path": {"d", "pathLength"}, "rect": {"x", "y", "width", "height", "rx", "ry", "pathLength"},
         "circle": {"cx", "cy", "r", "pathLength"}, "ellipse": {"cx", "cy", "rx", "ry", "pathLength"},
         "line": {"x1", "y1", "x2", "y2", "pathLength"}, "polyline": {"points", "pathLength"}, "polygon": {"points", "pathLength"},
         "use": {"href", "x", "y", "width", "height"}, "clipPath": {"clipPathUnits"},
         "linearGradient": {"x1", "y1", "x2", "y2", "gradientUnits", "gradientTransform", "spreadMethod", "href"},
         "radialGradient": {"cx", "cy", "r", "fx", "fy", "fr", "gradientUnits", "gradientTransform", "spreadMethod", "href"},
         "stop": {"offset"}, "style": {"type"}, "title": set(), "desc": set()}


class Rejected(ValueError):
    pass


def reject(code):
    raise Rejected(code)


def numbers(value):
    if not re.fullmatch(NUMBER + r"(?:[\s,]+" + NUMBER + r")*", value.strip(), re.ASCII):
        reject("SVG_INVALID_NUMERIC_LIST")
    result = [float(n) for n in re.findall(NUMBER, value, re.ASCII)]
    if any(not math.isfinite(n) or abs(n) > 1e9 for n in result):
        reject("SVG_NONFINITE_OR_EXCESSIVE_COORDINATE")
    return result


def dimension(value):
    match = re.fullmatch("(" + NUMBER + r")(px|pt|pc|mm|cm|in|%)?", value.strip(), re.ASCII)
    if not match:
        reject("SVG_UNSUPPORTED_DIMENSION")
    number = numbers(match[1])[0]
    if number <= 0:
        reject("SVG_NONPOSITIVE_DIMENSION")
    return {"value": number, "unit": match[2] or "user-unit"}


def transform(value):
    consumed, count = 0, 0
    pattern = re.compile(r"[\s,]*([A-Za-z]+)\(([^()]*)\)", re.ASCII)
    while consumed < len(value):
        match = pattern.match(value, consumed)
        if not match: reject("SVG_UNSUPPORTED_TRANSFORM")
        sizes = {"matrix": {6}, "translate": {1, 2}, "scale": {1, 2}, "rotate": {1, 3}, "skewX": {1}, "skewY": {1}}
        if match[1] not in sizes or len(numbers(match[2])) not in sizes[match[1]]:
            reject("SVG_UNSUPPORTED_TRANSFORM")
        consumed = match.end(); count += 1
        while consumed < len(value) and value[consumed] in " \t\r\n": consumed += 1
    if not count:
        reject("SVG_UNSUPPORTED_TRANSFORM")


def path(value):
    if len(value) > MAX_PATH_LENGTH:
        reject("SVG_PATH_LENGTH_LIMIT")
    token = re.compile(r"[MmZzLlHhVvCcSsQqTtAa]|" + NUMBER, re.ASCII)
    tokens, position = [], 0
    for match in token.finditer(value):
        if value[position:match.start()].strip(" \t\r\n,"):
            reject("SVG_UNSUPPORTED_PATH_TOKEN")
        tokens.append(match[0]); position = match.end()
        if len(tokens) > MAX_PATH_TOKENS:
            reject("SVG_PATH_TOKEN_LIMIT")
    if value[position:].strip() or not tokens or tokens[0] not in "Mm":
        reject("SVG_INVALID_PATH")
    index = 0
    while index < len(tokens):
        command = tokens[index]; index += 1
        if command not in "MmZzLlHhVvCcSsQqTtAa":
            reject("SVG_INVALID_PATH_COMMAND")
        values = []
        while index < len(tokens) and tokens[index] not in "MmZzLlHhVvCcSsQqTtAa":
            values.append(numbers(tokens[index])[0]); index += 1
        size = {"M": 2, "Z": 0, "L": 2, "H": 1, "V": 1, "C": 6, "S": 4, "Q": 4, "T": 2, "A": 7}[command.upper()]
        if (size == 0 and values) or (size and (not values or len(values) % size)):
            reject("SVG_INVALID_PATH_ARITY")
        if command.upper() == "A" and any(values[i] < 0 or values[i+1] < 0 or values[i+3] not in (0, 1) or values[i+4] not in (0, 1) for i in range(0, len(values), 7)):
            reject("SVG_INVALID_ARC")
    return len(tokens)


def inspect_svg(data):
    if not isinstance(data, bytes) or not data or len(data) > MAX_BYTES:
        reject("SVG_BYTE_LIMIT_OR_INVALID_INPUT")
    if b"\x00" in data: reject("SVG_UTF8_REQUIRED")  # Prevent Expat's BOM-less UTF-16/32 autodetection.
    try:
        data.decode("utf-8", errors="strict")
    except UnicodeDecodeError:
        reject("SVG_UTF8_REQUIRED")
    nodes, stack, ids, references, counts = [], [], {}, [], {}
    root, css_rules, css_declarations, namespaces = {}, 0, 0, 0

    def reference(value, owner, targets):
        if nodes[owner]["tag"] == "style":
            reject("SVG_STYLESHEET_RESOURCE_REFERENCE_UNSUPPORTED")
        if not re.fullmatch("#" + IDENT, value, re.ASCII):
            reject("SVG_EXTERNAL_OR_UNSUPPORTED_REFERENCE")
        references.append((owner, value[1:], targets))

    def presentation(key, value, owner):
        if key in ENUMS:
            if value not in ENUMS[key]: reject("SVG_UNSUPPORTED_PRESENTATION_VALUE")
        elif key in PAINT or key == "clip-path":
            match = re.fullmatch(r"url\((#[A-Za-z_][A-Za-z0-9_.:-]*)\)", value, re.ASCII)
            if match:
                reference(match[1], owner, {"clipPath"} if key == "clip-path" else {"linearGradient", "radialGradient"})
            elif not (value == "none" or key in PAINT and re.fullmatch(r"(?:#[0-9A-Fa-f]{3}(?:[0-9A-Fa-f]{3})?|[A-Za-z]+)", value, re.ASCII)):
                reject("SVG_UNSUPPORTED_PAINT")
        elif key == "stroke-dasharray" and value == "none": pass
        else:
            values = numbers(value)
            if key != "stroke-dasharray" and len(values) != 1: reject("SVG_INVALID_SCALAR")
            if key != "stroke-dashoffset" and any(n < 0 for n in values): reject("SVG_NEGATIVE_PRESENTATION")
            if "opacity" in key and any(n > 1 for n in values): reject("SVG_INVALID_OPACITY")

    def declarations(value, owner):
        nonlocal css_declarations
        if any(c in value for c in "\\/@!<>'\"") or not value.isascii(): reject("SVG_UNSUPPORTED_CSS")
        for declaration in value.split(";"):
            if not declaration.strip(): continue
            css_declarations += 1
            if css_declarations > MAX_CSS_DECLARATIONS: reject("SVG_CSS_DECLARATION_LIMIT")
            pair = declaration.split(":", 1)
            if len(pair) != 2 or pair[0].strip() not in PRESENTATION: reject("SVG_UNSUPPORTED_CSS_PROPERTY")
            presentation(pair[0].strip(), pair[1].strip(), owner)

    def start(name, attrs):
        if not name.startswith(SVG + "}") or name[len(SVG)+1:] not in EXTRA: reject("SVG_UNSUPPORTED_ELEMENT_OR_NAMESPACE")
        tag = name[len(SVG)+1:]
        if len(nodes) >= MAX_NODES or len(stack) >= MAX_DEPTH or len(attrs) > MAX_ATTRIBUTES: reject("SVG_STRUCTURE_LIMIT")
        if (not stack and tag != "svg") or (stack and (tag == "svg" or nodes[stack[-1]]["tag"] in {"style", "title", "desc"})): reject("SVG_UNSUPPORTED_STRUCTURE")
        owner = len(nodes); nodes.append({"tag": tag, "children": [], "text": [], "textLength": 0, "geometryCost": 0}); counts[tag] = counts.get(tag, 0) + 1
        if stack: nodes[stack[-1]]["children"].append(owner)
        stack.append(owner); seen = set()
        for name, value in attrs.items():
            key = "href" if name == XLINK + "}href" else name
            if "}" in key or key in seen or key not in COMMON | EXTRA[tag]: reject("SVG_UNSUPPORTED_ATTRIBUTE_OR_NAMESPACE")
            seen.add(key)
            if len(value) > (MAX_PATH_LENGTH if key == "d" else 16384): reject("SVG_ATTRIBUTE_LENGTH_LIMIT")
            if key == "id":
                if not re.fullmatch(IDENT, value, re.ASCII) or value in ids: reject("SVG_INVALID_OR_DUPLICATE_ID")
                ids[value] = owner
            elif key == "class":
                if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_-]*(?:\s+[A-Za-z_][A-Za-z0-9_-]*)*", value, re.ASCII): reject("SVG_UNSUPPORTED_CLASS")
            elif key == "style": declarations(value, owner)
            elif key in PRESENTATION: presentation(key, value, owner)
            elif key in {"transform", "gradientTransform"}: transform(value)
            elif key == "d": nodes[owner]["geometryCost"] += path(value)
            elif key == "href": reference(value, owner, GEOMETRY if tag == "use" else {"linearGradient", "radialGradient"})
            elif key == "viewBox":
                box = numbers(value)
                if len(box) != 4 or box[2] <= 0 or box[3] <= 0: reject("SVG_INVALID_VIEWBOX")
                root["viewBox"] = box
            elif key in {"width", "height"} and tag == "svg": root[key] = dimension(value)
            elif key in {"clipPathUnits", "gradientUnits"}:
                if value not in {"userSpaceOnUse", "objectBoundingBox"}: reject("SVG_UNSUPPORTED_UNITS")
            elif key == "spreadMethod":
                if value not in {"pad", "reflect", "repeat"}: reject("SVG_UNSUPPORTED_SPREAD")
            elif key == "preserveAspectRatio":
                if not re.fullmatch(r"(?:none|x(?:Min|Mid|Max)Y(?:Min|Mid|Max)(?: (?:meet|slice))?)", value): reject("SVG_UNSUPPORTED_ASPECT_RATIO")
            elif key == "version":
                if value not in {"1.0", "1.1", "2.0"}: reject("SVG_UNSUPPORTED_VERSION")
            elif key == "type":
                if value != "text/css": reject("SVG_UNSUPPORTED_STYLE_TYPE")
            else:
                values = numbers(value[:-1] if value.endswith("%") and (tag.endswith("Gradient") or key == "offset") else value)
                if key == "points": nodes[owner]["geometryCost"] += len(values)
                if key == "points" and (len(values) < 4 or len(values) % 2) or key != "points" and len(values) != 1: reject("SVG_INVALID_GEOMETRY")
                if key in {"width", "height", "r", "rx", "ry", "fr", "pathLength", "offset"} and any(n < 0 for n in values): reject("SVG_NEGATIVE_GEOMETRY")

    def end(_name):
        nonlocal css_rules
        owner = stack.pop(); node = nodes[owner]; value = "".join(node["text"])
        if node["tag"] == "style":
            cursor = 0; pattern = re.compile(r"([^{}]+)\{([^{}]*)\}")
            while cursor < len(value):
                while cursor < len(value) and value[cursor] in " \t\r\n": cursor += 1
                if cursor == len(value): break
                match = pattern.match(value, cursor)
                if not match: reject("SVG_UNSUPPORTED_CSS")
                selectors = match[1].strip()
                if not re.fullmatch(r"[.#]?[A-Za-z_][A-Za-z0-9_-]*(?:\s*,\s*[.#]?[A-Za-z_][A-Za-z0-9_-]*)*", selectors, re.ASCII): reject("SVG_UNSUPPORTED_CSS_SELECTOR")
                css_rules += 1
                if css_rules > MAX_CSS_RULES: reject("SVG_CSS_RULE_LIMIT")
                declarations(match[2], owner); cursor = match.end()
        elif node["tag"] not in {"title", "desc"} and value.strip(): reject("SVG_UNSUPPORTED_TEXT")

    def content(text):
        if not stack: return
        node = nodes[stack[-1]]; node["textLength"] += len(text)
        if node["tag"] == "style" and node["textLength"] > MAX_STYLESHEET_LENGTH: reject("SVG_STYLESHEET_LENGTH_LIMIT")
        node["text"].append(text)

    parser = expat.ParserCreate(encoding="utf-8", namespace_separator="}")
    parser.StartElementHandler, parser.EndElementHandler = start, end
    parser.CharacterDataHandler = content
    def namespace(_prefix, uri):
        nonlocal namespaces
        namespaces += 1
        if namespaces > MAX_ATTRIBUTES or uri not in {SVG, XLINK}: reject("SVG_UNSUPPORTED_NAMESPACE_OR_LIMIT")
    parser.StartNamespaceDeclHandler = namespace
    parser.XmlDeclHandler = lambda version, encoding, _standalone: None if version == "1.0" and (encoding is None or encoding.lower() in {"utf-8", "utf8"}) else reject("SVG_XML_DECLARATION_UNSUPPORTED")
    for handler in ("StartDoctypeDeclHandler", "EntityDeclHandler", "ExternalEntityRefHandler", "ProcessingInstructionHandler"):
        setattr(parser, handler, lambda *_args: reject("SVG_DTD_ENTITY_OR_PI_FORBIDDEN"))
    parser.SetParamEntityParsing(expat.XML_PARAM_ENTITY_PARSING_NEVER)
    try: parser.Parse(data, True)
    except expat.ExpatError as error: raise Rejected("SVG_MALFORMED_XML") from error
    if "viewBox" not in root: reject("SVG_VIEWBOX_REQUIRED")
    edges = [node["children"][:] for node in nodes]
    for owner, name, targets in references:
        if name not in ids or nodes[ids[name]]["tag"] not in targets: reject("SVG_MISSING_OR_UNSUPPORTED_REFERENCE_TARGET")
        edges[owner].append(ids[name])
    visiting, costs, geometry_costs = set(), {}, {}
    for origin in range(len(nodes)):
        work = [(origin, False)]
        while work:
            index, done = work.pop()
            if index in costs: continue
            if done:
                visiting.remove(index); costs[index] = 1 + sum(costs[child] for child in edges[index])
                if costs[index] > MAX_EXPANDED_NODES: reject("SVG_REFERENCE_EXPANSION_LIMIT")
                geometry_costs[index] = 1 + nodes[index]["geometryCost"] + sum(geometry_costs[child] for child in edges[index])
                if geometry_costs[index] > MAX_EXPANDED_GEOMETRY: reject("SVG_EXPANDED_GEOMETRY_LIMIT")
            else:
                if index in visiting: reject("SVG_REFERENCE_CYCLE")
                visiting.add(index); work.append((index, True)); work.extend((child, False) for child in reversed(edges[index]))
    return {"policy": "static-vector-subset-10d-v1", "securityPreflight": "passed", "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(),
            "viewBox": root["viewBox"], "dimensions": {key: root.get(key) for key in ("width", "height")},
            "geometryValidation": "finite-input-values-and-path-arities-only",
            "counts": {"nodes": len(nodes), "elements": counts, "localReferences": len(references), "cssRules": css_rules, "cssDeclarations": css_declarations, "expandedNodes": costs[0], "expandedGeometryCost": geometry_costs[0]},
            "flags": {"originalRewritten": False, "rendered": False, "scientificApproval": False, "rightsApproval": False, "sourceAuthenticityVerified": False, "coordinateMappingVerified": False, "productionActivation": False}}


def inspect_file(pathname):
    descriptor = os.open(Path(pathname), os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, "rb") as stream:
        metadata = os.fstat(stream.fileno())
        if not stat.S_ISREG(metadata.st_mode): reject("SVG_REGULAR_FILE_REQUIRED")
        if metadata.st_size > MAX_BYTES: reject("SVG_BYTE_LIMIT_OR_INVALID_INPUT")
        return inspect_svg(stream.read(MAX_BYTES + 1))


if __name__ == "__main__":
    cli = argparse.ArgumentParser(description=__doc__); cli.add_argument("svg"); args = cli.parse_args()
    try: print(json.dumps(inspect_file(args.svg), ensure_ascii=False, indent=2))
    except (Rejected, OSError) as error:
        print(json.dumps({"securityPreflight": "rejected", "reason": str(error) if isinstance(error, Rejected) else "SVG_FILE_UNREADABLE", "scientificApproval": False, "productionActivation": False})); sys.exit(2)
