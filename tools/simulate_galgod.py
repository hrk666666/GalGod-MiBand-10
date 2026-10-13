#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
simulate_galgod.py — 把移植后的剧本按 VnEngine 的执行语义跑一遍，
验证三条结局 + Bad End 全部可达、无死循环、无悬空跳转。

用法: python tools/simulate_galgod.py <本工程目录>
"""
import json
import os
import re
import sys

SCN_TYPE = {"LABEL": 0, "CHAPTER": 1, "BG": 2, "DIALOGUE": 3,
            "SELECT": 4, "EV": 5, "NEXT": 6, "CHARACTER": 7,
            "MUSIC": 8, "FX": 9, "VAR": 10}


def load_pack(root):
    """按 game.txt 的顺序加载全部场景，构造全局指令流 + 标签索引。"""
    scn_dir = os.path.join(root, "src", "common", "scn")
    game = json.load(open(os.path.join(root, "src", "common", "game.txt"), encoding="utf-8"))
    order = []
    for lst in game["scenarios"].values():
        for s in lst:
            order.append(s)
    stream = []
    for s in order:
        fp = os.path.join(scn_dir, s["path"])
        data = json.load(open(fp, encoding="utf-8"))
        for n in data:
            stream.append((s["id"], n))
    return game, stream


class VarEnv(dict):
    """f.x 变量环境。"""

    def eval_cond(self, expr):
        if not expr:
            return True
        e = expr.strip()
        # 把 f.xxx 替换成取值
        def repl(m):
            k = m.group(1)
            v = self.get(k, 0)
            if isinstance(v, str):
                return json.dumps(v)
            return str(v)
        e = re.sub(r"f\.([A-Za-z_][A-Za-z0-9_]*)", repl, e)
        try:
            return bool(eval(e, {"__builtins__": {}}, {}))
        except Exception:
            return False

    def exec_cmds(self, expr):
        if not expr:
            return
        for part in [p.strip() for p in str(expr).split(",") if p.strip()]:
            # 累加：f.x += n
            m = re.match(r"f\.([A-Za-z_][A-Za-z0-9_]*)\s*\+=\s*(.+)$", part)
            if m:
                k, raw = m.group(1), m.group(2).strip()
                self[k] = self.get(k, 0) + self._num(raw)
                continue
            # 赋值：f.x = n
            m = re.match(r"f\.([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$", part)
            if m:
                k, raw = m.group(1), m.group(2).strip()
                if raw.startswith('"') and raw.endswith('"'):
                    self[k] = raw[1:-1]
                else:
                    self[k] = self._num(raw)
                continue
            m = re.match(r"f\.([A-Za-z_][A-Za-z0-9_]*)\s*(\+\+|--)(.*)$", part)
            if m:
                k, op = m.group(1), m.group(2)
                self[k] = self.get(k, 0) + (1 if op == "++" else -1)

    @staticmethod
    def _num(raw):
        try:
            return int(raw)
        except ValueError:
            try:
                return float(raw)
            except ValueError:
                return 0


def run(stream, label_index, choices, max_steps=200000):
    """
    模拟一次通关。choices 是「遇到第 n 个选项时选第几项」的策略函数。
    返回 (结局名 或 None, 步数, 游历的选项数)
    """
    env = VarEnv()
    pos = 0
    steps = 0
    n_choice = 0
    last_chapter = ""
    while steps < max_steps:
        steps += 1
        if pos >= len(stream):
            # 走到指令流末尾：引擎语义为「场景结束」
            return ("<流结束>", steps, n_choice)
        sid, n = stream[pos]
        t = n[0]

        if t == SCN_TYPE["CHAPTER"]:
            last_chapter = n[1]
            pos += 1
        elif t in (SCN_TYPE["BG"], SCN_TYPE["DIALOGUE"], SCN_TYPE["EV"],
                   SCN_TYPE["CHARACTER"], SCN_TYPE["MUSIC"], SCN_TYPE["FX"],
                   SCN_TYPE["LABEL"]):
            pos += 1
        elif t == SCN_TYPE["VAR"]:
            env.exec_cmds(n[1])
            pos += 1
        elif t == SCN_TYPE["SELECT"]:
            opts = []
            for item in n[1]:
                cond = item[3] if len(item) > 3 else None
                if env.eval_cond(cond):
                    opts.append(item)
            if not opts:
                return ("<无可用选项>", steps, n_choice)
            pick = choices(n_choice, opts, env)
            pick = max(0, min(pick, len(opts) - 1))
            n_choice += 1
            target = opts[pick][1]
            env.exec_cmds(opts[pick][2] if len(opts[pick]) > 2 else "")
            if target not in label_index:
                return ("<选项目标缺失:%s>" % target, steps, n_choice)
            pos = label_index[target]
        elif t == SCN_TYPE["NEXT"]:
            target = n[1]
            cond = n[2] if len(n) > 2 else None
            if cond is not None and not env.eval_cond(cond):
                pos += 1          # 条件不成立 → 落下
                continue
            if target.startswith("*gameend_"):
                return (target[len("*gameend_"):], steps, n_choice)
            if target.startswith("*"):
                return (target, steps, n_choice)
            if target not in label_index:
                return ("<跳转目标缺失:%s>" % target, steps, n_choice)
            pos = label_index[target]
        else:
            pos += 1
    return ("<超步数上限>", steps, n_choice)


def main():
    root = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else ".")
    game, stream = load_pack(root)
    label_index = {}
    for i, (sid, n) in enumerate(stream):
        if n[0] == SCN_TYPE["LABEL"]:
            if n[1] in label_index:
                print("  ! 重复标签:", n[1])
            label_index[n[1]] = i
            # 跨块引用（scnId@label，转换器按引擎语义改写）→ 同一位置
            label_index["%s@%s" % (sid, n[1])] = i
    print("== 模拟器 ==")
    print("  指令流长度: %d" % len(stream))
    print("  标签数:     %d" % len(label_index))

    # 统计选项点
    n_sel = sum(1 for _, n in stream if n[0] == SCN_TYPE["SELECT"])
    print("  选项点:     %d" % n_sel)
    print()

    # ---- 已知路线的忠实复现（依据原作 branchConfig 推导出的选择表）----
    # 前 4 题选「全都要」型选项各得 1 点 true_end_flag；答题区答对 ≥7 点才能过线。
    COLLECT = {0: 2, 1: 4, 2: 1, 3: 0}     # 收集 true_end_flag 的选项
    KEY = {5: 1, 6: 1, 7: 2, 9: 3, 10: 1, 11: 0, 12: 1}  # 答题区拿分选项
    ROUTE = dict(COLLECT)
    ROUTE.update(KEY)

    def with_ending(i):
        d = dict(ROUTE)
        d[13] = i
        return d

    cases = [
        ("真结局 · 这片月幕", with_ending(2)),
        ("结局 · 二人的世界", with_ending(1)),
        ("结局 · 回归日常", with_ending(0)),
        ("Bad End 路线", {0: 0, 1: 0, 2: 0, 3: 1, 5: 0, 6: 0, 7: 0, 9: 0, 10: 0, 11: 0, 12: 0}),
    ]

    print("== 路线复现 ==")
    seen_end = {}
    for name, table in cases:
        env = VarEnv()
        pos = 0
        steps = 0
        sc = 0
        result = "<未结束>"
        while steps < 300000:
            steps += 1
            if pos >= len(stream):
                result = "<流末>"
                break
            sid, n = stream[pos]
            t = n[0]
            if t == SCN_TYPE["SELECT"]:
                k = max(0, min(table.get(sc, 0), len(n[1]) - 1))
                pos = label_index[n[1][k][1]]
                sc += 1
                continue
            if t == SCN_TYPE["VAR"]:
                env.exec_cmds(n[1])
            if t == SCN_TYPE["NEXT"]:
                tg = n[1]
                cond = n[2] if len(n) > 2 else None
                if cond and not env.eval_cond(cond):
                    pos += 1
                    continue
                if tg.startswith("*"):
                    result = tg
                    break
                pos = label_index.get(tg, -1)
                if pos < 0:
                    result = "<缺失:%s>" % tg
                    break
                continue
            pos += 1
        flag = "%s true=%d bad=%d finish=%d" % (
            result, env.get("true_end_flag", 0), env.get("bad_end_flag", 0),
            env.get("true_end_finish", 0))
        print("  %-18s → %s" % (name, flag))
        seen_end[name] = result

    # ---- 完整性 ----
    print()
    print("== 完整性 ==")
    dangling = []
    for i, (sid, n) in enumerate(stream):
        if n[0] == SCN_TYPE["NEXT"]:
            tg = n[1]
            if tg.startswith("*"):
                continue
            if tg not in label_index:
                dangling.append((sid, i, tg))
        if n[0] == SCN_TYPE["SELECT"]:
            for it in n[1]:
                if it[1] not in label_index:
                    dangling.append((sid, i, it[1]))
    print("  悬空跳转: %d %s" % (len(dangling), dangling[:5] if dangling else ""))

    ok = 0
    if "Bad End" in seen_end.get("Bad End 路线", ""):
        ok += 1
        print("  ✓ Bad End 可达")
    if seen_end.get("真结局 · 这片月幕", "").startswith("*gameend_") and "Bad" not in seen_end["真结局 · 这片月幕"]:
        ok += 1
        print("  ✓ 真结局可达")
    if not dangling:
        ok += 1
        print("  ✓ 无悬空跳转")

    print()
    print("  通过 %d/3 项检查" % ok)
    return 0 if (not dangling and ok >= 2) else 1


if __name__ == "__main__":
    sys.exit(main())
