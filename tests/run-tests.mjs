/**
 * run-tests.mjs — VN 引擎单元测试（Node 环境）
 *
 * 运行： node tests/run-tests.mjs
 *
 * 原理：引擎 .js 是 ESM 语法，而仓库 package.json 未声明 type:module
 * （QuickApp 构建不受影响），因此测试把 src/engine/*.js 复制为
 * tests/_esm/*.mjs 再导入，验证的是引擎原文件内容。
 */

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..")
const ENGINE_SRC = path.join(ROOT, "src", "engine")
const ESM_DIR = path.join(__dirname, "_esm")

// ---------- 准备：复制引擎为 .mjs ----------
fs.mkdirSync(ESM_DIR, { recursive: true })
const MODULES = [
  "variables.js",
  "scriptRuntime.js",
  "saveSystem.js",
  "resourceManager.js",
  "audioManager.js",
  "fxManager.js",
  "platformAdapter.js"
]
for (const f of MODULES) {
  const srcPath = path.join(ENGINE_SRC, f)
  const dstPath = path.join(ESM_DIR, f.replace(/\.js$/, ".mjs"))
  let code = fs.readFileSync(srcPath, "utf-8")
  // 修正 ESM import 路径：./xxx.js -> ./xxx.mjs（复制后扩展名变了）
  code = code.replace(/from\s+["'](\.\/[^"']+)\.js["']/g, 'from "$1.mjs"')
  fs.writeFileSync(dstPath, code, "utf-8")
}

const { Variables } = await import("./_esm/variables.mjs")
const { ScriptRuntime } = await import("./_esm/scriptRuntime.mjs")
const { SaveSystem } = await import("./_esm/saveSystem.mjs")
const { ResourceManager } = await import("./_esm/resourceManager.mjs")
const { AudioManager } = await import("./_esm/audioManager.mjs")
const { createMemoryAdapter } = await import("./_esm/platformAdapter.mjs")

// ---------- 简易测试运行器 ----------
let passed = 0
let failed = 0
const failures = []

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++
      console.log("  ✓ " + name)
    })
    .catch((e) => {
      failed++
      failures.push({ name, err: e })
      console.log("  ✗ " + name + " → " + e.message)
    })
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assert failed")
}
function eq(a, b, msg) {
  if (a !== b) throw new Error((msg || "eq") + `: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`)
}
function deepEq(a, b, msg) {
  const sa = JSON.stringify(a)
  const sb = JSON.stringify(b)
  if (sa !== sb) throw new Error((msg || "deepEq") + `: expected ${sb}, got ${sa}`)
}

// ---------- 构造测试环境 ----------
function makeEnv({ config, scripts } = {}) {
  const inlineConfig = Object.assign(
    {
      id: "test",
      title: "测试游戏",
      initialState: { flags: {} },
      resources: { base: "/common", dirs: { bg: "bg", sd: "sd", ev: "ev", ch: "ch", audio: "audio" } },
      scenarios: { common: [{ id: "s1", path: "s1.ks.txt" }] },
      routes: {}
    },
    config || {}
  )
  const adapter = createMemoryAdapter(
    { _inlineConfig: inlineConfig, _inlineScenarios: scripts || {} },
    new ResourceManager(inlineConfig.resources),
    {}
  )
  const vars = new Variables((inlineConfig.initialState && inlineConfig.initialState.flags) || {})
  return { adapter, vars, config: inlineConfig }
}

// =====================================================================
console.log("== 1. 全节点执行（0-10）==")
await test("非交互节点自动跳过，对话停下", async () => {
  const { adapter, vars, config } = makeEnv({
    scripts: {
      s1: [
        [0, "start"],
        [1, "第一章"],
        [2, "空_青空"],
        [7, "meguru_smile", "center", "fadein"],
        [8, "bgm_001", "bgm", "loop"],
        [10, "f.cnt = 1"],
        [3, "因幡めぐる", "你好", [["meguru_smile", "center", "change"]]],
        [3, "", "第二句"]
      ]
    }
  })
  const states = []
  const rt = new ScriptRuntime({
    adapter, vars,
    audio: null, fx: null,
    config,
    onState: (s) => states.push(s)
  })
  await rt.load("s1")
  eq(rt.chapterName, "第一章", "章节标题")
  eq(rt.bg, "空_青空", "背景")
  deepEq(rt.characters, { left: null, center: { key: "meguru_smile", action: "change" }, right: null }, "立绘槽位（fadein 后对话 change）")
  eq(rt.speaker, "因幡めぐる", "说话人")
  eq(rt.fullText, "你好", "对话内容")
  eq(rt.isTextComplete, false, "打字机未完成")
  eq(vars.get("cnt"), 1, "变量节点已执行")
  // 推进：完成当前句 → 下一句
  rt.markTextComplete()
  rt.advance()
  eq(rt.speaker, "", "第二句说话人为空")
  eq(rt.fullText, "第二句", "第二句内容")
})

