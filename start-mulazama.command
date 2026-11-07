#!/bin/zsh
set -e
cd "${0:A:h}/dist"
print 'مُلازَمَة — MULAZAMA'
print 'افتح http://127.0.0.1:5184 — للإيقاف Ctrl+C'
python3 -m http.server 5184 --bind 127.0.0.1
