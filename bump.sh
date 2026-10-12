#!/bin/sh
# Sätter ny cache-version på filerna innan publicering: ./bump.sh
V=$(date +%Y%m%d%H%M)
sed -i.bak "s#style.css?v=[^\"]*#style.css?v=$V#; s#js/app.js?v=[^\"]*#js/app.js?v=$V#" index.html
for f in js/*.js; do sed -i.bak "s#\(\./[a-z]*\.js\)?v=[^'\"]*#\1?v=$V#g" "$f"; done
rm -f index.html.bak js/*.js.bak
echo "Version $V"
