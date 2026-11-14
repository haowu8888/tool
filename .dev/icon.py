import sys
from PIL import Image, ImageDraw, ImageChops
S = 4096  # draw big, scale down to 1024
k = S / 1024
def r(*v): return [int(x * k) for x in v]

# background: rounded square with a diagonal gradient
grad = Image.new("RGB", (S, S))
a, b = (14, 165, 233), (79, 70, 229)
g = Image.new("L", (256, 256))
g.putdata([(x + y) // 2 for y in range(256) for x in range(256)])
g = g.resize((S, S), Image.BILINEAR)
grad = Image.composite(Image.new("RGB", (S, S), b), Image.new("RGB", (S, S), a), g)
bg_mask = Image.new("L", (S, S), 0)
ImageDraw.Draw(bg_mask).rounded_rectangle(r(64, 64, 960, 960), radius=int(200 * k), fill=255)

# toolbox glyph
glyph = Image.new("L", (S, S), 0)
d = ImageDraw.Draw(glyph)
d.rounded_rectangle(r(372, 250, 652, 400), radius=int(56 * k), outline=255, width=int(52 * k))  # handle
d.rounded_rectangle(r(220, 360, 804, 780), radius=int(72 * k), fill=255)  # body
cut = Image.new("L", (S, S), 0)
c = ImageDraw.Draw(cut)
c.rectangle(r(220, 500, 804, 536), fill=255)  # gap between lid and body
glyph = ImageChops.subtract(glyph, cut)
d = ImageDraw.Draw(glyph)
latch = Image.new("L", (S, S), 0)
ImageDraw.Draw(latch).rounded_rectangle(r(452, 470, 572, 566), radius=int(22 * k), fill=255)
ring = Image.new("L", (S, S), 0)
ImageDraw.Draw(ring).rounded_rectangle(r(430, 448, 594, 588), radius=int(36 * k), fill=255)
glyph = ImageChops.subtract(glyph, ring)  # a clearance around the latch
glyph = ImageChops.lighter(glyph, latch)

# soft shadow under the glyph
from PIL import ImageFilter
shadow = glyph.filter(ImageFilter.GaussianBlur(int(18 * k))).point(lambda v: v * 0.35)
shadow = ImageChops.offset(shadow, 0, int(16 * k))

img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
img.paste(grad, (0, 0), bg_mask)
img.paste((20, 24, 60), (0, 0), ImageChops.multiply(shadow, bg_mask))
img.paste((255, 255, 255), (0, 0), glyph)
img = img.resize((1024, 1024), Image.LANCZOS)
img.save(sys.argv[1])
img.resize((32, 32), Image.LANCZOS).save(sys.argv[2])
img.resize((256, 256), Image.LANCZOS).save("/tmp/icon_new_small.png")
