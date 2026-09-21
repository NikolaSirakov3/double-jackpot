#!/bin/zsh
set -e
cd "${0:A:h}"
echo "Two Jackpots Wild Wheel"
echo "Open http://localhost:8080 in your browser."
echo "Press Control-C here to stop the local server."
python3 -m http.server 8080