await test("对话内立绘列表与 fadeout", async () => {
  const { adapter, vars, config } = makeEnv({
    scripts: {
      s1: [
        [3, "A", "说话", [["hero_happy", "left", "fadein"]]],
        [3, "A", "离开", [["hero_happy", "left", "fadeout"]]]
      ]
    }
  })
  const rt = new ScriptRuntime({ adapter, vars, config: config, onState: () => {} })
  await rt.load("s1")
  deepEq(rt.characters, { left: { key: "hero_happy", action: "fadein" }, center: null, right: null }, "立绘出现")
  rt.markTextComplete(); rt.advance()
  deepEq(rt.characters, { left: null, center: null, right: null }, "立绘消失")
})

// =====================================================================
console.log("== 2. 选项 / 条件过滤 / 跳转 ==")
await test("条件为假的选项被过滤", async () => {
  const { adapter, vars, config } = makeEnv({
    scripts: {
      s1: [
        [10, "f.flag = 1"],
        [4, [
          ["可选项", "ok", "f.ok=1", "f.flag >= 1"],
          ["隐藏项", "hidden", "", "f.flag >= 5"]
        ]],
        [0, "ok"],
        [3, "", "到达 ok"]
      ]
    }
  })
  const rt = new ScriptRuntime({ adapter, vars, config: config, onState: () => {} })
  await rt.load("s1")
  eq(rt.showOptions, true, "选项弹出")
  eq(rt.options.length, 1, "只有 1 个选项可见")
  eq(rt.options[0].text, "可选项", "保留条件为真的选项")
  rt.choose(0)
  eq(rt.showOptions, false, "选项关闭")
  eq(vars.get("ok"), 1, "选项表达式执行")
  eq(rt.fullText, "到达 ok", "跳转成功")
})

await test("选项随机数表达式", async () => {
  const { adapter, vars, config } = makeEnv({ scripts: { s1: [[4, [["掷骰", "j", "f.d = rand(1,1)"]]], [0, "j"]] } })
  const rt = new ScriptRuntime({ adapter, vars, config: config, onState: () => {} })
  await rt.load("s1")
  rt.choose(0)
  eq(vars.get("d"), 1, "rand(1,1)=1")
})

// =====================================================================
console.log("== 3. 变量系统 ==")
await test("指令执行：赋值/自增/加减/字符串", () => {
  const v = new Variables({})
  v.run("f.a = 3, f.b++, f.c = 'hi', f.d += 2, f.b--")
  eq(v.get("a"), 3)
  eq(v.get("b"), 0) // ++ 后 --，回到 0
  eq(v.get("c"), "hi")
  eq(v.get("d"), 2)
})
await test("条件表达式", () => {
  const v = new Variables({ flag: 5, done: false, name: "meguru" })
  eq(v.evalCondition("f.flag >= 3"), true)
  eq(v.evalCondition("f.flag > 5"), false)
  eq(v.evalCondition("f.name == 'meguru'"), true)
  eq(v.evalCondition("f.flag >= 3 && !f.done"), true)
  eq(v.evalCondition("f.flag >= 3 || f.done"), true)
  eq(v.evalCondition("f.missing"), false) // 未定义变量视为 0
  eq(v.evalCondition("f.flag == f.name"), false)
})
await test("rand 边界", () => {
  const v = new Variables({})
  v.run("f.r = rand(5,5)")
  eq(v.get("r"), 5)
})

