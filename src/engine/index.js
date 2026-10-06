/**
 * index.js — VN 引擎统一入口
 *
 * 用法（手环 QuickApp）：
 *   import { createVnEngine } from "../../engine/index.js"
 *   const engine = await createVnEngine({ adapter })
 *
 *   engine.runtime / engine.vars / engine.audio / engine.fx / engine.saves / engine.resources
 *
 * 流程：读内容包(game.txt) → 建资源/变量/音频/特效/存档 → 建运行时。
 * 引擎对平台零依赖，所有 IO 都走 adapter。
 */

import { ScriptRuntime } from "./scriptRuntime.js"
import { Variables } from "./variables.js"
import { SaveSystem } from "./saveSystem.js"
import { ResourceManager } from "./resourceManager.js"
import { AudioManager } from "./audioManager.js"
import { FxManager } from "./fxManager.js"

/**
 * @param {Object} deps
 * @param {Object} deps.adapter 平台适配（createAiotAdapter / createMemoryAdapter 产物）
 * @param {Function} deps.onState 剧本状态回调（UI 绑定）
 * @param {Function} deps.onFx   特效回调（UI 实现动画）
 * @param {Object} deps.options  { volume?, initialVolume? }
 */
export async function createVnEngine({ adapter, onState, onFx, options = {} }) {
  const config = await adapter.readConfig()

  const resources = new ResourceManager(config.resources)
  const vars = new Variables((config.initialState && config.initialState.flags) || {})
  const audio = new AudioManager({
    adapterAudio: adapter.audio,
    volume: options.volume !== undefined ? options.volume : 1
  })
  const fx = new FxManager({
    onFx,
    vibrate: () => adapter.vibrate && adapter.vibrate("short")
  })
  const saves = new SaveSystem({ adapter })

  const runtime = new ScriptRuntime({
    adapter,
    vars,
    audio,
    fx,
    config,
    onState
  })

  return { runtime, vars, audio, fx, saves, resources, config }
}

export { ScriptRuntime, SCN_TYPE, CH_SLOTS } from "./scriptRuntime.js"
export { Variables } from "./variables.js"
export { SaveSystem } from "./saveSystem.js"
export { ResourceManager } from "./resourceManager.js"
export { AudioManager } from "./audioManager.js"
export { FxManager } from "./fxManager.js"
// 注意：不在此处 re-export 适配器。
//  createAiotAdapter 在 aiotAdapter.js（顶层 import @system.*，仅 Vela 运行时加载）；
//  createMemoryAdapter 在 platformAdapter.js（Node 测试/PC 预览）。
//  此处 re-export aiotAdapter 会导致 Node 环境连带加载 @system.* 而失败。

export default { createVnEngine }
