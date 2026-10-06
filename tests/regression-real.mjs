#!/usr/bin/env node
/**
 * regression-real.mjs — 真实内容包端到端回归
 *
 * 用 createMemoryAdapter 的 fs 模式加载仓库真实 game.txt + src/common/scn/*.txt，
 * 走完 common 前几个场景 + 019 分线 fallback，验证引擎在真实数据上不崩溃、状态正确。
 *
 * 运行：node tests/regression-real.mjs
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..")
const ESM = path.join(__dirname, "_esm")

// 复制引擎源码为 ESM（与 run-tests.mjs 相同机制），并把内部相对导入改为 .mjs
fs.mkdirSync(ESM, { recursive: true })
for (const f of fs.readdirSync(path.join(ROOT, "src", "engine"))) {
  if (f.endsWith(".js")) {
    let src = fs.readFileSync(path.join(ROOT, "src", "engine", f), "utf-8")
    src = src.replace(/from "\.\/([\w-]+)\.js"/g, 'from "./$1.mjs"')
    fs.writeFileSync(path.join(ESM, f.replace(/\.js$/, ".mjs")), src)
  }
}

const { createMemoryAdapter } = await import(`./_esm/platformAdapter.mjs`)
const { createVnEngine } = await import(`./_esm/index.mjs`)

const adapter = createMemoryAdapter({}, null, {
  fs,
  baseDir: ROOT
})
const cfg = await adapter.readConfig()
console.log(`内容包: ${cfg.title} v${cfg.version}，${cfg.scenarios.common.length} 个共通场景`)

let state = null
const engine = await createVnEngine({
  adapter,
  options: { saveSlots: 4 },
  onState: (s) => { state = s }
})

// 1) 从 001 开始，走 common 全场景（对话自动完成，选项选第一个）
await engine.runtime.load("001")
console.log(`\n== 001 开始 ==`)
let guard = 0
while (!state.ended && guard < 50000) {
  guard++
  if (state.showOptions) {
    // 选第一个可用选项
    engine.runtime.choose(0)
  } else if (state.isTextComplete) {
    engine.runtime.advance()
  } else {
    engine.runtime.markTextComplete()
  }
  await new Promise((r) => setTimeout(r, 0))
}
console.log(`001 推进完成（${guard} 步） ended=${state.ended} scnId=${state.scnId} lineIndex=${state.lineIndex}`)
if (state.ended) {
  console.log("common 全场景走完 → 游戏结束（分线 fallback 应进 020_meguru）")
} else {
  console.log("  → 停在选项处，选第一个继续")
  engine.runtime.choose(0)
  await new Promise((r) => setTimeout(r, 0))
  console.log(`  → 进入 ${state.scnId}`)
}

// 2) 验证跨场景推进：当前场景推进 20 步
console.log(`\n== 继续推进 ${state.scnId} ==`)
guard = 0
while (!state.ended && guard < 2000) {
  guard++
  if (state.showOptions) engine.runtime.choose(0)
  else if (state.isTextComplete) engine.runtime.advance()
  else engine.runtime.markTextComplete()
  await new Promise((r) => setTimeout(r, 0))
}
console.log(`推进完成（${guard} 步） ended=${state.ended} scnId=${state.scnId}`)

// 3) 存档 / 读档
const save = engine.runtime.save()
let state2 = null
const engine2 = await createVnEngine({
  adapter,
  options: { saveSlots: 4 },
  onState: (s) => { state2 = s }
})
await engine2.runtime.restore(save)
console.log(`\n读档成功：scnId=${state2.scnId} 立绘=${JSON.stringify(state2.characters)} bg=${state2.bg}`)
const ok = state2.scnId === state.scnId && state2.isTextComplete === true
console.log(ok ? "读档状态一致 ✓" : "读档状态异常 ✗")

// 4) 统计一路看到的资源引用（bg/sd），确认资源管理器清单可生成
const rm = engine.resources
const list = rm.preloadList ? rm.preloadList([]) : null
console.log(`\n资源管理器预加载清单: ${list ? list.length + " 项" : "未实现"}`)

console.log("\n真实内容包回归完成 ✓")
process.exit(ok ? 0 : 1)