// =====================================================================
console.log("== 4. 存档 / 恢复 ==")
await test("存档恢复完整状态", async () => {
  const { adapter, vars, config } = makeEnv({
    scripts: {
      s1: [
        [2, "bg_a"],
        [1, "第X章"],
        [10, "f.flag = 7"],
        [7, "hero", "left", "fadein"],
        [3, "某人", "存档点句子"]
      ]
    }
  })
  const rt = new ScriptRuntime({ adapter, vars, config: config, onState: () => {} })
  await rt.load("s1")
  rt.markTextComplete()
  const saved = rt.save()
  eq(saved.scnId, "s1")
  eq(saved.flags.flag, 7)
  eq(saved.bg, "bg_a")
  // 改变状态
  vars.set("flag", 999)
  rt.bg = "其他"
  // 恢复
  const rt2 = new ScriptRuntime({ adapter, vars, config: config, onState: () => {} })
  await rt2.restore(saved)
  eq(rt2.vars.get("flag"), 7, "变量恢复")
  eq(rt2.bg, "bg_a", "背景恢复")
  eq(rt2.chapterName, "第X章", "章节恢复")
  eq(rt2.fullText, "存档点句子", "文本恢复")
  deepEq(rt2.characters, { left: { key: "hero", action: "fadein" }, center: null, right: null }, "立绘恢复")
  eq(rt2.isTextComplete, true, "读档后全文显示")
})

await test("SaveSystem 多槽位", async () => {
  const { adapter } = makeEnv({})
  const saves = new SaveSystem({ adapter, slotCount: 3 })
  await saves.save(0, { a: 1 }, { title: "slot0" })
  await saves.save(1, { b: 2 }, { title: "slot1" })
  const list = await saves.list()
  eq(list.length, 3)
  eq(list[0].empty, false)
  eq(list[1].empty, false)
  eq(list[2].empty, true)
  deepEq(await saves.load(0), { a: 1 })
  deepEq(await saves.load(2), null)
})

// =====================================================================
console.log("== 5. 跨场景推进（routes）==")
await test("列表内顺序推进 + flagRoute 分线", async () => {
  const cfg = {
    scenarios: {
      common: [{ id: "s1", path: "s1.ks.txt" }, { id: "s2", path: "s2.ks.txt" }],
      nene: [{ id: "n1", path: "n1.ks.txt" }, { id: "n2", path: "n2.ks.txt" }],
      meguru: [{ id: "m1", path: "m1.ks.txt" }]
    },
    routes: {
      s2: {
        type: "flagRoute",
        targets: [
          { id: "nene", flag: "nen_flag", next: "n1" },
          { id: "meguru", flag: "meg_flag", next: "m1" }
        ],
        fallback: "m1"
      }
    }
  }
  const scripts = {
    s1: [[3, "", "s1 只有一句"]],
    s2: [[3, "", "s2 只有一句"], [10, "f.nen_flag = 3"]],
    n1: [[3, "", "进入 nene 线"]]
  }
  const { adapter, vars, config } = makeEnv({ config: cfg, scripts })
  const rt = new ScriptRuntime({ adapter, vars, config: cfg, onState: () => {} })
  await rt.load("s1")
  rt.markTextComplete(); rt.advance() // s1 结束 → 自动进 s2（异步）
  await new Promise((r) => setTimeout(r, 0))
  eq(rt.scnId, "s2", "顺序推进到 s2")
  rt.markTextComplete(); rt.advance() // s2 执行变量 → 结束 → flagRoute（异步）
  await new Promise((r) => setTimeout(r, 0))
  eq(rt.scnId, "n1", "好感度最高 → nene 线")
})

await test("flagRoute 全 0 走 fallback", async () => {
  const cfg = {
    scenarios: { common: [{ id: "s1", path: "s1.ks.txt" }], a: [{ id: "a1", path: "a1.ks.txt" }] },
    routes: { s1: { type: "flagRoute", targets: [{ id: "a", flag: "f1", next: "a1" }], fallback: "a1" } }
  }
  const scripts = { s1: [[3, "", "句"]], a1: [[3, "", "fallback 线"]] }
  const { adapter, vars, config } = makeEnv({ config: cfg, scripts })
  const rt = new ScriptRuntime({ adapter, vars, config: cfg, onState: () => {} })
  await rt.load("s1")
  rt.markTextComplete(); rt.advance()
  await new Promise((r) => setTimeout(r, 0))
  eq(rt.scnId, "a1", "全 0 → fallback")
})

await test("场景结束后游戏结束", async () => {
  const cfg = { scenarios: { common: [{ id: "s1", path: "s1.ks.txt" }] }, routes: {} }
  const scripts = { s1: [[3, "", "最后一句"]] }
  const { adapter, vars, config } = makeEnv({ config: cfg, scripts })
  const rt = new ScriptRuntime({ adapter, vars, config: cfg, onState: () => {} })
  await rt.load("s1")
  rt.markTextComplete(); rt.advance()
  eq(rt.ended, true, "ended 标记")
})

