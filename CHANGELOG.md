# 更新日志

## 1.1.3（2026-10-13）

### 修复
- **最终三线分叉选项无法跳转 + 结局剧情串线**：转换器 `convert_galgod.py` 把上游全局下标跳转翻译成 `L<下标>` 标签时，未处理跨块引用——VnEngine 按块加载、只认当前块内标签，跨块目标全部「未找到标签」。本版将跨块引用改写为引擎原生支持的 `scnId@label` 形式：
  - chunk023 的三线分叉选项（「要对小涟放手」「要让小涟诞生」「交给小涟选择」）现在能正常跳转到对应结局场景；
  - chunk024/025/026/027 的合流/结局跳转（L5158/L5568/L5089/L4982）可正常进入共用结局场景 028/029；
  - 三条结局线不再按 chunk 顺序硬串连播（此前的行为是「真结局→二人世界→回归日常→全剧终」多个结局标题连播）。
- `validate_galgod.py` / `simulate_galgod.py` 同步支持 `scnId@label` 校验，消除「合并流语义 ≠ 引擎 chunk 语义」的验证盲区。
- 剧本立绘槽位随转换器归一化为标准 `left/center/right`（数据规范化，行为不变）。

### 测试
- 新增 4 组回归用例（共 30 项全过）：023 三线分叉选项跨块跳转、真实全剧本三线通关不串线、全程无「未找到标签」。

### 其他
- 版本号升至 1.1.3（manifest versionCode 5）。

## 1.1.2（2026-10-10）

### 修复
- **进游戏页必然重启（手环 9 固件）**：按上游仓库修改建议，完全移除 `system.brightness` 相关功能——`game.ux` 删除 brightness 模块引用、`captureOriginalBrightness` / `restoreBrightness` / `applyKeepScreenOn` 三个方法及生命周期调用；`settings.ux` 删除「屏幕常亮」「低亮度模式」两个开关；`manifest.json` 移除 `system.brightness` 权限声明。手环 9 固件不存在该模块，任何调用都可能触发设备重启。

### 其他
- 版本号升至 1.1.2（manifest versionCode 4）。

## 1.1.1（2026-10-09）

### 修复
- **立绘出现后不消失、三个槽位堆叠**：根因有三，均已修复——
  - 剧本槽位 `"c"` 不被识别：存量剧本 543 处用 `"c"` 表示中间位置，引擎只认 `left|center|right`，指令被静默忽略。运行时 `_applyCharacter` 现支持单字母别名（`c/l/r` → `center/left/right`），转换器 `convert_galgod.py` 同步做槽位归一化，防止重新转换时再次产生。
  - 跨场景立绘不清场：`load()` 非存档分支与 `_jumpToScenarioLabel()` 原先只清 CG/背景，`characters` 原样带入下一场景，三槽越积越满。现与 CG 一致在场景边界重置。
  - legacy "消" 分支死代码：`if (slot === "消" ...)` 位于 `pos === null return` 之后永远执行不到，且 `legacySlot("消")` 恒为 null。已改为在位置解析前处理，`"消"` / `fadeout` 清空全部槽位。

### 其他
- CI 工作流修正：`validate_qlwh.py`（其他项目遗留）改为本仓库的 `python3 tools/validate_galgod.py .`，产物名同步改为 `galgod-miband-10-rpk`。
- 版本号升至 1.1.1（manifest versionCode 3）。

## 1.1.0（2026-10-07）

### 新增
- **后日谈独立页面**：后日谈从主页弹窗改为独立页面 `pages/afterstory`，布局与交互对齐存档页（顶部标题 + 药丸卡片列表 + 底部返回条），支持点击卡片进入、未解锁置灰并给出提示。

### 修复
- **SD 事件图路径错误（显示为感叹号）**：`game.ux` 把 SD 图硬编码到 `/common/ev/<名>.png`，而资源实际位于 `/common/sd/<名>.png`，导致 19 个 SD 引用全部加载失败。已改为 `/common/sd/`。
- **事件 CG 扩展名错误（显示为感叹号）**：`resolveEVSrc()` 对非 `ev*` 前缀返回 `.png`，但 15 个 CG 资源（`cg_*`）实际为 `.jpg`，导致 CG 全部加载失败。已统一为 `.jpg`。
- **`resourceManager.scanScript` 漏收 `cg*` 资源**：原逻辑只把 `ev*` 归入事件图，`cg*` 既不进 `ev` 也不进 `sd`，预加载清单缺失这些图。已改为 `sd*` → sd 目录，其余（`ev*` / `cg*`）统一归 `ev` 目录。

