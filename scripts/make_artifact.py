"""Turn the Vite build (dist/) into a single self-contained page for publishing as an Artifact.

Artifact pages are body content only (no <html>/<head>/<body>), with CSS and JS inline;
the data files are published next to the page and fetched with relative URLs.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
out = Path(sys.argv[1])
html = (ROOT / "dist" / "index.html").read_text()

css_href = re.search(r'<link rel="stylesheet"[^>]*href="\./(assets/[^"]+\.css)"[^>]*>', html)
js_src = re.search(r'<script type="module"[^>]*src="\./(assets/[^"]+\.js)"[^>]*></script>', html)
css = (ROOT / "dist" / css_href.group(1)).read_text()
js = (ROOT / "dist" / js_src.group(1)).read_text().replace("</script", "<\\/script")

head = html.split("<head>", 1)[1].split("</head>", 1)[0]
body = html.split("<body>", 1)[1].split("</body>", 1)[0]
title = re.search(r"<title>.*?</title>", head).group(0)
fonts = "\n".join(re.sub(r"\s+", " ", l) for l in re.findall(r'<link\s[^>]*fonts\.(?:googleapis|gstatic)\.com[^>]*>', head, re.S))
body = body.replace(js_src.group(0), "")

out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(f"{title}\n{fonts}\n<style>\n{css}\n</style>\n{body}\n<script type=\"module\">\n{js}\n</script>\n")
print(out, f"{out.stat().st_size / 1e3:.0f} kB")