// =====================================================================
console.log("== 6. 音频策略（单通道）==")
await test("BGM 播放与切换", () => {
  const log = []
  const adapterAudio = {
    play: (n, o) => log.push(["play", n, o.loop]),
    pause: () => log.push(["pause"]),
    stop: () => log.push(["stop"]),
    setVolume: () => {},
    onEnded: () => {},
    getState: () => Promise.resolve(null)
  }
  const am = new AudioManager({ adapterAudio })
  am.play("bgm1", "bgm", "loop")
  am.play("bgm2", "bgm", "loop")
  deepEq(log, [["play", "bgm1", true], ["play", "bgm2", true]], "BGM 直接切换")
})

await test("SE 打断 BGM 并在结束后恢复", () => {
  const log = []
  let endedCb = null
  const adapterAudio = {
    play: (n, o) => log.push(["play", n, o.loop]),
    pause: () => log.push(["pause"]),
    stop: () => log.push(["stop"]),
    setVolume: () => {},
    onEnded: (cb) => { endedCb = cb },
    getState: () => Promise.resolve(null)
  }
  const am = new AudioManager({ adapterAudio })
  am.play("bgm1", "bgm", "loop")
  am.play("se1", "se", "once")
  deepEq(log, [["play", "bgm1", true], ["pause"], ["play", "se1", false]], "SE 打断 BGM")
  log.length = 0
  endedCb() // SE 播完
  deepEq(log, [["play", "bgm1", true]], "结束后恢复 BGM")
})

await test("音频存档快照恢复", () => {
  const log = []
  const adapterAudio = {
    play: (n, o) => log.push(["play", n, o.loop]),
    pause: () => {}, stop: () => log.push(["stop"]),
    setVolume: () => {}, onEnded: () => {},
    getState: () => Promise.resolve(null)
  }
  const am = new AudioManager({ adapterAudio })
  am.play("bgmX", "bgm", "loop")
  const snap = am.snapshot()
  deepEq(snap, { bgm: "bgmX", se: null })
  am.stopAll()
  am.restore(snap)
  deepEq(log, [["play", "bgmX", true], ["stop"], ["stop"], ["play", "bgmX", true]], "恢复重播 BGM")
})

// =====================================================================
console.log("== 7. 快进 ==")
await test("快进遇选项停止", async () => {
  const { adapter, vars, config } = makeEnv({
    scripts: {
      s1: [
        [3, "", "第一句"],
        [3, "", "第二句"],
        [4, [["选项A", "j", ""]]],
        [0, "j"],
        [3, "", "选项后"]
      ]
    }
  })
  const rt = new ScriptRuntime({ adapter, vars, config: config, onState: () => {} })
  await rt.load("s1")
  rt.doFastForward()
  await new Promise((r) => setTimeout(r, 300))
  eq(rt.showOptions, true, "停在选项")
  eq(rt.isFastForwarding, false, "快进停止")
  eq(rt.fullText, "第二句", "显示最后一句")
})

await test("resourceManager 预加载清单", () => {
  const rm = new ResourceManager({ base: "/common", dirs: { bg: "bg", sd: "sd", ev: "ev", ch: "ch", audio: "audio" } })
  const list = rm.preloadList([
    [2, "bg1"],
    [3, "A", "话", [["hero_happy", "center", "change"]]],
    [5, "sd001"],
    [7, "hero_sad", "left", "fadein"],
    [8, "bgm1", "bgm", "loop"]
  ])
  deepEq(list, [
    "/common/bg/bg1.jpg",
    "/common/sd/sd001.png",
    "/common/ch/hero_happy.png",
    "/common/ch/hero_sad.png"
  ], "预加载清单（音频不预加载）")
})

await test("cg* 事件图归入 ev/ 目录（回归：曾误判为不存在的 ev 资源）", () => {
  const rm = new ResourceManager({ base: "/common", dirs: { bg: "bg", sd: "sd", ev: "ev", ch: "ch", audio: "audio" } })
  const refs = rm.scanScript([
    [5, "cg_001"],
    [5, "cg_noctella_descend"],
    [5, "sd_001"]
  ])
  eq(refs.ev.size, 2, "cg* 应归入 ev")
  eq(refs.sd.size, 1, "sd* 应归入 sd")
  const list = rm.preloadList([[5, "cg_001"]])
  deepEq(list, ["/common/ev/cg_001.jpg"], "cg* → /common/ev/<名>.jpg")
})

