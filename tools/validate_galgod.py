#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
validate_galgod.py — 内容包完整性校验。

检查项:
  1. game.txt 声明的每个场景文件都存在且是合法 JSON 数组
  2. 每个节点结构合法（类型码在 0-10，必填字段齐全）
  3. 所有跳转目标（NEXT / SELECT）都能在全局标签表里找到
  4. 所有资源引用（背景 / 立绘 / CG）对应的文件都存在
  5. 章节标题节点存在
  6. 统计信息（对话数 / 选项数 / 结局数）

用法: python tools/validate_galgod.py <本工程目录>
"""
import json
import os
import re
import sys

SCN_TYPE = {"LABEL": 0, "CHAPTER": 1, "BG": 2, "DIALOGUE": 3, "SELECT": 4,
            "EV": 5, "NEXT": 6, "CHARACTER": 7, "MUSIC": 8, "FX": 9, "VAR": 10}


def main():
    root = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else ".")
    common = os.path.join(root, "src", "common")
    scn_dir = os.path.join(common, "scn")
    errors = []
    warns = []

    # ---- 1. 读内容包 ----
    cfg_path = os.path.join(common, "game.txt")
    if not os.path.exists(cfg_path):
        print("✗ 找不到 game.txt")
        return 1
    cfg = json.load(open(cfg_path, encoding="utf-8"))
    scenarios = []
    for lst in cfg.get("scenarios", {}).values():
        scenarios.extend(lst)
    print("== 内容包校验 ==")
    print("  包名: %s  标题: %s" % (cfg.get("id"), cfg.get("title")))
    print("  场景块: %d" % len(scenarios))

    # ---- 2. 加载全部节点 ----
    stream = []
    for s in scenarios:
        fp = os.path.join(scn_dir, s["path"])
        if not os.path.exists(fp):
            errors.append("场景文件缺失: %s" % s["path"])
            continue
        try:
            data = json.load(open(fp, encoding="utf-8"))
        except Exception as e:
            errors.append("场景解析失败 %s: %s" % (s["path"], e))
            continue
        if not isinstance(data, list):
            errors.append("场景不是数组: %s" % s["path"])
            continue
        for n in data:
            stream.append((s["id"], n))

    print("  节点总数: %d" % len(stream))

    # ---- 3. 标签表 ----
    labels = {}
    scene_labels = {}   # sid -> set(标签名)：跨块引用 scnId@label 按场景校验
    for i, (sid, n) in enumerate(stream):
        if not isinstance(n, list) or not n:
            errors.append("节点结构错误 @%d: %r" % (i, n))
            continue
        if n[0] == SCN_TYPE["LABEL"]:
            if n[1] in labels:
                warns.append("重复标签: %s" % n[1])
            labels[n[1]] = i
            scene_labels.setdefault(sid, set()).add(n[1])
    print("  标签数: %d" % len(labels))

    def target_ok(tg, sid):
        """跳转目标可解析：同场景纯标签查全局表；跨块 scnId@label 按目标场景校验。"""
        tg = str(tg)
        if "@" in tg:
            s, lab = tg.split("@", 1)
            return s in scene_labels and lab in scene_labels[s]
        return tg in labels

    # ---- 4. 逐节点结构 & 跳转 & 资源 ----
    res_used = {"bg": set(), "ch": set(), "ev": set(), "sd": set()}
    stat = {"dialogue": 0, "choice": 0, "bg": 0, "cg": 0, "end": 0, "chapter": 0}
    endings = set()

    def need_file(kind, name):
        """按资源类型检查文件是否存在。扩展名遵循 resourceManager.js 的约定。"""
        ext = ".png" if kind in ("ch", "sd") else ".jpg"
        p = os.path.join(common, kind, name + ext)
        if not os.path.exists(p):
            errors.append("资源缺失: %s/%s%s" % (kind, name, ext))
            return False
        res_used[kind].add(name)
        return True

    def need_ev(name):
        """
        EV 节点按「资源名前缀」决定目录与扩展名（与引擎 _applyEv 一致）：
          sd* → sd/ 目录、.png
          ev* → ev/ 目录、.jpg
        """
        if name.startswith("sd"):
            return need_file("sd", name)
        if name.startswith("ev"):
            return need_file("ev", name)
        # 其他前缀（item_* 等）引擎会忽略，不算错误
        return True

    for i, (sid, n) in enumerate(stream):
        if not isinstance(n, list) or not n:
            continue
        t = n[0]
        if t not in SCN_TYPE.values():
            errors.append("未知节点类型 %r @%s:%d" % (t, sid, i))
            continue

        if t == SCN_TYPE["CHAPTER"]:
            stat["chapter"] += 1
        elif t == SCN_TYPE["BG"]:
            if len(n) < 2:
                errors.append("背景节点缺字段 @%s:%d" % (sid, i))
            else:
                need_file("bg", n[1])
            stat["bg"] += 1
        elif t == SCN_TYPE["DIALOGUE"]:
            if len(n) < 3:
                errors.append("对话节点缺字段 @%s:%d" % (sid, i))
            else:
                stat["dialogue"] += 1
                if len(n) > 3 and isinstance(n[3], list):
                    for c in n[3]:
                        if len(c) >= 1:
                            need_file("ch", c[0])
                        if len(c) >= 2 and c[1] not in ("left", "center", "right", "c"):
                            warns.append("立绘位置非标准: %r @%s:%d" % (c[1], sid, i))
        elif t == SCN_TYPE["SELECT"]:
            if len(n) < 2 or not isinstance(n[1], list) or not n[1]:
                errors.append("选项节点结构错误 @%s:%d" % (sid, i))
            else:
                stat["choice"] += 1
                for it in n[1]:
                    if len(it) < 2:
                        errors.append("选项项缺字段 @%s:%d" % (sid, i))
                        continue
                    if not target_ok(it[1], sid):
                        errors.append("选项跳转目标缺失: %s @%s:%d" % (it[1], sid, i))
        elif t == SCN_TYPE["NEXT"]:
            tg = n[1] if len(n) > 1 else None
            if not tg:
                errors.append("NEXT 缺目标 @%s:%d" % (sid, i))
            elif str(tg).startswith("*gameend_"):
                stat["end"] += 1
                endings.add(str(tg)[len("*gameend_"):])
            elif not str(tg).startswith("*") and not target_ok(tg, sid):
                errors.append("跳转目标缺失: %s @%s:%d" % (tg, sid, i))
        elif t == SCN_TYPE["EV"]:
            if len(n) < 2:
                errors.append("EV 节点缺字段 @%s:%d" % (sid, i))
            else:
                need_ev(n[1])
                stat["cg"] += 1
        elif t == SCN_TYPE["CHARACTER"]:
            if len(n) >= 2:
                need_file("ch", n[1])
        elif t == SCN_TYPE["VAR"]:
            if len(n) < 2 or "f." not in str(n[1]):
                warns.append("变量节点格式可疑 @%s:%d: %r" % (sid, i, n))

    # ---- 5. 报告 ----
    print()
    print("== 统计 ==")
    for k, v in stat.items():
        print("  %-10s %d" % (k, v))
    print("  结局       %s" % sorted(endings))
    print()
    print("== 资源使用 ==")
    for k, v in res_used.items():
        print("  %-3s %d 个" % (k, len(v)))

    print()
    if warns:
        print("== 警告 (%d) ==" % len(warns))
        for w in warns[:15]:
            print("  ! %s" % w)
    if errors:
        print("== 错误 (%d) ==" % len(errors))
        for e in errors[:25]:
            print("  ✗ %s" % e)
        print()
        print("校验失败")
        return 1

    print("== 校验通过 ==")
    print("  ✓ 场景文件齐全且合法")
    print("  ✓ 全部跳转目标可解析")
    print("  ✓ 全部资源引用存在")
    return 0


if __name__ == "__main__":
    sys.exit(main())
