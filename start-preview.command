#!/bin/sh
set -eu
cd "$(dirname "$0")/dist"
echo "مُلازَمَة — MULAZAMA — افتح http://127.0.0.1:5184 في المتصفح"
echo "لإيقاف المعاينة اضغط Ctrl+C"
python3 -m http.server 5184 --bind 127.0.0.1
