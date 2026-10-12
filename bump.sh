#!/bin/sh
# Sätter ny cache-version på filerna innan publicering: ./bump.sh
V=$(date +%Y%m%d%H%M)
sed -i.bak "s#style.css?v=[^\"]*#style.css?v=$V#; s#js/app.js?v=[^\"]*#js/app.js?v=$V#" index.html
sed -i.bak "s#rules.js?v=[^']*#rules.js?v=$V#" js/app.js
rm -f index.html.bak js/app.js.bak
echo "Version $V"
