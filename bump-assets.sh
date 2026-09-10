#!/bin/sh
# Re-stamp index.html with a digest of the assets, so a browser holding an old
# loan.css or loan.js is forced to re-fetch. Run before committing a change to
# any of them. The filenames never change, so without this the cache wins.
python3 - <<'PY'
import hashlib, re
d = hashlib.sha1(
    open('loan.css','rb').read() + open('loan.js','rb').read() + open('engine.js','rb').read()
).hexdigest()[:8]
h = open('index.html').read()
for f in ('loan.css', 'engine.js', 'loan.js'):
    attr = 'href' if f.endswith('.css') else 'src'
    h = re.sub(r'%s="%s(\?v=[0-9a-f]+)?"' % (attr, re.escape(f)), '%s="%s?v=%s"' % (attr, f, d), h)
open('index.html', 'w').write(h)
print('assets stamped', d)
PY