await test("资源 URI 约定：sd→png、ev→jpg、bg→jpg、ch→png", () => {
  const rm = new ResourceManager({ base: "/common", dirs: { bg: "bg", sd: "sd", ev: "ev", ch: "ch", audio: "audio" } })
  eq(rm.uri("sd", "sd_001"), "/common/sd/sd_001.png", "SD 图必须落 sd/ 且为 PNG")
  eq(rm.uri("ev", "cg_001"), "/common/ev/cg_001.jpg", "事件 CG 必须落 ev/ 且为 JPEG")
  eq(rm.uri("bg", "moon"), "/common/bg/moon.jpg", "背景 JPEG")
  eq(rm.uri("ch", "sp_000"), "/common/ch/sp_000.png", "立绘 PNG（保留透明通道）")
})

await test("剧本引用的全部资源在磁盘上存在", async () => {
  const fsmod = await import("node:fs")
  const pathmod = await import("node:path")
  const SCN_DIR = pathmod.join(ROOT, "src", "common", "scn")
  const COMMON = pathmod.join(ROOT, "src", "common")
  const rm = new ResourceManager({ base: "/common", dirs: { bg: "bg", sd: "sd", ev: "ev", ch: "ch", audio: "audio" } })

  const all = []
  for (const f of fsmod.readdirSync(SCN_DIR).filter((x) => x.endsWith(".txt")).sort()) {
    const data = JSON.parse(fsmod.readFileSync(pathmod.join(SCN_DIR, f), "utf-8"))
    all.push(...rm.preloadList(data))
  }
  const missing = []
  for (const uri of new Set(all)) {
    // "/common/bg/moon.jpg" -> src/common/bg/moon.jpg
    const rel = uri.replace(/^\/common\//, "")
    const abs = pathmod.join(COMMON, rel)
    if (!fsmod.existsSync(abs)) missing.push(uri)
  }
  eq(missing.length, 0, "缺失资源: " + missing.slice(0, 10).join(", "))
  assert(all.length > 0, "应至少解析出若干资源引用")
})

// =====================================================================
console.log("== 8. 立绘槽位修复回归（1.1.1）==")

await test("单字母别名槽位 c/l/r 归一化为标准槽位", async () => {
  const { adapter, vars, config } = makeEnv({
    scripts: {
      s1: [
        [3, "A", "中", [["sp_c", "c", "change"]]],
        [3, "A", "左", [["sp_l", "l", "change"]]],
        [3, "A", "右", [["sp_r", "r", "change"]]]
      ]
    }
  })
  const rt = new ScriptRuntime({ adapter, vars, config: config, onState: () => {} })
  await rt.load("s1")
  deepEq(rt.characters, { left: null, center: { key: "sp_c", action: "change" }, right: null }, "c → center")
  rt.markTextComplete(); rt.advance()
  deepEq(rt.characters.left, { key: "sp_l", action: "change" }, "l → left")
  rt.markTextComplete(); rt.advance()
  deepEq(rt.characters.right, { key: "sp_r", action: "change" }, "r → right")
})

await test("跨场景 load() 非存档分支重置立绘", async () => {
  const cfg = { scenarios: { common: [{ id: "s1", path: "s1.ks.txt" }, { id: "s2", path: "s2.ks.txt" }] }, routes: {} }
  const scripts = {
    s1: [[3, "A", "有立绘", [["hero", "center", "change"]]]],
    s2: [[3, "B", "新场景"]] // s2 不声明立绘
  }
  const { adapter, vars, config } = makeEnv({ config: cfg, scripts })
  const rt = new ScriptRuntime({ adapter, vars, config: cfg, onState: () => {} })
  await rt.load("s1")
  deepEq(rt.characters.center, { key: "hero", action: "change" }, "s1 立绘已设置")
  rt.markTextComplete(); rt.advance() // 场景结束 → 自动进 s2
  await new Promise((r) => setTimeout(r, 0))
  eq(rt.scnId, "s2", "推进到 s2")
  deepEq(rt.characters, { left: null, center: null, right: null }, "跨场景后立绘清空")
})

await test("读档恢复保留存档立绘", async () => {
  const { adapter, vars, config } = makeEnv({
    scripts: { s1: [[3, "A", "句", [["hero", "left", "fadein"]]]] }
  })
  const rt = new ScriptRuntime({ adapter, vars, config: config, onState: () => {} })
  await rt.load("s1")
  rt.markTextComplete()
  const saved = rt.save()
  const rt2 = new ScriptRuntime({ adapter, vars, config: config, onState: () => {} })
  await rt2.restore(saved)
  deepEq(rt2.characters, { left: { key: "hero", action: "fadein" }, center: null, right: null }, "读档保留立绘")
})

await test("legacy “消” 清空全部槽位", async () => {
  const { adapter, vars, config } = makeEnv({
    scripts: {
      s1: [
        [7, "hero", "left", "fadein"],
        [3, "A", "句1"],
        [7, "hero2", "right", "fadein"],
        [7, "hero", "消"]
      ]
    }
  })
  const rt = new ScriptRuntime({ adapter, vars, config: config, onState: () => {} })
  await rt.load("s1") // 停在对话行，[7] 指令已自动执行 fadein
  deepEq(rt.characters.left, { key: "hero", action: "fadein" }, "fadein 后左槽已设置")
  // 推进：完成对话 → 自动执行 hero2 fadein 与 “消”
  rt.markTextComplete(); rt.advance()
  deepEq(rt.characters, { left: null, center: null, right: null }, "“消”后全部清空")
})

await test("跨场景跳转（scnId@label）重置立绘", async () => {
  const cfg = { scenarios: { common: [{ id: "s1", path: "s1.ks.txt" }, { id: "s2", path: "s2.ks.txt" }] }, routes: {} }
  const scripts = {
    s1: [
      [3, "A", "句", [["hero", "center", "change"]]],
      [4, [["去 s2", "s2@dst", ""]]]
    ],
    s2: [[0, "dst"], [3, "B", "s2 句"]]
  }
  const { adapter, vars, config } = makeEnv({ config: cfg, scripts })
  const rt = new ScriptRuntime({ adapter, vars, config: cfg, onState: () => {} })
  await rt.load("s1")
  deepEq(rt.characters.center, { key: "hero", action: "change" }, "s1 立绘已设置")
  rt.markTextComplete(); rt.advance()
  rt.choose(0)
  await new Promise((r) => setTimeout(r, 0))
  eq(rt.scnId, "s2", "跨场景跳转成功")
  deepEq(rt.characters, { left: null, center: null, right: null }, "跳转后立绘清空")
})

await test("真实剧本 chunk009→chunk010 不再累积三槽", async () => {
  const fsmod = await import("node:fs")
  const pathmod = await import("node:path")
  const SCN_DIR = pathmod.join(ROOT, "src", "common", "scn")
  const cfg = { scenarios: { main: [{ id: "009", path: "chunk009.txt" }, { id: "010", path: "chunk010.txt" }] }, routes: {} }
  const scripts = {}
  for (const id of ["009", "010"]) {
    scripts[id] = JSON.parse(fsmod.readFileSync(pathmod.join(SCN_DIR, `chunk${id}.txt`), "utf-8"))
  }
  const { adapter, vars, config } = makeEnv({ config: cfg, scripts })
  const rt = new ScriptRuntime({ adapter, vars, config: cfg, onState: () => {} })
  await rt.load("009")
  // 步进完 chunk009 的全部非交互节点（对话等玩家点击）
  let guard = 0
  while (rt.lineIndex < rt.scriptData.length && !rt.showOptions && !rt.ended && guard++ < 5000) {
    if (!rt.isTextComplete) rt.markTextComplete()
    rt.advance()
  }
  // chunk009 期间应有立绘被设置（如 left/right）
  const endOf009 = JSON.parse(JSON.stringify(rt.characters))
  const anySet = Object.keys(endOf009).some((k) => endOf009[k] !== null)
  assert(anySet, "chunk009 应设置过立绘")
  // 手动推进到 chunk010（load 非存档分支）
  await rt.load("010")
  deepEq(rt.characters, { left: null, center: null, right: null }, "进入 chunk010 立绘已被清空")
  // chunk010 中 "c" 槽位立绘应能正常显示
  let foundCenter = false
  for (const node of rt.scriptData) {
    if (node[0] === 3 && Array.isArray(node[3])) {
      for (const item of node[3]) {
        if (Array.isArray(item) && item[1] === "c") { foundCenter = true; break }
      }
    }
    if (foundCenter) break
  }
  assert(foundCenter, "chunk010 含 c 槽位指令（供别名归一化生效验证）")
})

// =====================================================================
console.log("\n========== 结果 ==========")
console.log(`通过 ${passed} / ${passed + failed}`)
if (failed > 0) {
  for (const f of failures) console.log("\nFAILED:", f.name, "\n", f.err.stack)
  process.exit(1)
}
