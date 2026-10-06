#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
convert_galgod.py — 把 GalGod 手环版剧本（索引 + 分块 JSON 对象节点）
转换成 VnEngine v1.1 剧本格式（[类型码, ...] 数组节点）。

用法:
    python tools/convert_galgod.py <GalGod工程目录> <本工程目录>

源格式（GalGod 2.4）:
    src/common/story/index.txt     章节表 + 分块表（JSON）
    src/common/story/chunk-NNN.txt 每块 128 个节点
    src/common/assets.js           图片索引表（下标 → 路径）

源节点类型:
    {"t":"s",  "n":说话人, "x":文本, "bg":下标, "cg":下标, "cs":[{k,i,s}], "tint":...}
    {"t":"o",  "o":[{x:文字, j:目标下标, c:[变量,op,值]|null}, ...]}
    {"t":"j",  "j":目标下标}
    {"t":"f",  "v":变量名, "n":值}
    {"t":"cj", "v":变量名, "op":比较符, "n":值, "j":目标下标}
    {"t":"e",  "x":结局名, "bg":下标}
    {"t":"sf", "v":开关名, "n":0|1}

目标格式（VnEngine v1.1）:
    [0,"label"] [1,"章节标题"] [2,"背景名"] [3,"说话人","文本",[立绘]]
    [4,[["文字","目标","表达式","条件"]]] [5,"ev图名"] [6,"目标"] [10,"指令"]

