"""生成 launcher 图标。

两种风格，用环境变量切换：

  ICON_STYLE=photo  （默认）照片风：直接用凯露头像，缩到「目标尺寸的一半」再用
                    NEAREST 放大两倍 —— 观感就是原图标的一半清晰度，体积也小一半以上。
  ICON_STYLE=pixel  像素风：先压成 ICON_ART x ICON_ART 的小画布并量化成 ICON_COLORS 色，
                    再 NEAREST 放大，得到硬边像素块。

自适应图标的背景一律用纯色资源 @color/ic_launcher_bg（取画面主色），不再塞满幅图片，
这一项就省掉 300KB 以上。

输出：
  res/mipmap-<dpi>/ic_launcher.png            旧版方形图标（圆角）
  res/mipmap-<dpi>/ic_launcher_foreground.png 自适应图标前景（透明，留安全区）
  res/mipmap-anydpi-v26/ic_launcher.xml       自适应图标描述（背景 @color）
  res/values/colors.xml                       写入 ic_launcher_bg
"""
import io
import os
import re

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
RES = os.path.normpath(os.path.join(HERE, "..", "res"))
# 图标源图：默认用项目内的 reference/icon-source.jpg（用户 2026-10-31 发的最新凯露头像），
# 也可以用 ICON_SRC=/path/to/x.jpg 指定别的图。
SRC = os.environ.get("ICON_SRC") or os.path.normpath(
    os.path.join(HERE, "..", "reference", "icon-source.jpg")
)

STYLE = os.environ.get("ICON_STYLE", "photo")            # photo | pixel
ART = int(os.environ.get("ICON_ART", "32"))              # pixel 风格的画布边长
PALETTE = int(os.environ.get("ICON_COLORS", "24"))       # pixel 风格的调色板
HALF = os.environ.get("ICON_HALF", "1") != "0"           # photo 风格：是否降到一半清晰度
PHOTO_COLORS = int(os.environ.get("ICON_PHOTO_COLORS", "0"))  # photo 风格可选量化色数（0=不量化）

DENSITIES = {     # 目录 -> (旧版图标边长, 自适应画布边长)
    "mdpi": (48, 108),
    "hdpi": (72, 162),
    "xhdpi": (96, 216),
    "xxhdpi": (144, 324),
    "xxxhdpi": (192, 432),
}


def load_square():
    """居中裁正方形（纵向略偏上保住脸），四周留一点白边（取角落颜色）。"""
    img = Image.open(SRC).convert("RGB")
    w, h = img.size
    side = min(w, h)
    left = (w - side) // 2
    top = max(0, int((h - side) * 0.42))
    if top + side > h:
        top = h - side
    square = img.crop((left, top, left + side, top + side))
    pad = int(side * 0.055)
    canvas = Image.new("RGB", (side + pad * 2, side + pad * 2), square.getpixel((2, 2)))
    canvas.paste(square, (pad, pad))
    return canvas


SQUARE = load_square()


def dominant():
    """画面主色，用作纯色背景。"""
    q = SQUARE.resize((32, 32), Image.BOX).quantize(colors=8, method=Image.MEDIANCUT, dither=Image.NONE)
    palette = q.getpalette()
    idx = max(q.getcolors() or [(1, 0)])[1]
    return tuple(palette[idx * 3: idx * 3 + 3])


BG = dominant()


def art_at(size):
    """返回边长 size 的 RGB 图（两种风格都在这里收敛）。"""
    if STYLE == "pixel":
        small = SQUARE.resize((ART, ART), Image.BOX)
        q = small.quantize(colors=PALETTE, method=Image.MEDIANCUT, dither=Image.NONE)
        return q.convert("RGB").resize((size, size), Image.NEAREST)
    # photo：先缩到一半，再两倍最近邻放大；可选再量化一下颜色压体积
    inner = max(8, size // 2) if HALF else size
    img = SQUARE.resize((inner, inner), Image.LANCZOS)
    if PHOTO_COLORS > 0:
        img = img.quantize(colors=PHOTO_COLORS, method=Image.MEDIANCUT, dither=Image.NONE).convert("RGB")
    if inner != size:
        img = img.resize((size, size), Image.NEAREST)
    return img


def rounded_mask(size, radius):
    """圆角矩形蒙版（老版本 Pillow 没有 rounded_rectangle，手画）。"""
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    r = max(1, radius)
    d.rectangle((r, 0, size - r - 1, size - 1), fill=255)
    d.rectangle((0, r, size - 1, size - r - 1), fill=255)
    for cx, cy in ((r, r), (size - r - 1, r), (r, size - r - 1), (size - r - 1, size - r - 1)):
        d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=255)
    return m


def save(img, path):
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    data = buf.getvalue()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)
    return len(data)


def main():
    print("style=%s bg=#%02X%02X%02X" % (STYLE, BG[0], BG[1], BG[2]))

    total = 0
    for name, (legacy, canvas) in DENSITIES.items():
        out_dir = os.path.join(RES, "mipmap-" + name)

        # 旧版方形图标：照片铺满 + 圆角
        icon = art_at(legacy).convert("RGBA")
        icon.putalpha(rounded_mask(legacy, max(2, legacy // 5)))
        total += save(icon, os.path.join(out_dir, "ic_launcher.png"))

        # 自适应前景：透明画布，内容占中间约 2/3（安全区）
        inner = int(canvas * 0.667)
        fg = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
        fg.paste(art_at(inner).convert("RGBA"), ((canvas - inner) // 2, (canvas - inner) // 2))
        total += save(fg, os.path.join(out_dir, "ic_launcher_foreground.png"))

        stale = os.path.join(out_dir, "ic_launcher_background.png")
        if os.path.exists(stale):
            os.remove(stale)

    xml = os.path.join(RES, "mipmap-anydpi-v26", "ic_launcher.xml")
    os.makedirs(os.path.dirname(xml), exist_ok=True)
    with io.open(xml, "w", encoding="utf-8", newline="\n") as f:
        f.write(
            '<?xml version="1.0" encoding="utf-8"?>\n'
            '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
            '    <background android:drawable="@color/ic_launcher_bg" />\n'
            '    <foreground android:drawable="@mipmap/ic_launcher_foreground" />\n'
            "</adaptive-icon>\n"
        )

    colors = os.path.join(RES, "values", "colors.xml")
    with io.open(colors, encoding="utf-8") as f:
        text = f.read()
    value = "#%02X%02X%02X" % BG
    if "ic_launcher_bg" in text:
        text = re.sub(r'(<color name="ic_launcher_bg">).*?(</color>)', r"\g<1>" + value + r"\g<2>", text)
    else:
        text = text.replace("</resources>", '    <color name="ic_launcher_bg">' + value + "</color>\n</resources>")
    with io.open(colors, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)

    print("icons total %d bytes (%.1f KB)" % (total, total / 1024.0))

    # 预览：旧版图标 + 自适应合成
    prev = Image.new("RGBA", (192 + 192 + 24, 192), (21, 22, 26, 255))
    prev.paste(Image.open(os.path.join(RES, "mipmap-xxxhdpi", "ic_launcher.png")), (0, 0))
    fg = Image.open(os.path.join(RES, "mipmap-xxxhdpi", "ic_launcher_foreground.png")).resize((192, 192), Image.NEAREST)
    tile = Image.new("RGBA", (192, 192), BG + (255,))
    tile.paste(fg, (0, 0), fg)
    prev.paste(tile, (216, 0))
    out = os.path.join(HERE, "icon-preview.png")
    prev.save(out)
    print("preview:", out)


if __name__ == "__main__":
    main()
