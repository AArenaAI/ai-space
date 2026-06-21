from pathlib import Path
import math
import subprocess
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / 'public' / 'home-materials' / 'features'
POSTER_DIR = OUT_DIR / 'posters'
TMP_DIR = ROOT / 'tmp' / 'redraw-creative-feature-video'
TMP_DIR.mkdir(parents=True, exist_ok=True)
OUT_DIR.mkdir(parents=True, exist_ok=True)
POSTER_DIR.mkdir(parents=True, exist_ok=True)
for p in TMP_DIR.glob('frame-*.png'):
    p.unlink()

W, H = 960, 600

def font(size, bold=False):
    candidates = [
        '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc' if bold else '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
        '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf' if bold else '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    ]
    for c in candidates:
        try:
            return ImageFont.truetype(c, size)
        except Exception:
            pass
    return ImageFont.load_default()

FB = font(28, True)
FM = font(18, False)
FS = font(13, False)
FX = font(11, False)
FMB = font(15, True)


def rr(d, box, r, fill, outline=None, width=1):
    d.rounded_rectangle(box, radius=r, fill=fill, outline=outline, width=width)


def text_top(d, xy, text, font, fill):
    # Pillow fonts can have positive bbox offsets that visually shave the top of Latin text.
    # Normalize so xy is the true visual top-left.
    x, y = xy
    box = d.textbbox((0, 0), text, font=font)
    d.text((x - box[0], y - box[1]), text, font=font, fill=fill)


def lerp(a, b, t):
    return int(a + (b - a) * t)


def gradient_rect(im, box, c1, c2, radius=16):
    x1, y1, x2, y2 = box
    w, h = x2 - x1, y2 - y1
    layer = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    for y in range(h):
        t = y / max(h - 1, 1)
        col = tuple(lerp(c1[i], c2[i], t) for i in range(3)) + (255,)
        ld.line((0, y, w, y), fill=col)
    mask = Image.new('L', (w, h), 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle((0, 0, w, h), radius=radius, fill=255)
    im.paste(layer, (x1, y1), mask)


def ease(x):
    x = max(0, min(1, x))
    return 1 - (1 - x) ** 3


def draw_frame(i):
    t = i / 24
    im = Image.new('RGB', (W, H), (250, 247, 253))
    d = ImageDraw.Draw(im)

    # outer card fills the whole video frame with modest margin, no browser chrome, no footer badge
    rr(d, (10, 10, W - 10, H - 10), 26, (255, 255, 255), (244, 208, 226), 2)

    # sidebar
    rr(d, (26, 30, 246, 570), 22, (250, 248, 251), (238, 232, 240), 1)
    text_top(d, (52, 60), 'Generate Image', font=FMB, fill=(28, 28, 34))
    menu = [
        ('Generate Video', True), ('Seedream Beta', False), ('', False), ('TOOLS', False),
        ('Background Removal', True), ('Background Replacement', False), ('Text Removal', True),
        ('Image Upscale', False), ('Local Redraw', False), ('Region Brush', False),
    ]
    y = 102
    for idx, (label, hot) in enumerate(menu):
        if not label:
            y += 10
            continue
        if label == 'TOOLS':
            text_top(d, (52, y - 10), label, font=FX, fill=(150, 145, 154))
            y += 28
            continue
        pulse = int(24 * (0.5 + 0.5 * math.sin(t * 4 + idx))) if hot else 0
        d.ellipse((52, y - 10, 60, y - 2), fill=(236, 72 + pulse // 3, 153 + pulse // 4) if hot else (210, 205, 214))
        text_top(d, (70, y - 18), label, font=FX, fill=(74, 70, 78))
        y += 34

    # main content
    text_top(d, (272, 48), 'Generate Image', font=FB, fill=(24, 23, 28))
    rr(d, (272, 88, 925, 176), 20, (255, 255, 255), (232, 226, 235), 1)
    rr(d, (292, 110, 338, 154), 14, (250, 247, 251), (235, 228, 236), 1)
    text_top(d, (308, 122), '+', font=FM, fill=(120, 112, 124))

    prompt = 'cinematic fantasy heroine, rain bridge, glowing lanterns'
    typed = prompt[: int(len(prompt) * ease(t / 1.8))]
    text_top(d, (358, 124), typed or 'Describe the image you want to create...', font=FS, fill=(42, 38, 48) if typed else (148, 142, 152))
    if int(t * 3) % 2 == 0 and t < 2.1:
        cx = 358 + int(d.textlength(typed, font=FS)) + 3
        d.line((cx, 120, cx, 142), fill=(236, 72, 153), width=2)

    chips = [('GPT Image 2', 272, 194, 372), ('Auto · 1K', 386, 194, 474), ('Low', 494, 194, 538), ('Med', 546, 194, 592), ('High', 600, 194, 654), ('Auto', 662, 194, 716)]
    for label, x1, y1, x2 in chips:
        sel = label == 'Med'
        rr(d, (x1, y1, x2, y1 + 30), 10, (252, 244, 248) if sel else (255, 255, 255), (236, 228, 236), 1)
        text_top(d, (x1 + 12, y1 + 9), label, font=FX, fill=(236, 72, 153) if sel else (86, 82, 90))
    glow = int(10 + 8 * math.sin(t * 5))
    rr(d, (876 - glow//3, 192 - glow//3, 924 + glow//3, 224 + glow//3), 14, (236, 72, 153), (236, 72, 153), 1)
    text_top(d, (895, 203), '5', font=FS, fill=(255, 255, 255))

    # progress bar during generation
    if 1.7 <= t <= 3.05:
        p = ease((t - 1.7) / 1.35)
        rr(d, (272, 236, 925, 246), 5, (250, 236, 245), None)
        rr(d, (272, 236, 272 + int(653 * p), 246), 5, (236, 72, 153), None)
        text_top(d, (272, 222), 'Generating previews…', font=FX, fill=(170, 70, 130))

    text_top(d, (272, 260), 'Discover', font=FM, fill=(31, 29, 36))
    colors = [
        ((206, 180, 95), (125, 103, 48)), ((240, 166, 210), (140, 93, 214)),
        ((47, 41, 56), (8, 7, 11)), ((73, 82, 95), (17, 24, 39)),
        ((217, 169, 69), (125, 75, 24)), ((36, 32, 38), (197, 155, 59)),
        ((234, 208, 206), (164, 107, 120)), ((244, 177, 203), (124, 143, 167)),
    ]
    boxes = [(272, 290, 428, 430), (442, 290, 598, 430), (612, 290, 768, 430), (782, 290, 938, 430),
             (272, 444, 428, 584), (442, 444, 598, 584), (612, 444, 768, 584), (782, 444, 938, 584)]
    for idx, b in enumerate(boxes):
        appear = ease((t - 0.55 - idx * 0.05) / 0.5)
        if appear <= 0:
            rr(d, b, 16, (250, 247, 251), (240, 232, 241), 1)
            continue
        x1, y1, x2, y2 = b
        dy = int((1 - appear) * 24 + math.sin(t * 2.2 + idx) * 2)
        draw_box = (x1, y1 + dy, x2, y2 + dy)
        gradient_rect(im, draw_box, colors[idx][0], colors[idx][1], 16)
        x1, y1, x2, y2 = draw_box
        # clipped decorative strokes with visible motion
        clip = Image.new('RGBA', (x2-x1, y2-y1), (0, 0, 0, 0))
        cd = ImageDraw.Draw(clip)
        for k in range(5):
            yy = 18 + k * 17 + math.sin(t * 3 + idx + k) * 8
            cd.line((12, yy, (x2-x1)-12, yy + 10), fill=(255, 255, 255, int((44 + k * 8) * appear)), width=2 + k)
        cd.ellipse(((x2-x1)-40 + math.sin(t*3+idx)*5, 16, (x2-x1)-18 + math.sin(t*3+idx)*5, 38), fill=(255, 255, 255, int(64 * appear)))
        mask = Image.new('L', (x2-x1, y2-y1), 0)
        md = ImageDraw.Draw(mask)
        md.rounded_rectangle((0, 0, x2-x1, y2-y1), radius=16, fill=int(255 * appear))
        im.paste(Image.alpha_composite(Image.new('RGBA', (x2-x1, y2-y1), (0,0,0,0)), clip), (x1, y1), mask)
    return im

for i in range(120):
    draw_frame(i).save(TMP_DIR / f'frame-{i:04d}.png')

subprocess.run(['ffmpeg', '-y', '-framerate', '24', '-i', str(TMP_DIR / 'frame-%04d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '20', '-movflags', '+faststart', str(OUT_DIR / 'creative.mp4')], check=True)
subprocess.run(['ffmpeg', '-y', '-ss', '00:00:03.00', '-i', str(OUT_DIR / 'creative.mp4'), '-frames:v', '1', '-q:v', '2', str(POSTER_DIR / 'creative.png')], check=True)
print('[done] creative feature video redrawn')
