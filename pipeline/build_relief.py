"""The painted land under the map: Natural Earth's cross-blended hypsometric tints with shaded relief
(HYP_HR_SR_W, 1:10m, public domain), cropped to India, reprojected into the map's own frame and
written as one WebP the site loads after its first paint.

    curl -O https://naturalearth.s3.amazonaws.com/10m_raster/HYP_HR_SR_W.zip   (into raw/relief/, unzip)
    python3 pipeline/build_relief.py

The site draws it clipped to India's outline, so what lies beyond the border only costs bytes:
it's blurred and flattened to keep the file small.
"""
import json
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "raw" / "relief"
OUT = ROOT / "src" / "assets" / "geo" / "relief.webp"
LON0, LON1, LAT0, LAT1 = 66.0, 99.0, 5.0, 38.0  # a little more than India, every side
SCALE = 2  # 2000 x 2200 pixels for the map's 1000 x 1100 units

Image.MAX_IMAGE_PIXELS = None
src = Image.open(RAW / "HYP_HR_SR_W.tif")
W, H = src.size
box = (round((LON0 + 180) / 360 * W), round((90 - LAT1) / 180 * H), round((LON1 + 180) / 360 * W), round((90 - LAT0) / 180 * H))
crop = src.crop(box).convert("RGB")
cw, ch = crop.size
(RAW / "crop.rgb").write_bytes(crop.tobytes())
(RAW / "crop.json").write_text(json.dumps({"w": cw, "h": ch, "lon0": LON0, "lon1": LON1, "lat0": LAT0, "lat1": LAT1}))
print(f"crop: {cw} x {ch} ({cw / (LON1 - LON0):.0f} px a degree)")

subprocess.run(["node", str(ROOT / "scripts" / "relief-reproject.mjs"), str(RAW / "crop.rgb"), str(RAW / "crop.json"), str(RAW / "frame.rgb"), str(SCALE)], check=True)
frame = Image.frombytes("RGB", (1000 * SCALE, 1100 * SCALE), (RAW / "frame.rgb").read_bytes())

# beyond India's outline nobody sees it (the site clips to it): flatten it so it costs almost nothing
rings = json.loads((RAW / "frame.rings.json").read_text())
mask = Image.new("L", frame.size, 0)
draw = ImageDraw.Draw(mask)
for ring in rings:
    if len(ring) > 2:
        draw.polygon([tuple(p) for p in ring], fill=255)
mask = mask.filter(ImageFilter.MaxFilter(9))  # a few pixels' margin for the coast's stroke
flat = frame.filter(ImageFilter.GaussianBlur(24)).quantize(16).convert("RGB")
frame = Image.composite(frame, flat, mask)
OUT.parent.mkdir(parents=True, exist_ok=True)
frame.save(OUT, "WEBP", quality=72, method=6)
print(f"wrote {OUT.relative_to(ROOT)}: {OUT.stat().st_size // 1024} kB")
