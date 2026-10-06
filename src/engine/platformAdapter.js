/**
 * platformAdapter.js — 平台适配层（引擎与平台解耦的关键）
 *
 * 提供两套实现：
 *  - createAiotAdapter()   小米 Vela 快应用（手环 9/10）→ 见 aiotAdapter.js
 *  - createMemoryAdapter() Node 测试 / PC 预览（内存存储 + mock 音频）
 *
 * 适配器统一暴露：
 *  - readScenario(scnId) -> Promise<Array>   读取剧本（引擎唯一的数据入口）
 *  - storageGet(key) / storageSet(key, value)
 *  - toast(msg) / vibrate(mode)
 *  - audio: { play(name,{loop}), pause(), stop(), setVolume(v), onEnded(cb), getState() }
 *
 * 换平台 = 新写一个 adapter，引擎零改动。
 */

/** 从内容包配置解析场景：id -> {id, path, listName} */
export function findScenario(config, scnId) {
  if (!config || !config.scenarios) return null
  for (const listName of Object.keys(config.scenarios)) {
    const item = (config.scenarios[listName] || []).find((s) => s.id === scnId)
    if (item) return { id: item.id, path: item.path, listName }
  }
  return null
}

// ---------------------------------------------------------------- Memory（Node 测试 / PC 预览）
export function createMemoryAdapter(config, resourceManager, { fs, baseDir } = {}) {
  const mem = new Map()
  // 内联内容包（测试/PC 预览）：统一从 _inlineConfig 取游戏配置
  const gameCfg = (config && config._inlineConfig) || config || {}
  const inlineScenarios = (config && config._inlineScenarios) || {}

  const audio = {
    _endedCb: null,
    _state: { src: "", loop: false, playing: false, volume: 1 },
    calls: [],
    play(name, { loop = true } = {}) {
      this.calls.push({ op: "play", name, loop })
      this._state.src = name
      this._state.loop = loop
      this._state.playing = true
    },
    pause() {
      this.calls.push({ op: "pause" })
      this._state.playing = false
    },
    stop() {
      this.calls.push({ op: "stop" })
      this._state.playing = false
      this._state.src = ""
    },
    setVolume(v) { this._state.volume = v },
    onEnded(cb) { this._endedCb = cb },
    /** 测试辅助：模拟播放结束 */
    emitEnded() { if (this._endedCb) this._endedCb() },
    getState() { return Promise.resolve(this._state) }
  }

  return {
    config: gameCfg,
    async readConfig() {
      if (fs && baseDir) {
        const text = fs.readFileSync(`${baseDir}/src/common/game.txt`, "utf-8")
        const cfg = JSON.parse(text)
        this.config = cfg
        return cfg
      }
      this.config = gameCfg
      return gameCfg
    },
    async readScenario(scnId) {
      const scn = findScenario(this.config, scnId)
      if (!scn) throw new Error("未找到场景: " + scnId)
      if (fs && baseDir) {
        const text = fs.readFileSync(`${baseDir}/src/common/scn/${scn.path}`, "utf-8")
        return JSON.parse(text)
      }
      // 无 fs：使用注入的内容映射（测试用）
      const inline = inlineScenarios[scnId]
      if (!inline) throw new Error("无剧本源: " + scnId)
      return inline
    },
    async storageGet(key) {
      return mem.has(key) ? mem.get(key) : null
    },
    async storageSet(key, value) {
      if (value === "") mem.delete(key)
      else mem.set(key, value)
    },
    toast(msg) {
      if (typeof console !== "undefined") console.log("[Toast]", msg)
    },
    vibrate() {},
    audio
  }
}

export default { createMemoryAdapter }
