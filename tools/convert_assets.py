#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
convert_assets.py — 把 GalGod 的 PNG 资源按 VnEngine 目录约定归类落盘。

用法:
    python tools/convert_assets.py <GalGod工程目录> <本工程目录>

目标约定（见 docs/剧本格式规范v1.1.md 第 5 节 + engine/resourceManager.js）:
    bg  背景   → src/common/bg/<名>.jpg
    ch  立绘   → src/common/ch/<名>.png   （保留透明通道）
    ev  事件CG → src/common/ev/<名>.jpg
    sd  SD 图  → src/common/sd/<名>.png

  注意：引擎按「资源名前缀」决定目录与扩展名——
    以 sd 开头 → sd/ 目录、.png
    以 ev 开头 → ev/ 目录、.jpg
  所以 sd_* 必须存成 PNG，否则运行时找不到文件。

两个关键处理:

1) 背景取景
   GalGod 的背景是 672×480 全景图（比屏幕宽一倍），配套还有 336×480 的
   `_r` 变体（右半幅）。VnEngine 的背景是 width:100%/height:100% 拉伸铺满，
   直接把 672 宽的图塞进去会被横向压扁（672→336 压缩一半，人物严重变形）。
   故：有 `_r` 变体就用 `_r`（已是屏幕尺寸、构图正确）；
       没有 `_r` 的，从 672 宽图居中裁出 336×480。

2) CG 取景
   GalGod 的 CG/SD 是 854×480 全宽图，同样是「宽于屏幕」。
   裁成 336×480（居中）后正好铺满，也不变形。

立绘与 SD 图必须保持 PNG，否则透明通道/格式约定不一致。
"""
import json
import os
import shutil
import sys

try:
    from PIL import Image
except ImportError:
    Image = None

SCREEN_W, SCREEN_H = 336, 480


def ensure_dirs(root):
    for d in ("bg", "ch", "ev", "sd"):
        os.makedirs(os.path.join(root, "src", "common", d), exist_ok=True)


def center_crop(im, w, h):
    """从图中居中裁出 w×h（若原图更小则先放大到至少 w×h）。"""
    iw, ih = im.size
    if iw < w or ih < h:
        scale = max(w / iw, h / ih)
        im = im.resize((max(w, int(iw * scale)), max(h, int(ih * scale))), Image.LANCZOS)
        iw, ih = im.size
    left = (iw - w) // 2
    top = (ih - h) // 2
    return im.crop((left, top, left + w, top + h))


def convert_one(src, dst, kind):
    """
    按类别落盘。
    立绘（ch）与 SD 图（sd）保持 PNG；背景（bg）与事件 CG（ev）转 JPEG 并
    裁到屏幕尺寸（避免被 CSS 拉伸变形）。
    """
    if kind in ("ch", "sd"):
        if Image is None:
            shutil.copyfile(src, dst)
            return os.path.getsize(dst)
        im = Image.open(src)
        if kind == "ch":
            # 立绘：保留透明通道，直接存 PNG
            im.save(dst, "PNG", optimize=True)
            return os.path.getsize(dst)
        # SD 图：全屏不透明，裁到屏幕尺寸后存 PNG
        if im.mode in ("RGBA", "LA", "P", "PA"):
            rgba = im.convert("RGBA")
            flat = Image.new("RGB", rgba.size, (0, 0, 0))
            flat.paste(rgba, mask=rgba.split()[-1])
            im = flat
        else:
            im = im.convert("RGB")
        im = center_crop(im, SCREEN_W, SCREEN_H)
        im.save(dst, "PNG", optimize=True)
        return os.path.getsize(dst)

    if Image is None:
        shutil.copyfile(src, dst)
        return os.path.getsize(dst)
    im = Image.open(src)
    if im.mode in ("RGBA", "LA", "P", "PA"):
        rgba = im.convert("RGBA")
        flat = Image.new("RGB", rgba.size, (0, 0, 0))
        flat.paste(rgba, mask=rgba.split()[-1])
        im = flat
    else:
        im = im.convert("RGB")
    # 裁到屏幕比例，避免被 CSS 拉伸变形
    im = center_crop(im, SCREEN_W, SCREEN_H)
    im.save(dst, "JPEG", quality=86, optimize=True, progressive=False)
    return os.path.getsize(dst)


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        raise SystemExit(1)
    src_root = os.path.abspath(sys.argv[1])
    dst_root = os.path.abspath(sys.argv[2])
    mf_path = os.path.join(dst_root, "tools", "build_manifest.json")
    mf = json.load(open(mf_path, encoding="utf-8"))

    ensure_dirs(dst_root)

    ext_of = {"bg": ".jpg", "ch": ".png", "ev": ".jpg", "sd": ".png"}
    stat = {"bg": 0, "ch": 0, "ev": 0, "sd": 0}
    total_in = 0
    total_out = 0
    missing = []
    used_r = 0

    for a in mf["assets"]:
        kind, name = a["kind"], a["name"]
        if kind not in ext_of:
            continue          # thumb 之类跳过
        src = os.path.join(src_root, a["src"])

        # 背景优先用 _r 变体（已是 336×480 的正确取景）
        if kind == "bg":
            base, ext = os.path.splitext(src)
            cand = base + "_r" + ext
            if os.path.exists(cand):
                src = cand
                used_r += 1

        if not os.path.exists(src):
            missing.append(a["src"])
            continue
        dst = os.path.join(dst_root, "src", "common", kind, name + ext_of[kind])
        total_in += os.path.getsize(src)
        total_out += convert_one(src, dst, kind)
        stat[kind] += 1

    print("== 资源转换 ==")
    for k, v in stat.items():
        print("  %-4s %d 个" % (k, v))
    print("  合计 %d 个（背景用 _r 变体 %d 个）" % (sum(stat.values()), used_r))
    print("  体积 %.2f MB → %.2f MB" % (total_in / 1048576, total_out / 1048576))
    if missing:
        print("  ! 缺源文件 %d: %s" % (len(missing), missing[:5]))


if __name__ == "__main__":
    main()
