"""Génère les icônes des 3 apps (dessinées en 4x puis réduites). Usage : python3 scripts/make-icons.py"""
from PIL import Image, ImageDraw, ImageFilter
S = 520  # rendu haute résolution

def base(c1, c2):
    g = Image.new('RGB', (S, S)); px = g.load()
    for y in range(S):
        for x in range(S):
            t = (x + y) / (2 * S)
            px[x, y] = tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3))
    m = Image.new('L', (S, S), 0); ImageDraw.Draw(m).rounded_rectangle((0, 0, S - 1, S - 1), 110, fill=255)
    out = Image.new('RGBA', (S, S), (0, 0, 0, 0)); out.paste(g, (0, 0), m)
    return out

W = (255, 255, 255, 255)

def live():
    im = base((235, 64, 82), (120, 20, 60)); d = ImageDraw.Draw(im)
    d.line((205, 105, 260, 165), fill=W, width=22); d.line((315, 105, 260, 165), fill=W, width=22)   # antenne
    d.rounded_rectangle((95, 165, 425, 400), 38, outline=W, width=24)                                  # écran
    d.ellipse((235, 245, 285, 295), fill=W)                                                            # point direct
    for r, a in ((62, 255), (96, 150)):
        d.arc((260 - r, 270 - r, 260 + r, 270 + r), 200, 340, fill=(255, 255, 255, a), width=14)       # ondes
    d.rounded_rectangle((200, 415, 320, 436), 10, fill=W)
    return im

def films():
    im = base((72, 132, 255), (30, 50, 150)); d = ImageDraw.Draw(im)
    d.rounded_rectangle((100, 215, 420, 420), 26, fill=W)                                              # corps clap
    d.polygon([(100, 215), (150, 130), (215, 130), (165, 215)], fill=W)                                # bandes
    d.polygon([(200, 215), (250, 130), (315, 130), (265, 215)], fill=W)
    d.polygon([(300, 215), (350, 130), (415, 130), (365, 215)], fill=W)
    d.rounded_rectangle((100, 168, 420, 215), 14, fill=(230, 236, 255, 255))
    d.polygon([(225, 275), (225, 370), (310, 322)], fill=(45, 90, 210, 255))                           # play
    return im

def series():
    im = base((150, 96, 240), (70, 30, 140)); d = ImageDraw.Draw(im)
    d.rounded_rectangle((165, 110, 405, 175), 20, fill=(255, 255, 255, 110))                           # piles
    d.rounded_rectangle((135, 150, 435, 225), 22, fill=(255, 255, 255, 180))
    d.rounded_rectangle((100, 205, 420, 420), 30, fill=W)                                              # écran
    d.polygon([(230, 265), (230, 360), (320, 312)], fill=(105, 55, 200, 255))
    return im

for d, fn in (('livetv', live), ('films', films), ('series', series)):
    im = fn().filter(ImageFilter.SMOOTH)
    for name, size in (('icon.png', 80), ('largeIcon.png', 130)):
        im.resize((size, size), Image.LANCZOS).save(f'apps/{d}/{name}')
    im.resize((256, 256), Image.LANCZOS).save(f'/tmp/icon-{d}.png')