### 回归测试
- 新增 3 条用例：`cg*` 归入 ev 目录、资源 URI 扩展名约定（sd→png / ev→jpg）、**剧本引用的全部资源在磁盘上存在**（直接扫描 29 个场景块逐条校验，防止此类链接失效再次发生）。
- 引擎单测 17 → **20** 条，全部通过。

## 1.0.0（2026-10-06）

### 移植
- 《想成为Galgame领域大神！！！》（作者：诺提拉 / 上游仓库 [mcpotato1123/galgod-band](https://github.com/mcpotato1123/galgod-band)）移植至小米 Vela 穿戴设备（小米手环 10，336×480）。
- 引擎与 UI 采用 [hrk666666/Senren-Banka-MiBand-10](https://github.com/hrk666666/Senren-Banka-MiBand-10) 的 VnEngine（协议 vn-1.1，内容包解耦）。
- 包名 `com.hrk.galgod.band`。

### 内容规模
- 剧本：5826 节点，分 29 个场景块（`chunk001.txt` ～ `chunk029.txt`）。
- 资源：背景 37 张、立绘 53 张、事件 CG 15 张、SD 图 19 张。
- 结局：Bad End · 未能触碰的世界 / —— 全剧终 ——（真结局）。
- 内置 13 题答题区与真结局判定（`true_end_flag` / `bad_end_flag` / `true_end_finish`）。

### 转换器关键处理
- **剧本格式转换**：上游为对象节点 JSON（`{"t":"s"/"o"/"j"/"f"/"cj"/"e"/"sf", ...}`），本引擎为数组节点（`[typeCode, ...]`）。索引式跳转统一改写为标签式跳转（`L<全局下标>`），全量 81 个跳转目标无悬空。
- **`f` 节点语义修正**：上游 `f` 节点是**累加**（`flags[v] = (flags[v]||0) + n`）而非赋值。转换器据此产出 `f.x += n`（`n==0` 时产出 `f.x = 0` 重置），否则答题计分会坍缩到 1，`bad_end_flag >= 7` 判定永远不成立。
- **`sf` 节点提升为变量**：被 `cj` 条件引用到的 `sf` 变量（如 `true_end_finish`）转换为变量赋值节点，其余静默跳过，保证后日谈解锁条件可达。
- **素材归置**：上游背景为 672×480 全景图（另附 336×480 的 `_r` 右半幅变体）。有 `_r` 变体直接取用（构图正确、无拉伸），无 `_r` 的从全景居中裁出 336×480。CG/SD 为 854×480 全宽图，居中裁为 336×480。立绘保留原始 143×380 与 PNG 透明通道，由引擎按 `height` 缩放贴底。
- **扩展名约定**：引擎按资源名前缀路由——`sd*` → `sd/` + `.png`，`ev*`/`cg*` → `ev/` + `.jpg`。SD 图必须存 PNG。
- 资源体积 5.54 MB → 4.04 MB。

### 引擎与页面适配
- `scriptRuntime.js`：新增 `loadByLabel(label)`，支持按标签跨场景定位（用于后日谈入口）；结局词组改为本作结局；清关记录存储键 `qlwh_clears` → `galgod_clears`。
- `constants.js`：`CLEARS_KEY` 改为 `galgod_clears`；后日谈入口 `AFTER_STORY = { name: "诺提拉", label: "L5158" }`。
- `index.ux` / `game.ux`：标题、默认背景、后日谈解锁条件（检查 `clears` 含 `"全剧终"`）随本作调整。
- `about.ux`：应用名与版权信息改为本作。
- `manifest.json`：包名 `com.hrk.galgod.band`，应用名 `GalGod`，`designWidth: 212`。

### 校验
- `tools/validate_galgod.py`：场景块齐全合法、全部跳转目标可解析、全部资源引用存在 —— **校验通过**。
- `tools/simulate_galgod.py`：真结局 / Bad End 路线复现、无悬空跳转 —— **通过 3/3**。
- `tests/run-tests.mjs`：引擎单元测试 —— **通过 17/17**。

### 授权
- 上游内容版权归原作者诺提拉所有，详见仓库 `NOTICE.md`。
- 引擎与移植代码以 GPL-3.0 发布。