关键设计: GalGod 用「全局绝对下标」跳转，VnEngine 用「标签名」跳转。
本转换器为每个被跳转的下标生成唯一标签 L<下标>，并在每个源节点的位置
插入对应的 [0,"L<下标>"] 标签节点，从而把下标跳转翻译成标签跳转。
"""

import json
import os
import re
import sys
from collections import OrderedDict

# ---------------------------------------------------------------- 常量

# 源节点里表示「黑屏」的哨兵值
BG_BLACK = -1

# 分块命名
CHUNK_PREFIX = "chunk-"
CHUNK_DIGITS = 3

# 输出场景块每个文件的节点数上限（与目标引擎的 chunk 习惯保持一致）
OUT_CHUNK_NODES = 500


def log(msg):
    print(msg, flush=True)


# ---------------------------------------------------------------- 读取源工程

def load_img_index(src_root):
    """从 assets.js 里解析出图片下标 → 资源路径 的列表。"""
    p = os.path.join(src_root, "src", "common", "assets.js")
    if not os.path.exists(p):
        raise SystemExit("找不到 assets.js: %s" % p)
    text = open(p, encoding="utf-8").read()
    paths = re.findall(r'"(/common/img/[^"]+)"', text)
    if not paths:
        raise SystemExit("assets.js 里没解析出图片路径")
    return paths


def load_gallery(src_root):
    """从 cglist.js 里解析 CG 鉴赏分组（可选）。"""
    p = os.path.join(src_root, "src", "common", "cglist.js")
    if not os.path.exists(p):
        return []
    text = open(p, encoding="utf-8").read()
    m = re.search(r"CGG\s*=\s*(\[.*\])\s*;?\s*$", text.strip(), re.S)
    if not m:
        return []
    try:
        return json.loads(m.group(1))
    except Exception:
        return []


def load_story(src_root):
    """加载 index.txt 与全部 chunk，返回 (index, 全局节点数组, 全局→块局部映射)。"""
    story_dir = os.path.join(src_root, "src", "common", "story")
    idx_path = os.path.join(story_dir, "index.txt")
    if not os.path.exists(idx_path):
        raise SystemExit("找不到 index.txt: %s" % idx_path)
    index = json.load(open(idx_path, encoding="utf-8"))

    nodes = []
    src_index_of = []  # 每个全局节点在源里的全局下标（本工程按 chunks 顺序拼装，通常一致）
    for ch in index["chunks"]:
        fn = os.path.basename(ch["file"])
        fp = os.path.join(story_dir, fn)
        if not os.path.exists(fp):
            raise SystemExit("缺分块文件: %s" % fp)
        data = json.load(open(fp, encoding="utf-8"))
        if len(data) != ch["count"]:
            log("  ! 分块 %s 节点数 %d 与 index 声明 %d 不一致" % (fn, len(data), ch["count"]))
        nodes.extend(data)
        for i in range(len(data)):
            src_index_of.append(ch["start"] + i)

    if len(nodes) != index["nodeCount"]:
        log("  ! 总节点数 %d 与 index 声明 %d 不一致" % (len(nodes), index["nodeCount"]))
    return index, nodes, src_index_of


# ---------------------------------------------------------------- 资源名映射

def build_asset_maps(img_index):
    """
    把 /common/img/<子目录>/<名>.png 映射成 VnEngine 的资源名。

    目标引擎约定：
        背景 → src/common/bg/<名>.jpg   （引用名为 <名>）
        立绘 → src/common/ch/<名>.png   （引用名为 <名>，透明）
        EV   → src/common/ev/<名>.jpg   （引用名为 <名>）
        SD   → src/common/sd/<名>.jpg   （引用名为 <名>）

    返回 (下标→(类别, 资源名), 需要写出的资源清单)
    """
    mapping = {}
    assets = []  # (类别, 资源名, 源相对路径)

    for i, path in enumerate(img_index):
        parts = path.strip("/").split("/")   # common/img/b/xxx.png
        if len(parts) < 4:
            continue
        sub = parts[2]
        fname = parts[3]
        stem = os.path.splitext(fname)[0]

        if sub == "b":
            kind, name = "bg", stem
        elif sub == "s":
            # 立绘原名是纯数字（000/001），加前缀避免与其他资源撞名
            kind, name = "ch", "sp_" + stem
        elif sub == "c":
            # CG 与 SD 混在同一目录，按文件名前缀区分
            if stem.startswith("cg_"):
                kind, name = "ev", stem
            else:
                kind, name = "sd", stem
        elif sub == "t":
            kind, name = "thumb", stem
        else:
            continue

        mapping[i] = (kind, name)
        assets.append((kind, name, "src/common/img/%s/%s" % (sub, fname)))

    return mapping, assets


# ---------------------------------------------------------------- 跳转目标收集

def collect_targets(nodes):
    """扫描全部节点，收集被跳转到的全局下标集合。"""
    targets = set()
    for n in nodes:
        t = n.get("t")
        if t == "j":
            targets.add(n["j"])
        elif t == "cj":
            targets.add(n["j"])
        elif t == "o":
            for o in n.get("o", []):
                targets.add(o["j"])
    return targets


def collect_story_flags(nodes):
    """
    区分「剧情变量」与「纯 UI 开关」。

    GalGod 的 sf 节点语义是赋值：flags[v] = n。
    其中 quick_menu / custom_ui 只是控制界面显隐的开关，移植后无对应语义，丢弃；
    而像 true_end_finish 这种被 cj（条件跳转）引用到的，是真正的剧情变量，
    必须转成 VnEngine 的变量节点，否则后日谈解锁条件永远不成立。
    """
    referenced = set()
    for n in nodes:
        if n.get("t") == "cj":
            referenced.add(n.get("v"))
        elif n.get("t") == "f":
            referenced.add(n.get("v"))
    story = set()
    for n in nodes:
        if n.get("t") == "sf" and n.get("v") in referenced:
            story.add(n.get("v"))
    return story


def resolve_chain(nodes, start, targets):
    """
    若 start 指向的是一个纯跳转节点（j）或变量节点（f）——即没有对话内容的节点，
    就沿链继续走，直到落到一个有内容的位置。

    返回 (落点下标, 途中的 j/f 节点列表)
    注意：只沿「唯一后继」推进。cj 有两条分支，不作为链节点穿透。
    """
    chain = []
    cur = start
    guard = 0
    while 0 <= cur < len(nodes) and guard < 64:
        guard += 1
        n = nodes[cur]
        t = n.get("t")
        # 只有 j 是「无条件唯一后继」，且它自身不产出任何可见内容
        if t == "j":
            chain.append(cur)
            cur = n["j"]
            continue
        break
    return cur, chain


# ---------------------------------------------------------------- 表达式翻译

OP_MAP = {
    "==": "==", "!=": "!=", ">": ">", "<": "<", ">=": ">=", "<=": "<=",
}


def cond_expr(var, op, value):
    """把 GalGod 的 (变量, 比较符, 值) 翻成 VnEngine 条件表达式 f.<var> <op> <value>。"""
    o = OP_MAP.get(op, "==")
    if isinstance(value, str):
        return 'f.%s %s "%s"' % (var, o, value)
    return "f.%s %s %s" % (var, o, value)


def set_expr(var, value):
    """
    把 GalGod 的 f 节点翻成 VnEngine 变量指令。

    重要：GalGod 的 f 语义是「累加」而非赋值——
        game.ux: if (node.t === 'f') { this.flags[node.v] = (this.flags[node.v]||0) + node.n }
    因此必须翻成 += ，翻成 = 会让多次计分互相覆盖（答题计分全部丢失）。
    """
    if isinstance(value, str):
        return 'f.%s = "%s"' % (var, value)
    if isinstance(value, bool):
        return "f.%s = %d" % (var, 1 if value else 0)
    if isinstance(value, (int, float)):
        if value == 0:
            return "f.%s = 0" % var
        return "f.%s += %s" % (var, value)
    return 'f.%s = "%s"' % (var, value)


# ---------------------------------------------------------------- 主转换

def convert(src_root, dst_root):
    log("== GalGod → VnEngine 剧本转换 ==")
    img_index = load_img_index(src_root)
    index, nodes, src_index_of = load_story(src_root)
    log("  源节点: %d，分块: %d，图片索引: %d" % (len(nodes), len(index["chunks"]), len(img_index)))

    asset_map, assets = build_asset_maps(img_index)
    targets = collect_targets(nodes)
    story_flags = collect_story_flags(nodes)
    log("  被跳转的下标: %d 个" % len(targets))
    log("  剧情变量(sf): %s" % (sorted(story_flags) or "无"))

    # ---------- 1. 决定每个源节点落在哪个输出场景块 ----------
    # 章节起点 + 每 OUT_CHUNK_NODES 个节点切一刀，二者取并集作为切点。
    chapter_starts = sorted({c["start"] for c in index["chapters"]})
    cuts = set(chapter_starts)
    for s in range(0, len(nodes), OUT_CHUNK_NODES):
        cuts.add(s)
    cuts = sorted(cuts)

    # 建立 全局下标 → 输出块号
    block_of = [0] * len(nodes)
    for bi, start in enumerate(cuts):
        end = cuts[bi + 1] if bi + 1 < len(cuts) else len(nodes)
        for i in range(start, end):
            block_of[i] = bi
    n_blocks = len(cuts)
    log("  输出场景块: %d 个（含章节边界）" % n_blocks)

    # ---------- 2. 生成标签名 ----------
    # 每个被跳转的目标都要有一个标签。标签名用 L<下标>，保证唯一且可读。
    label_of = {t: "L%d" % t for t in targets}

    # 章节名映射（用于插入 [1,"章节标题"]）
    chapter_at = {}
    for c in index["chapters"]:
        chapter_at.setdefault(c["start"], []).append(c["title"])

    # ---------- 3. 逐节点翻译 ----------
    blocks = [[] for _ in range(n_blocks)]      # 输出节点
    stats = {"dialogue": 0, "bg": 0, "cg": 0, "choice": 0,
             "jump": 0, "var": 0, "end": 0, "sf_skipped": 0, "sf_as_var": 0,
             "tint_skipped": 0}
    missing_assets = []

    def resolve_asset(idx, kind_want):
        """把资源下标翻成引擎引用名；返回 None 表示无/黑屏。"""
        if idx is None or idx == BG_BLACK:
            return None
        if idx < 0:
            return None
        if idx not in asset_map:
            missing_assets.append((idx, kind_want))
            return None
        kind, name = asset_map[idx]
        return name

    for gi, n in enumerate(nodes):
        bi = block_of[gi]
        out = blocks[bi]
        t = n.get("t")

        # 章节标题节点（在源章节起点前插入）
        if gi in chapter_at:
            for title in chapter_at[gi]:
                out.append([1, title])

        # 该位置若是跳转目标，先放标签
        if gi in label_of:
            out.append([0, label_of[gi]])

        if t == "s":
            # 背景切换
            if "bg" in n:
                bname = resolve_asset(n.get("bg"), "bg")
                if bname is not None:
                    out.append([2, bname])
                    stats["bg"] += 1
            # 事件 CG
            if "cg" in n:
                cname = resolve_asset(n.get("cg"), "ev")
                if cname is not None:
                    out.append([5, cname])
                    stats["cg"] += 1
            # 立绘列表
            charlist = []
            for c in n.get("cs", []) or []:
                cname = resolve_asset(c.get("i"), "ch")
                if cname is None:
                    continue
                pos = c.get("s") or "center"
                charlist.append([cname, pos, "change"])
            # 对话
            speaker = n.get("n") or ""
            text = n.get("x") or ""
            node3 = [3, speaker, text]
            if charlist:
                node3.append(charlist)
            out.append(node3)
            stats["dialogue"] += 1
            if "tint" in n:
                stats["tint_skipped"] += 1

        elif t == "o":
            opts = []
            for o in n.get("o", []):
                text = o.get("x") or ""
                tgt, _chain = resolve_chain(nodes, o["j"], targets)
                # 目标标签：优先用链落点，但必须保证那个下标有标签
                tlabel = label_of.get(tgt) or label_of.get(o["j"])
                if tlabel is None:
                    # 该目标没被登记（理论上不会发生），补一个落点标签
                    tlabel = "L%d" % o["j"]
                    label_of[o["j"]] = tlabel
                item = [text, tlabel, ""]
                c = o.get("c")
                if isinstance(c, list) and len(c) >= 3:
                    item.append(cond_expr(c[0], c[1], c[2]))
                opts.append(item)
            out.append([4, opts])
            stats["choice"] += 1

        elif t == "j":
            tgt = n["j"]
            tlabel = label_of.get(tgt)
            if tlabel is None:
                tlabel = "L%d" % tgt
                label_of[tgt] = tlabel
            out.append([6, tlabel])
            stats["jump"] += 1

        elif t == "cj":
            # 条件跳转 → 用两条「带条件的 NEXT」表达：条件成立跳目标，
            # 否则落下继续执行。VnEngine 的 NEXT 支持 node[2] 条件。
            tgt = n["j"]
            tlabel = label_of.get(tgt)
            if tlabel is None:
                tlabel = "L%d" % tgt
                label_of[tgt] = tlabel
            out.append([6, tlabel, cond_expr(n.get("v"), n.get("op", "=="), n.get("n"))])
            stats["jump"] += 1

        elif t == "f":
            out.append([10, set_expr(n.get("v"), n.get("n"))])
            stats["var"] += 1

        elif t == "e":
            # 结局 → 引擎的结局跳转约定 *gameend_<名>
            name = (n.get("x") or "END").strip()
            out.append([6, "*gameend_" + name])
            stats["end"] += 1

        elif t == "sf":
            # sf 语义是「赋值」flags[v] = n。
            # 被剧情引用的（true_end_finish）→ 转成变量赋值节点；
            # 纯 UI 开关（quick_menu / custom_ui）→ 丢弃。
            if n.get("v") in story_flags:
                out.append([10, "f.%s = %s" % (n.get("v"), n.get("n", 0))])
                stats["var"] += 1
                stats["sf_as_var"] += 1
            else:
                stats["sf_skipped"] += 1

        else:
            log("  ! 未知节点类型 %r 于全局下标 %d，已跳过" % (t, gi))

    # ---------- 4. 写剧本文件 ----------
    scn_dir = os.path.join(dst_root, "src", "common", "scn")
    os.makedirs(scn_dir, exist_ok=True)
    # 清掉旧的 chunk
    for f in os.listdir(scn_dir):
        if re.match(r"chunk\d+\.txt$", f):
            os.remove(os.path.join(scn_dir, f))

    scenarios = []
    for bi, blk in enumerate(blocks):
        sid = "%03d" % (bi + 1)
        fn = "chunk%s.txt" % sid
        fp = os.path.join(scn_dir, fn)
        with open(fp, "w", encoding="utf-8") as fh:
            json.dump(blk, fh, ensure_ascii=False, separators=(",", ":"))
        scenarios.append({"id": sid, "path": fn})

    log("  已写出 %d 个剧本块" % len(scenarios))

    # ---------- 5. 写图片清单（供资源复制脚本使用） ----------
    manifest = {
        "blocks": [{"id": s["id"], "path": s["path"], "nodes": len(b)} for s, b in zip(scenarios, blocks)],
        "assets": [{"kind": k, "name": nm, "src": sp} for (k, nm, sp) in assets],
        "stats": stats,
        "missing_assets": missing_assets,
        "chapters": index["chapters"],
        "gallery": load_gallery(src_root),
    }
    os.makedirs(os.path.join(dst_root, "tools"), exist_ok=True)
    with open(os.path.join(dst_root, "tools", "build_manifest.json"), "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=1)

    # ---------- 6. 报告 ----------
    log("")
    log("== 统计 ==")
    for k, v in stats.items():
        log("  %-14s %d" % (k, v))
    log("  输出节点总数    %d" % sum(len(b) for b in blocks))
    if missing_assets:
        log("  ! 缺失资源引用: %d 处" % len(missing_assets))
    log("")
    log("  图片清单: %d 项（bg %d / ch %d / ev %d / sd %d / thumb %d）" % (
        len(assets),
        sum(1 for a in assets if a[0] == "bg"),
        sum(1 for a in assets if a[0] == "ch"),
        sum(1 for a in assets if a[0] == "ev"),
        sum(1 for a in assets if a[0] == "sd"),
        sum(1 for a in assets if a[0] == "thumb"),
    ))
    log("  清单已写: tools/build_manifest.json")

    return manifest


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        raise SystemExit(1)
    src_root = os.path.abspath(sys.argv[1])
    dst_root = os.path.abspath(sys.argv[2])
    convert(src_root, dst_root)


if __name__ == "__main__":
    main()
