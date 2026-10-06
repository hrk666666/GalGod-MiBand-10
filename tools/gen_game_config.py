#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gen_game_config.py — 依据剧本转换清单生成 VnEngine 的内容包配置 game.txt。

用法: python tools/gen_game_config.py <本工程目录>
读取: tools/build_manifest.json
写出: src/common/game.txt
"""
import json
import os
import sys


def main():
    root = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else ".")
    mf = json.load(open(os.path.join(root, "tools", "build_manifest.json"), encoding="utf-8"))

    scenarios = [{"id": b["id"], "path": b["path"]} for b in mf["blocks"]]

    cfg = {
        "id": "galgod-band",
        "title": "想成为Galgame领域大神！！！",
        "version": "1.0.0",
        "engine": {"format": "vn-1.1", "minRuntime": "1.0"},
        "initialState": {
            "flags": {
                "true_end_flag": 0,
                "bad_end_flag": 0,
                "true_end_finish": 0,
            }
        },
        "resources": {
            "base": "/common",
            "dirs": {"bg": "bg", "sd": "sd", "ev": "ev", "ch": "ch", "audio": "audio"},
        },
        # 本作是「单主线 + 结尾分流」结构：剧本自身用条件跳转完成结局分发，
        # 因此 scenarios.main 按顺序列出全部块即可，不需要额外的 routes 规则。
        "scenarios": {"main": scenarios},
    }

    out = os.path.join(root, "src", "common", "game.txt")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(cfg, fh, ensure_ascii=False, indent=2)

    print("已写出 %s" % out)
    print("  场景块: %d" % len(scenarios))
    print("  初始变量: %s" % ", ".join(cfg["initialState"]["flags"]))


if __name__ == "__main__":
    main()
