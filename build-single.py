#!/usr/bin/env python3
"""Inline the stylesheet and both scripts into one self-contained HTML file.

re.sub is deliberately given a lambda: the assets contain backslash escapes,
and a plain replacement string would have them read as group references.
"""
import re, sys

out = sys.argv[1] if len(sys.argv) > 1 else "student-loan-model.html"
html = open("index.html").read()
css, engine, ui = (open(f).read() for f in ("loan.css", "engine.js", "loan.js"))

html = re.sub(r'<link rel="stylesheet" href="loan\.css[^"]*" />',
              lambda m: "<style>\n" + css + "\n</style>", html)
html = re.sub(r'<script src="engine\.js[^"]*"></script>\s*<script src="loan\.js[^"]*" defer></script>',
              lambda m: "<script>\n" + engine + "\n</script>\n<script>\n" + ui + "\n</script>", html)

for left in ('href="loan.css', 'src="engine.js', 'src="loan.js'):
    assert left not in html, left + " was left unlinked"

open(out, "w").write(html)
print("single file:", round(len(html) / 1024), "KB ->", out)
