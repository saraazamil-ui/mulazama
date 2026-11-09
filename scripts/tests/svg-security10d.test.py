#!/usr/bin/env python3
"""Synthetic vectors only: security preflight is never Quran content approval."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "svg-security10d.py"
spec = importlib.util.spec_from_file_location("svg_security10d", SCRIPT)
inspector = importlib.util.module_from_spec(spec)
with patch.object(sys, "dont_write_bytecode", True):
    spec.loader.exec_module(inspector)


def svg(body='', attrs=''):
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="-12 -3 100 200" ' + attrs + '>' + body + '</svg>').encode()


def hafs_svg(body='', attrs='xml:space="preserve"'):
    return svg(body, 'xmlns:ayah="https://quranpedia.net" ' + attrs)


class SvgSecurityTests(unittest.TestCase):
    def reject(self, value, code=None):
        with self.assertRaisesRegex(inspector.Rejected, code or "SVG_"):
            inspector.inspect_svg(value)

    def test_paths_preserve_negative_viewbox_and_declared_units_without_approval(self):
        data = svg('<path d="M-2 0 L2 3 H4 V5 Q1 2 3 4 T5 6 C1 2 3 4 5 6 S7 8 9 0 A2 3 10 0 1 -4 5 Z"/>', 'width="100mm" height="200px"')
        receipt = inspector.inspect_svg(data)
        self.assertEqual(receipt['viewBox'], [-12, -3, 100, 200])
        self.assertEqual(receipt['dimensions'], {'width': {'value': 100, 'unit': 'mm'}, 'height': {'value': 200, 'unit': 'px'}})
        self.assertEqual(receipt['sha256'], hashlib.sha256(data).hexdigest())
        self.assertEqual(receipt['counts']['elements'], {'svg': 1, 'path': 1})
        self.assertTrue(all(value is False for value in receipt['flags'].values()))
        self.assertEqual(inspector.inspect_svg(svg())['dimensions'], {'width': None, 'height': None})

    def test_defs_local_use_clip_gradient_and_static_styles_are_supported(self):
        data = svg('''<defs><path id="glyph" d="M0 0 1 1z"/>
            <clipPath id="clip"><rect width="10" height="10"/></clipPath>
            <linearGradient id="paint"><stop offset="0%" stop-color="#000"/><stop offset="100%" stop-color="white"/></linearGradient></defs>
            <style type="text/css">.ink, path {fill:#333;stroke:none;opacity:0.8}</style>
            <g transform="translate(-2,3) scale(1) rotate(4,0,0) matrix(1 0 0 1 2 3) skewX(2)" clip-path="url(#clip)">
            <use href="#glyph" class="ink" style="fill:url(#paint);stroke-width:1"/></g>''')
        receipt = inspector.inspect_svg(data)
        self.assertEqual(receipt['counts']['localReferences'], 3)
        self.assertEqual(receipt['counts']['cssRules'], 1)

    def test_xlink_local_href_and_xml_declaration_are_supported(self):
        data = b'<?xml version="1.0" encoding="UTF-8"?>' + svg('<defs><path id="p" d="m.1 -.2 l1e2 2e-1"/></defs><use xlink:href="#p"/>', 'xmlns:xlink="http://www.w3.org/1999/xlink"')
        self.assertEqual(inspector.inspect_svg(data)['counts']['localReferences'], 1)

    def test_all_allowed_geometry_remains_finite(self):
        receipt = inspector.inspect_svg(svg('<rect x="-1" y="-2" width="2" height="3" rx="0"/><circle cx="1" cy="2" r="3"/><ellipse rx="2" ry="3"/><line x1="0" y1="0" x2="3" y2="4"/><polyline points="0,0 1,1"/><polygon points="0,0 1,1 2,0"/>'))
        self.assertEqual(receipt['counts']['nodes'], 7)

    def test_doctype_and_internal_external_parameter_entities_are_rejected(self):
        for prefix in ('<!DOCTYPE svg>', '<!DOCTYPE svg [<!ENTITY x "expanded">]>',
                       '<!DOCTYPE svg SYSTEM "https://example.invalid/evil.dtd">',
                       '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]>',
                       '<!DOCTYPE svg [<!ENTITY % x SYSTEM "https://example.invalid/e">%x;]>'):
            with self.subTest(prefix=prefix): self.reject(prefix.encode()+svg(), 'SVG_DTD_ENTITY_OR_PI_FORBIDDEN')

    def test_processing_instructions_are_rejected_inside_or_outside_root(self):
        for data in (b'<?xml-stylesheet href="https://example.invalid/a"?>'+svg(), svg('<?go external?>'), svg()+b'<?go external?>'):
            self.reject(data, 'SVG_DTD_ENTITY_OR_PI_FORBIDDEN')

    def test_script_foreign_object_smil_images_fonts_and_nested_svg_are_rejected(self):
        for tag in ('script', 'foreignObject', 'animate', 'animateTransform', 'set', 'image', 'text', 'font', 'filter', 'mask', 'a', 'iframe', 'svg'):
            with self.subTest(tag=tag): self.reject(svg('<'+tag+'/>'))

    def test_event_handlers_are_rejected_on_all_allowed_elements(self):
        for attribute in ('onclick', 'onload', 'onbegin', 'OnLoad'):
            with self.subTest(attribute=attribute): self.reject(svg('<path d="M0 0" '+attribute+'="alert(1)"/>'), 'SVG_UNSUPPORTED_ATTRIBUTE')

    def test_external_data_and_obfuscated_references_are_rejected(self):
        for value in ('https://example.invalid/p.svg#p', '//example.invalid/p', 'data:image/svg+xml;base64,PHN2Zz4=', 'javascript:alert(1)', '/path.svg#p', 'p.svg#p', '#p%20', ' #p'):
            with self.subTest(value=value): self.reject(svg('<use href="'+value+'"/>'), 'SVG_EXTERNAL_OR_UNSUPPORTED_REFERENCE')
        self.reject(svg('<use href="#p" xlink:href="https://example.invalid/a"/>', 'xmlns:xlink="http://www.w3.org/1999/xlink"'))

    def test_css_import_urls_escapes_comments_unknown_properties_are_rejected(self):
        for css in ('@import "https://example.invalid/a";', '.a{fill:url(https://example.invalid/p)}',
                    '.a{fill:u\\72l(https://example.invalid/p)}', '.a{fill:/*x*/red}',
                    '.a{behavior:url(a)}', '.a{fill:expression(alert(1))}', '.a{fill:red!important}',
                    '.a{background-image:url(data:image/png;base64,AA)}', 'path:hover{fill:red}'):
            with self.subTest(css=css): self.reject(svg('<style>'+css+'</style>'))
        self.reject(svg('<path d="M0 0" style="fill:u&#114;l(https://example.invalid/a)"/>'))
        self.reject(svg('<style>.a{clip-path:url(#c)}</style><clipPath id="c" class="a"/>'), 'SVG_STYLESHEET_RESOURCE_REFERENCE_UNSUPPORTED')

    def test_namespace_confusion_and_xml_base_are_rejected(self):
        for data in (b'<svg viewBox="0 0 1 1"/>', b'<svg xmlns="https://example.invalid" viewBox="0 0 1 1"/>',
                     svg('<path xmlns="" d="M0 0"/>'), svg('<x:path/>', 'xmlns:x="https://example.invalid"'),
                     svg('<path xml:base="https://example.invalid" d="M0 0"/>'), svg('', 'xmlns:unused="https://example.invalid"')):
            self.reject(data)

    def test_invalid_nonfinite_and_overflow_coordinates_are_rejected_everywhere(self):
        for value in ('NaN', 'Inf', '-Infinity', '1e999', '1000000001', '\u0661'):
            with self.subTest(value=value):
                self.reject(svg('<circle r="'+value+'"/>'))
                self.reject(svg('<g transform="translate('+value+')"/>'))
                self.reject(svg('<path d="M'+value+' 0"/>'))
        self.reject(svg('', 'width="1e999px"'))

    def test_negative_sizes_and_invalid_viewboxes_are_rejected_but_negative_positions_work(self):
        for body in ('<circle r="-1"/>', '<rect width="-1"/>', '<ellipse ry="-1"/>', '<path d="M0 0" pathLength="-2"/>'):
            self.reject(svg(body), 'SVG_NEGATIVE_GEOMETRY')
        for box in ('0 0 0 1', '0 0 1 -1', '0 0 1', '0 0 1e999 1'):
            self.reject(svg().replace(b'-12 -3 100 200', box.encode()))
        self.reject(svg('', 'height="0"'), 'SVG_NONPOSITIVE_DIMENSION')
        self.reject(b'<svg xmlns="http://www.w3.org/2000/svg" width="1"/>', 'SVG_VIEWBOX_REQUIRED')

    def test_path_arities_arc_flags_and_unsupported_commands_are_rejected(self):
        for d in ('L0 0', 'M0', 'M0 0Z1', 'M0 0C1 2 3', 'M0 0R1 2', 'M0 0A1 2 3 2 0 4 5', 'M0 0A-1 2 3 0 1 4 5'):
            with self.subTest(d=d): self.reject(svg('<path d="'+d+'"/>'))

    def test_transform_arity_and_geometry_lists_are_rejected(self):
        for transform in ('matrix(1 2)', 'rotate(1 2)', 'translate()', 'translate(1);', 'url(#p)', 'scale(1)junk'):
            self.reject(svg('<g transform="'+transform+'"/>'))
        self.reject(svg('<polygon points="0 1 2"/>'))
        self.reject(svg('<circle cx="1 2"/>'))

    def test_missing_duplicate_wrong_type_and_group_use_targets_are_rejected(self):
        for body in ('<use href="#absent"/>', '<path id="p" d="M0 0"/><path id="p" d="M1 1"/>',
                     '<g id="g"><path d="M0 0"/></g><use href="#g"/>',
                     '<linearGradient id="p"/><use href="#p"/>', '<path id="p" d="M0 0" fill="url(#p)"/>'):
            self.reject(svg(body))

    def test_reference_cycles_including_geometry_clip_dependencies_are_rejected(self):
        for body in ('<linearGradient id="a" href="#a"/>', '<linearGradient id="a" href="#b"/><linearGradient id="b" href="#a"/>',
                     '<defs><path id="p" d="M0 0" clip-path="url(#c)"/><clipPath id="c"><use href="#p"/></clipPath></defs>'):
            self.reject(svg(body), 'SVG_REFERENCE_CYCLE')

    def test_deep_reference_chain_is_iterative_not_python_recursion(self):
        gradients = ''.join('<linearGradient id="g'+str(n)+'"'+(' href="#g'+str(n+1)+'"' if n < 1199 else '')+'/>' for n in range(1200))
        self.reject(svg('<defs>'+gradients+'</defs>'), 'SVG_REFERENCE_EXPANSION_LIMIT')

    def test_stylesheet_rules_declarations_and_namespace_counts_are_bounded(self):
        with patch.object(inspector, 'MAX_CSS_RULES', 1): self.reject(svg('<style>.a{fill:red}.b{fill:blue}</style>'), 'SVG_CSS_RULE_LIMIT')
        with patch.object(inspector, 'MAX_CSS_DECLARATIONS', 1): self.reject(svg('<path style="fill:red;stroke:black" d="M0 0"/>'), 'SVG_CSS_DECLARATION_LIMIT')
        with patch.object(inspector, 'MAX_ATTRIBUTES', 1): self.reject(svg('', 'xmlns:x="http://www.w3.org/1999/xlink"'), 'SVG_UNSUPPORTED_NAMESPACE_OR_LIMIT')
        with patch.object(inspector, 'MAX_STYLESHEET_LENGTH', 5): self.reject(svg('<style>.a{fill:red}</style>'), 'SVG_STYLESHEET_LENGTH_LIMIT')

    def test_repeated_complex_geometry_has_a_weighted_expansion_limit(self):
        with patch.object(inspector, 'MAX_EXPANDED_GEOMETRY', 100):
            self.reject(svg('<defs><path id="p" d="M0 0'+' L1 1'*10+'"/></defs>'+'<use href="#p"/>'*4), 'SVG_EXPANDED_GEOMETRY_LIMIT')

    def test_malformed_long_stylesheets_and_transforms_reject_with_bounded_work(self):
        # The timeout is a regression guard against quadratic invalid-input scanning.
        with tempfile.TemporaryDirectory() as directory:
            p = Path(directory)/'fixture.svg'
            for data in (svg('<style>'+'a'*100000+'</style>'), svg('<g transform="'+'a'*16000+'"/>')):
                p.write_bytes(data)
                result = subprocess.run([sys.executable, str(SCRIPT), str(p)], capture_output=True, text=True, timeout=3)
                self.assertEqual(result.returncode, 2); self.assertEqual(result.stderr, '')

    def test_size_node_depth_attribute_path_and_expansion_limits(self):
        with patch.object(inspector, 'MAX_BYTES', 8): self.reject(svg(), 'SVG_BYTE_LIMIT')
        with patch.object(inspector, 'MAX_NODES', 2): self.reject(svg('<g/><g/>'), 'SVG_STRUCTURE_LIMIT')
        with patch.object(inspector, 'MAX_DEPTH', 3): self.reject(svg('<g><g><g/></g></g>'), 'SVG_STRUCTURE_LIMIT')
        with patch.object(inspector, 'MAX_ATTRIBUTES', 1): self.reject(svg('<path d="M0 0" fill="red"/>'), 'SVG_STRUCTURE_LIMIT')
        with patch.object(inspector, 'MAX_PATH_LENGTH', 4): self.reject(svg('<path d="M0 0L1 1"/>'), 'SVG_ATTRIBUTE_LENGTH_LIMIT|SVG_PATH_LENGTH_LIMIT')
        with patch.object(inspector, 'MAX_PATH_TOKENS', 3): self.reject(svg('<path d="M0 0L1 1"/>'), 'SVG_PATH_TOKEN_LIMIT')
        with patch.object(inspector, 'MAX_EXPANDED_NODES', 5): self.reject(svg('<defs><path id="p" d="M0 0"/></defs><use href="#p"/><use href="#p"/>'), 'SVG_REFERENCE_EXPANSION_LIMIT')

    def test_invalid_xml_encoding_text_and_control_bytes_are_rejected(self):
        for data in (svg()[:-1], svg()+svg(), svg('<title>\0</title>'), b'\xff'+svg(), svg('<g>unexpected</g>'),
                     b'<?xml version="1.0" encoding="ISO-8859-1"?>'+svg(), '<svg/>'.encode('utf-16'),
                     svg().decode().encode('utf-16-le'), svg().decode().encode('utf-16-be')):
            self.reject(data)

    def test_original_file_is_unchanged_and_receipt_does_not_embed_source(self):
        with tempfile.TemporaryDirectory() as directory:
            p = Path(directory)/'fixture.svg'; original = svg('<title>Synthetic fixture</title><path d="M1 2L3 4"/>'); p.write_bytes(original)
            receipt = inspector.inspect_file(p)
            self.assertEqual(p.read_bytes(), original)
            self.assertEqual(list(Path(directory).iterdir()), [p])
            self.assertNotIn('Synthetic fixture', json.dumps(receipt))
            self.assertNotIn('M1 2L3 4', json.dumps(receipt))

    def test_cli_rejected_json_has_no_traceback_and_nonzero_exit(self):
        with tempfile.TemporaryDirectory() as directory:
            p = Path(directory)/'fixture.svg'; p.write_bytes(svg('<script/>'))
            result = subprocess.run([sys.executable, str(SCRIPT), str(p)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 2); self.assertEqual(result.stderr, '')
            self.assertEqual(json.loads(result.stdout)['securityPreflight'], 'rejected')

    def test_file_wrapper_rejects_links_special_files_and_oversized_inputs(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); target = root/'fixture.svg'; target.write_bytes(svg())
            link = root/'link.svg'; link.symlink_to(target)
            with self.assertRaises(OSError): inspector.inspect_file(link)
            fifo = root/'pipe.svg'; os.mkfifo(fifo)
            with self.assertRaisesRegex(inspector.Rejected, 'SVG_REGULAR_FILE_REQUIRED'): inspector.inspect_file(fifo)
            with patch.object(inspector, 'MAX_BYTES', 8), self.assertRaisesRegex(inspector.Rejected, 'SVG_BYTE_LIMIT'): inspector.inspect_file(target)


class HafsDialectActiveContentTests(SvgSecurityTests):
    """Repeat the existing rejection corpus with the explicit dialect selected."""
    def reject(self, value, code=None):
        with self.assertRaisesRegex(inspector.Rejected, code or "SVG_"):
            inspector.inspect_svg(value, dialect=inspector.QURAN_WS_HAFS_DIALECT)


class HafsDialectCompatibilityTests(unittest.TestCase):
    def inspect(self, value):
        return inspector.inspect_svg(value, dialect=inspector.QURAN_WS_HAFS_DIALECT)

    def reject(self, value, code=None):
        with self.assertRaisesRegex(inspector.Rejected, code or "SVG_"):
            self.inspect(value)

    def test_passive_dialect_is_explicit_and_preserves_original_identity(self):
        data = hafs_svg('<g ayah:x="-3.25" ayah:y="1e2"><path d="M0 0L1 1Z"/></g>'
                        '<path id="verse-1" number="001001" surah="1" ayah="1" d="M0 0L2 0L2 2Z"/>')
        with self.assertRaisesRegex(inspector.Rejected, 'SVG_UNSUPPORTED_NAMESPACE'):
            inspector.inspect_svg(data)
        receipt = self.inspect(data)
        self.assertEqual(receipt['policy'], 'static-vector-subset-10f-v1')
        self.assertEqual(receipt['dialect'], inspector.QURAN_WS_HAFS_DIALECT)
        self.assertEqual(receipt['passiveMetadata'], {'coordinatePairs': 1, 'ayahLabels': 1, 'xmlSpace': 1})
        self.assertEqual(receipt['sha256'], hashlib.sha256(data).hexdigest())
        self.assertEqual(receipt['viewBox'], [-12, -3, 100, 200])
        self.assertTrue(all(value is False for value in receipt['flags'].values()))
        self.assertEqual(inspector.inspect_svg(svg())['policy'], 'static-vector-subset-10d-v1')
        with self.assertRaisesRegex(inspector.Rejected, 'SVG_UNSUPPORTED_DIALECT'):
            inspector.inspect_svg(data, dialect='auto')

    def test_xml_space_accepts_only_exact_root_values(self):
        for value in ('preserve', 'default'):
            self.assertEqual(self.inspect(hafs_svg(attrs='xml:space="'+value+'"'))['passiveMetadata']['xmlSpace'], 1)
        for value in ('', 'Preserve', 'preserve ', 'url(https://example.invalid)', 'javascript:alert(1)'):
            with self.subTest(value=value): self.reject(hafs_svg(attrs='xml:space="'+value+'"'), 'SVG_DIALECT_XML_SPACE_INVALID')
        self.reject(hafs_svg('<path xml:space="preserve" d="M0 0"/>'), 'SVG_DIALECT_XML_SPACE_INVALID')
        self.reject(hafs_svg(attrs='xml:base="https://example.invalid"'), 'SVG_UNSUPPORTED_ATTRIBUTE')

    def test_metadata_coordinate_pair_requires_group_and_bounded_scalars(self):
        for body in ('<g ayah:x="1"/>', '<g ayah:y="1"/>', '<path ayah:x="1" ayah:y="2" d="M0 0"/>',
                     '<circle ayah:x="1" ayah:y="2" r="1"/>'):
            with self.subTest(body=body): self.reject(hafs_svg(body), 'SVG_DIALECT_COORDINATE_PAIR_REQUIRED_ON_GROUP')
        for value in ('NaN', 'Infinity', '1e999', '1000000001', '-1000000001', '1 2', '1,2', '2px', '\u0661', '1'*129):
            with self.subTest(value=value): self.reject(hafs_svg('<g ayah:x="'+value+'" ayah:y="1"/>'))

    def test_metadata_identity_requires_complete_padded_canonical_triple(self):
        self.inspect(hafs_svg('<path number="114006" surah="114" ayah="6" d="M0 0"/>'))
        for attrs in ('surah="1" ayah="1"', 'number="001001" surah="1"',
                      'number="001002" surah="1" ayah="1"', 'number="115001" surah="115" ayah="1"',
                      'number="002287" surah="2" ayah="287"', 'number="000001" surah="0" ayah="1"',
                      'number="001000" surah="1" ayah="0"', 'number="001001" surah="01" ayah="1"',
                      'number="001001" surah="1" ayah="01"', 'number="001001" surah="1e0" ayah="1"',
                      'number="001001" surah="\u0661" ayah="1"', 'number="1001" surah="1" ayah="1"',
                      'number="001001 " surah="1" ayah="1"'):
            with self.subTest(attrs=attrs): self.reject(hafs_svg('<path '+attrs+' d="M0 0"/>'), 'SVG_DIALECT_AYAH_')
        self.reject(hafs_svg('<g number="001001" surah="1" ayah="1"/>'), 'SVG_DIALECT_AYAH_TRIPLE_REQUIRED_ON_PATH')

    def test_duplicate_canonical_keys_and_malformed_source_ids_remain_rejected(self):
        path = '<path number="019003" surah="19" ayah="3" d="M0 0"/>'
        self.reject(hafs_svg(path+path), 'SVG_DIALECT_DUPLICATE_AYAH_IDENTIFIER')
        self.reject(hafs_svg('<path id="M 5.0 86.5 L 28.75 86.5 Z" number="019003" surah="19" ayah="3" d="M0 0"/>'), 'SVG_INVALID_OR_DUPLICATE_ID')
        self.reject(hafs_svg('<path id="same" d="M0 0"/><path id="same" d="M1 1"/>'), 'SVG_INVALID_OR_DUPLICATE_ID')

    def test_unknown_namespaces_elements_and_metadata_attributes_are_rejected(self):
        self.reject(hafs_svg(attrs='xmlns:extra="https://example.invalid"'), 'SVG_UNSUPPORTED_NAMESPACE')
        self.reject(hafs_svg('<ayah:path/>'), 'SVG_UNSUPPORTED_ELEMENT_OR_NAMESPACE')
        for attr in ('ayah:href="https://example.invalid"', 'ayah:onload="alert(1)"', 'ayah:surah="1"',
                     'data-surah="1"', 'xml:lang="ar"', 'onload="alert(1)"'):
            with self.subTest(attr=attr): self.reject(hafs_svg('<g '+attr+'/>'), 'SVG_UNSUPPORTED_ATTRIBUTE')

    def test_active_content_cannot_hide_behind_passive_metadata(self):
        for body in ('<g ayah:x="1" ayah:y="2" onload="alert(1)"/>',
                     '<g ayah:x="1" ayah:y="2"><script/></g>',
                     '<g ayah:x="1" ayah:y="2"><image href="https://example.invalid/a"/></g>',
                     '<path number="001001" surah="1" ayah="1" d="M0 0" fill="url(https://example.invalid/a)"/>',
                     '<style>.x{fill:url(https://example.invalid/a)}</style>',
                     '<defs><path id="a" d="M0 0"/></defs><use href="https://example.invalid/a"/>'):
            with self.subTest(body=body): self.reject(hafs_svg(body))
        self.reject(b'<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]>'+hafs_svg(), 'SVG_DTD_ENTITY_OR_PI_FORBIDDEN')

    def test_dialect_preserves_structure_and_geometry_resource_bounds(self):
        with patch.object(inspector, 'MAX_ATTRIBUTES', 2): self.reject(hafs_svg('<g ayah:x="1" ayah:y="2" id="g"/>'), 'SVG_STRUCTURE_LIMIT')
        with patch.object(inspector, 'MAX_DEPTH', 2): self.reject(hafs_svg('<g ayah:x="1" ayah:y="2"><path d="M0 0"/></g>'), 'SVG_STRUCTURE_LIMIT')
        with patch.object(inspector, 'MAX_PATH_TOKENS', 3): self.reject(hafs_svg('<path number="001001" surah="1" ayah="1" d="M0 0L1 1"/>'), 'SVG_PATH_TOKEN_LIMIT')
        with patch.object(inspector, 'MAX_EXPANDED_GEOMETRY', 2): self.reject(hafs_svg('<path number="001001" surah="1" ayah="1" d="M0 0"/>'), 'SVG_EXPANDED_GEOMETRY_LIMIT')

    def test_cli_requires_explicit_dialect_and_does_not_rewrite_input(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'dialect.svg'; data = hafs_svg('<g ayah:x="1" ayah:y="2"/>'); path.write_bytes(data)
            generic = subprocess.run([sys.executable, str(SCRIPT), str(path)], capture_output=True, text=True)
            scoped = subprocess.run([sys.executable, str(SCRIPT), str(path), '--dialect', inspector.QURAN_WS_HAFS_DIALECT], capture_output=True, text=True)
            self.assertEqual(generic.returncode, 2)
            self.assertEqual(scoped.returncode, 0)
            self.assertEqual(json.loads(scoped.stdout)['policy'], 'static-vector-subset-10f-v1')
            self.assertEqual(path.read_bytes(), data)


if __name__ == '__main__':
    unittest.main()
