# 《想成为Galgame领域大神！！！》· 小米手环胶囊屏移植版

把 PC 版 galgame **《想成为Galgame领域大神！！！》**（作者「诺提拉观察所」）移植成能在
**小米手环 9 / 10 / 11（胶囊屏）** 上跑的 **Vela 快应用**。

- **上游内容**：[mcpotato1123/galgod-band](https://github.com/mcpotato1123/galgod-band)
- **引擎与 UI**：[hrk666666/Senren-Banka-MiBand-10](https://github.com/hrk666666/Senren-Banka-MiBand-10) 的 VnEngine（协议 vn-1.1）
- **包名**：`com.hrk.galgod.band`

```
剧本数据  5,826 个节点 / 18 章 / 29 个分块
对话      5,457 句（全量，非删减）
美术      背景 37 / 立绘 53 / 事件 CG 15 / SD 图 19
分支      15 个选择点，13 题答题区，真结局 + Bad End
页面      5 个：主页 / 正文 / 存档 / 设置 / 关于
协议      代码 GPL-3.0（见 LICENSE）；剧本与美术资源不在授权范围内（见 NOTICE.md）
```

> **免责声明**：本项目是非官方的个人移植，仅供学习交流。
> 剧本文字与全部美术资源（背景 / 立绘 / CG）版权归 **GalGod** 原开发商「诺提拉观察所」所有。
> 本仓库出于「可运行」的需要收录了转码后的资源，请勿用于任何商业用途。详见 [NOTICE.md](NOTICE.md)。

---

## 故事梗概

> 以下为原作设定简介。

在一个由「天选试」决定一切的世界里——国家每三年举办一次天选试，一次录取一千人，
考核内容**全部是美少女游戏（Galgame）**。通过者握有制定规则、影响国运的权力。

> 万般皆下品，惟有旮旯高。
> 一个亿万富翁，在一个 20 来岁、擅长 Galgame 的「天选之子」面前，也会自觉矮上一头。

玩家需要通过共通线剧情，在答题区中取得足够分数，最终走向不同的结局。

---

## 玩法与结局

本作是**单主线 + 结尾分流**结构：

1. **主线剧情**（第一幕 ～ 第三幕，18 章，约 4,800 个节点）：线性推进，途中 15 个选择点影响 `true_end_flag`。
2. **答题区**（13 道题）：每题选错会 `bad_end_flag += 1`。
3. **结局分流**（节点 4318 处判定）：
   - `bad_end_flag >= 7`（错 7 题及以上）→ **Bad End · 未能触碰的世界**（`gameend_Bad End · 未能触碰的世界`）
   - 否则进入最终章，13 题全对则 `bad_end_flag = 0`，走向 **真结局 · —— 全剧终 ——**（`gameend_—— 全剧终 ——`）

结局通过 `END_LINE_NAMES` 记录到清关列表（存储键 `galgod_clears`）。
通关真结局（记录 `"全剧终"`）后，主页的「后日谈」入口解锁，
经 `loadByLabel("L5158")` 直接跳入后日谈章节。

---

## 目录结构

```
src/
  engine/           VnEngine 引擎（与上游完全解耦的内容包驱动设计）
  common/
    game.txt        内容包配置：场景清单 + 初始变量 + 资源目录约定
    constants.js    存储键 / 后日谈入口等前端常量
    scn/            29 个场景块（chunk001.txt ～ chunk029.txt）
    bg/ ch/ ev/ sd/ 转码后的美术资源
  pages/
    index/          主页（开始 / 继续 / 后日谈 / 设置 / 关于）
    game/           正文页（打字机 / 立绘三槽位 / 选项 / 快进 / 存档）
    data/           存档页（8 手动槽 + 1 自动槽）
    settings/       设置页
    about/          关于页
tools/
  convert_galgod.py   剧本转换器（对象节点 → 数组节点）
  convert_assets.py   资源转码器（裁剪 / 重编码）
  gen_game_config.py  生成 src/common/game.txt
  validate_galgod.py  内容包完整性校验
  simulate_galgod.py  剧本模拟器（路线复现）
tests/
  run-tests.mjs       引擎单元测试
  regression-real.mjs 真实剧本回归
```

---

## 开发

```bash
npm install          # 安装依赖
npm start            # 开发预览（aiot start --watch）
npm run build        # 构建
npm run release      # 发布（JSC 字节码）

# 内容转换（需先克隆上游 galgod-band 到 ../galgod-band）
npm run convert

# 校验
npm run validate     # 内容包完整性（场景 / 跳转 / 资源）
npm run simulate     # 剧本模拟（真结局 / Bad End 路线）
npm test             # 引擎单元测试
```

---

## 移植技术要点

### 剧本格式转换

上游为**对象节点** JSON：

```json
{"t": "o", "n": "诺提拉", "s": "台词内容"}
{"t": "j", "to": 1234}
{"t": "f", "v": "true_end_flag", "n": 1}
{"t": "cj", "v": "bad_end_flag", "op": ">=", "n": 7, "to": 4319}
```

本引擎为**数组节点**：

```javascript
[3, "诺提拉", "台词内容"]        // DIALOGUE
[6, 1234]                        // NEXT（索引跳转）
[10, "f.true_end_flag += 1"]     // VAR
```

转换器为每个跳转目标生成标签 `L<全局下标>`，并把所有跳转统一改写为标签式，
避免分块后索引错位。全量 81 个跳转目标经校验无悬空。

### 三个非显然的坑

1. **`f` 节点是累加不是赋值**
   上游实现为 `flags[v] = (flags[v] || 0) + n`。若简单转成 `f.x = n`，
   反复答题的分数会坍缩到 1，`bad_end_flag >= 7` 永远不成立，
   真结局判定链断裂。转换器输出 `f.x += n`（`n == 0` 时输出重置）。

2. **`sf` 节点携带关键状态**
   `true_end_finish` 由 `sf` 节点置位，但该变量又被 `cj` 条件引用。
   若把所有 `sf` 一致跳过，后日谈的解锁条件永远无法满足。
   转换器先扫描全部 `cj` 引用，命中者转为变量赋值节点，其余跳过。

3. **素材扩展名由「资源名前缀」决定**
   引擎的 `resourceManager.js` 按前缀路由：`sd*` → `sd/` + `.png`，
   `ev*` → `ev/` + `.jpg`。SD 图若存成 JPG，运行时直接找不到文件。

### 素材取景

| 类型 | 上游尺寸 | 处理 |
|---|---|---|
| 背景 | 672×480 全景（附 336×480 的 `_r` 变体） | 有 `_r` 直接取用；无则居中裁 336×480 |
| 事件 CG | 854×480 全宽 | 居中裁 336×480 |
| SD 图 | 854×480 全宽 | 居中裁 336×480，保持 PNG |
| 立绘 | 143×380 PNG | 原样保留，引擎按 `height` 缩放贴底 |

直接在 336 宽的屏幕里塞 672 宽背景会横向压扁一半，人物严重变形，所以必须裁。

---

## 校验结果

```
tools/validate_galgod.py   场景块 29 / 节点 5826 / 标签 81
                           ✓ 场景文件齐全且合法
                           ✓ 全部跳转目标可解析
                           ✓ 全部资源引用存在

tools/simulate_galgod.py   真结局 · 这片月幕  → 全剧终  (true=4 bad=7 finish=1)
                           Bad End 路线     → Bad End (true=0 bad=1 finish=0)
                           ✓ Bad End 可达  ✓ 真结局可达  ✓ 无悬空跳转

tests/run-tests.mjs        通过 17 / 17
```

---

## 版权与开源协议

- **代码**：GPL-3.0，见 [LICENSE](LICENSE)。
- **剧本与美术资源**：版权归原作「诺提拉观察所」所有，不在 GPL 范围内，
  详见 [NOTICE.md](NOTICE.md)。
- 本项目为非官方个人移植，与上游作者、小米（Xiaomi）均无关联。

更新记录见 [CHANGELOG.md](CHANGELOG.md)。
