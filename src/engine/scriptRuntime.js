/**
 * scriptRuntime.js — VN 引擎剧本运行时（平台无关）
 *
 * 职责：
 *  - 逐行执行剧本节点（0标签/1章节/2背景/3对话/4选项/5事件CG/6跳转/7立绘/8音乐/9特效/10变量）
 *  - 非交互节点自动连续执行，对话/选项节点停下等待玩家
 *  - 选项跳转、条件选项（第4字段）、跨章节推进（routes 规则）
 *  - 快进 / 跳过至选项 / 存档 / 读档
 *
 * 不直接触碰任何平台 API：文件、存储、音频、特效、振动都通过注入的
 * adapter / audio / fx 完成，因此可以脱离手环在 Node 里单测。
 */

// 节点类型（格式 v1.1，向后兼容 0-6）
export const SCN_TYPE = {
  LABEL: 0,          // [0, "label"]
  CHAPTER_TITLE: 1,  // [1, "章节标题"]
  BACKGROUND: 2,     // [2, "bg_name"]
  DIALOGUE: 3,       // [3, "说话人", "内容", [立绘列表?]]
  SELECT: 4,         // [4, [["文字","跳转标签","表达式","条件?"], ...]]
  EV: 5,             // [5, "sdXXX" | "evXXX"]
  NEXT: 6,           // [6, "target_label"]
  CHARACTER: 7,      // [7, "角色id_表情", "left|center|right", "fadein|fadeout|change"]
  MUSIC: 8,          // [8, "曲名", "bgm|se", "loop|once"]
  FX: 9,             // [9, "whiteflash|blackout|fadein|fadeout|vibrate", 时长ms?]
  VAR: 10            // [10, "f.x = 1, f.y++"]
}

export const CH_SLOTS = ["left", "center", "right"]

/**
 * 真结局节点目标 → 通关标记线名。
 *
 * 本作（GalGod）的结局是「一个真结局 + 两个普通结局 + 一个 Bad End」，
 * 由剧本自身的条件跳转分发。只有真结局会给 true_end_finish 打点，
 * 从而解锁后日谈；因此这里只把真结局登记为「通关线」。
 * （哨兵 *gameend_END / *gameend_end 不计入）
 */
const END_LINE_NAMES = {
  "gameend_—— 全剧终 ——": "全剧终"
}

/**
 * 隐藏线入口选项跳转目标：首周目（未通关）置灰，通关任意 1 条主线后可选。
 * 本作没有需要跨周目解锁的隐藏线，故留空表。
 */
const HIDDEN_OPTION_JUMPS = {}

/** 存量 KRKR 立绘位置 → 标准槽位 */
const LEGACY_SLOT_MAP = {
  "出": "center", "中": "center", "顔": "center", "立": "center",
  "左": "left", "左中": "left", "左奥": "left", "左近": "left", "左外": "left",
  "右": "right", "右中": "right", "右奥": "right", "右近": "right", "右外": "right"
}

/** 存量位置（中文/百分比）→ left|center|right；无法识别返回 null */
function legacySlot(slot) {
  if (Object.prototype.hasOwnProperty.call(LEGACY_SLOT_MAP, slot)) return LEGACY_SLOT_MAP[slot]
  const m = /^(\d+)%$/.exec(slot)
  if (m) {
    const p = parseInt(m[1], 10)
    if (p < 33) return "left"
    if (p < 66) return "center"
    return "right"
  }
  return null
}

const FAST_FORWARD_DELAY = 50

export class ScriptRuntime {
  /**
   * @param {Object} deps
   * @param {Object} deps.adapter  平台适配（readScenario/scenarioPath/toast/vibrate/storage）
   * @param {Object} deps.vars     Variables 实例
   * @param {Object} deps.audio    AudioManager 实例
   * @param {Object} deps.fx       FxManager 实例
   * @param {Object} deps.config   内容包配置（game.txt 解析结果）
   * @param {Function} deps.onState 状态变更回调 (state) => void
   */
  constructor({ adapter, vars, audio, fx, config, onState }) {
    this.adapter = adapter
    this.vars = vars
    this.audio = audio
    this.fx = fx
    this.config = config
    this.onState = onState || (() => {})

    // 剧本状态
    this.scriptData = []
    this.scnId = null
    this.lineIndex = 0

    // 展示状态
    this.speaker = ""
    this.fullText = ""

    // 通关标记（各线真结局通关记录，用于隐藏线解锁 / 后日谈入口）
    this.clears = []
    this.isTextComplete = false
    this.bg = ""
    this.sd = ""
    this.ev = ""
    this.chapterName = ""
    this.characters = { left: null, center: null, right: null }
    this.options = []
    this.showOptions = false
    this.isSkipping = false
    this.isFastForwarding = false
    this.ended = false
    this.fastForwardTimer = null
    this._skipNextDialogueInit = false
    this._pendingSaved = null
  }

  // ---------- 对外 API ----------

  /**
   * 按标签加载：在所有场景里搜索该标签，定位到它所在的场景与行。
   * 用于「后日谈」这类直接跳到剧本中某个标签的入口。
   * 返回是否找到。
   */
  async loadByLabel(label) {
    const cfg = this.config
    if (!cfg || !cfg.scenarios) return false
    for (const listName of Object.keys(cfg.scenarios)) {
      for (const s of cfg.scenarios[listName] || []) {
        const data = await this.adapter.readScenario(s.id)
        const arr = Array.isArray(data) ? data : (data && data.content) || []
        const idx = arr.findIndex((n) => n[0] === SCN_TYPE.LABEL && n[1] === label)
        if (idx >= 0) {
          await this.load(s.id, idx)
          return true
        }
      }
    }
    return false
  }

  /** 加载场景（可带起始行/存档状态） */
  async load(scnId, startIndex = 0, saved = null) {
    this.clearFastForward()
    const data = await this.adapter.readScenario(scnId)
    this.scriptData = Array.isArray(data) ? data : (data && data.content) || []
    this.scnId = scnId
    this.lineIndex = parseInt(startIndex, 10) || 0
    this.ended = false

    if (saved) {
      this._applySavedState(saved)
    } else {
      this.speaker = ""
      this.fullText = ""
      this.isTextComplete = false
      this.options = []
      this.showOptions = false
      // 跨场景：CG（事件图）属于原场景，不残留到新场景；需要时场景剧本会重新声明
      this.ev = ""
      this.sd = ""
    }
    this._emit()
    this._step()
  }

  /** 玩家点击推进：文本未完成→完成；否则下一行 */
  advance() {
    if (this.isSkipping) { this.skipToNextSelect(); return }
    if (!this.isTextComplete) { this.markTextComplete(); return }
    if (this.showOptions || this.ended) return
    this.lineIndex++
    this._step()
  }

  /** 打字机完成当前句（UI 逐字打完时调用） */
  markTextComplete() {
    if (this.isTextComplete) return
    this.isTextComplete = true
    this._emit()
  }

  /** 快进：立即完成当前句，并自动推进 */
  doFastForward() {
    if (this.showOptions || this.ended) return
    this.isFastForwarding = true
    if (this.isTextComplete) {
      this.lineIndex++
      this._step()
      if (this.isFastForwarding) this._scheduleFF()
    } else {
      this.markTextComplete()
      this._scheduleFF(20)
    }
  }

  stopFastForward() {
    this.isFastForwarding = false
    this.clearFastForward()
  }

  /** 跳过直到下一个选项（跨章节） */
  skipToNextSelect() {
    if (!this.scriptData.length) return
    this.isSkipping = true
    this.sd = this.ev = ""
    let lastDialogue = null

    while (this.lineIndex < this.scriptData.length) {
      const node = this.scriptData[this.lineIndex]
      const type = node[0]
      switch (type) {
        case SCN_TYPE.SELECT: {
          if (lastDialogue) {
            this.speaker = lastDialogue[1] || ""
            this.fullText = lastDialogue[2] || ""
            this.isTextComplete = true
          }
          this.isSkipping = false
          this.options = this._filterOptions(node[1])
          this.showOptions = true
          this._emit()
          return
        }
        case SCN_TYPE.NEXT: {
          // 快进遇跳转/结束节点必须执行，不能跳过：
          // 跳过 gameend 会导致线路不结束、顺序连播下一条线（"芳乃完接茉子"根因）。
          const rawTarget = String(node[1] || "")
          const cond = node[2]
          // 条件跳转：条件为假 → 落到下一行继续
          if (cond !== undefined && cond !== null && cond !== "" &&
              !this.vars.evalCondition(String(cond))) {
            this.lineIndex++
            continue
          }
          // 跨场景跳转：退出快进，交给异步加载新场景
          if (rawTarget.indexOf("@") !== -1) {
            this.isSkipping = false
            this.lineIndex = this.scriptData.length
            this._jumpToScenarioLabel(rawTarget)
            this._emit()
            return
          }
          // 本场景标签存在 → 跳到该标签继续快进
          const idx = this.scriptData.findIndex(
            (n) => n[0] === SCN_TYPE.LABEL && n[1] === node[1]
          )
          if (idx !== -1) {
            this.lineIndex = idx
            continue
          }
          // 目标不存在：含 gameend / endrecollection → 游戏结束（快进到结局即结束）
          const target = rawTarget.toLowerCase()
          if (target.indexOf("gameend") !== -1 || target.indexOf("endrecollection") !== -1) {
            this._finishGame(rawTarget)
            return
          }
          // 其余：顺序推进（与 _step 一致）
          this.lineIndex++
          continue
        }
        case SCN_TYPE.DIALOGUE:
          lastDialogue = node
          break
        case SCN_TYPE.BACKGROUND:
          this.bg = node[1]
          break
        case SCN_TYPE.CHAPTER_TITLE:
          this.chapterName = node[1]
          break
        case SCN_TYPE.EV:
          this._applyEv(node[1])
          break
        default:
          break
      }
      this.lineIndex++
    }
    // 章节内没有选项 → 进入下一场景继续
    if (this.lineIndex >= this.scriptData.length) {
      this._nextScenario()
    }
  }

  /** 玩家选择选项 */
  choose(optionIndex) {
    const opt = this.options[optionIndex]
    if (!opt) return
    if (opt.enabled === false) return  // 置灰选项不可选（隐藏线首周目锁定）
    this.showOptions = false
    if (opt.exp) this.vars.run(opt.exp)
    this._emit()

    const target = opt.jump
    const idx = this.scriptData.findIndex(
      (n) => n[0] === SCN_TYPE.LABEL && n[1] === target
    )
    if (idx !== -1) {
      this.lineIndex = idx
      if (this.isSkipping) {
        this.skipToNextSelect()
      } else {
        this._step()
      }
    } else {
      // 跳到另一个场景的标签：跨场景跳转
      this._jumpToScenarioLabel(target)
    }
  }

  /** 保存当前状态（可 JSON 序列化） */
  save() {
    return {
      scnId: this.scnId,
      lineIndex: this.lineIndex,
      speaker: this.speaker,
      fullText: this.fullText,
      bg: this.bg,
      chapterName: this.chapterName,
      characters: JSON.parse(JSON.stringify(this.characters)),
      flags: JSON.parse(JSON.stringify(this.vars.flags)),
      audio: this.audio ? this.audio.snapshot() : null
    }
  }

  /** 恢复存档：记录需恢复的字段，由 load 应用 */
  async restore(saveData) {
    if (!saveData) return
    this._pendingSaved = saveData
    await this.load(saveData.scnId, saveData.lineIndex, saveData)
  }

  clearFastForward() {
    if (this.fastForwardTimer) {
      clearTimeout(this.fastForwardTimer)
      this.fastForwardTimer = null
    }
  }

  destroy() {
    this.clearFastForward()
  }

  // ---------- 内部：状态机 ----------

  _step() {
    if (this.isSkipping) { this.skipToNextSelect(); return }
    if (this.lineIndex >= this.scriptData.length) { this._nextScenario(); return }

    const node = this.scriptData[this.lineIndex]
    if (!node) { this.lineIndex++; this._step(); return }

    const type = node[0]
    const content = node[1]

    switch (type) {
      case SCN_TYPE.BACKGROUND:
        this.bg = content
        this.lineIndex++
        this._emit()
        this._step()
        break

      case SCN_TYPE.DIALOGUE:
        // 读档恢复：当前行若是存档点对话，保留存档里的说话人/文本/完成态
        if (this._skipNextDialogueInit) {
          this._skipNextDialogueInit = false
          if (Array.isArray(node[3])) this._applyCharList(node[3])
          this._emit()
          break
        }
        this.speaker = content || ""
        this.fullText = node[2] || ""
        this.isTextComplete = false
        // 立绘列表（node[3]，可选）：[["角色id_表情","位置","动作"], ...]
        if (Array.isArray(node[3])) this._applyCharList(node[3])
        this._emit()
        break // 停下等玩家

      case SCN_TYPE.SELECT:
        // 快进遇选项：停止快进与自动推进
        this.isFastForwarding = false
        this.clearFastForward()
        this.options = this._filterOptions(content)
        this.showOptions = true
        this._emit()
        break

      case SCN_TYPE.CHAPTER_TITLE:
        this.chapterName = content
        this.lineIndex++
        this._emit()
        this._step()
        break

      case SCN_TYPE.NEXT: {
        const rawTarget = String(content || "")
        // 扩展：条件跳转 [6, "target", "cond"] —— 条件为假则落到下一行继续
        const cond = node[2]
        if (cond !== undefined && cond !== null && cond !== "" &&
            !this.vars.evalCondition(String(cond))) {
          this.lineIndex++
          this._step()
          break
        }
        // 扩展：目标形如 "scnId@label" → 跨场景跳转（供分块剧本合流/分支使用）
        if (rawTarget.indexOf("@") !== -1) {
          this._jumpToScenarioLabel(rawTarget)
          break
        }
        const idx = this.scriptData.findIndex(
          (n) => n[0] === SCN_TYPE.LABEL && n[1] === content
        )
        if (idx !== -1) {
          this.lineIndex = idx
          this._step()
        } else {
          // NEXT 目标在当前场景不存在：
          // - 若目标名含 gameend / endrecollection 等结束标记 → 游戏结束
          // - 否则按正常流程走到场景末尾，由 _nextScenario 推进
          const target = rawTarget.toLowerCase()
          if (target.indexOf("gameend") !== -1 || target.indexOf("endrecollection") !== -1) {
            this._finishGame(rawTarget)
          } else {
            this.lineIndex++
            this._step()
          }
        }
        break
      }

      case SCN_TYPE.LABEL:
        this.lineIndex++
        this._step()
        break

      case SCN_TYPE.EV:
        this._applyEv(content)
        this.lineIndex++
        this._emit()
        this._step()
        break

      case SCN_TYPE.CHARACTER:
        this._applyCharacter(content, node[2], node[3])
        this.lineIndex++
        this._emit()
        this._step()
        break

      case SCN_TYPE.MUSIC:
        if (this.audio) this.audio.play(content, node[2] || "bgm", node[3] || "loop")
        this.lineIndex++
        this._step()
        break

      case SCN_TYPE.FX:
        if (this.fx) this.fx.trigger(content, node[2])
        this.lineIndex++
        this._step()
        break

      case SCN_TYPE.VAR:
        this.vars.run(content)
        this.lineIndex++
        this._emit()
        this._step()
        break

      default:
        // 未知类型：跳过（向后兼容）
        this.lineIndex++
        this._step()
        break
    }
  }

  /** 事件 CG：sd 显示 / ev 记录（ev 层是否渲染由 UI 决定） */
  _applyEv(name) {
    // 与旧版 updateEV 行为一致：
    //  null → 清空；sd* → 立绘差分图；ev* → 事件CG；其余（item_* 道具等）忽略
    if (name === null) { this.sd = this.ev = ""; return }
    if (name.startsWith("sd")) {
      this.sd = name
      // CG 为全屏事件图，显示时立绘应隐藏
      this.characters = { left: null, center: null, right: null }
    } else if (name.startsWith("ev")) {
      this.ev = name
      // CG 为全屏事件图，显示时立绘应隐藏
      this.characters = { left: null, center: null, right: null }
    }
  }

  /** 立绘列表批量应用（对话节点第4字段） */
  _applyCharList(list) {
    for (const item of list) {
      if (!Array.isArray(item)) continue
      this._applyCharacter(item[0], item[1], item[2], item[3])
    }
  }

  /**
   * 立绘指令。兼容两种格式：
   *  - v1.1 新格式：[角色id_表情, left|center|right, fadein|fadeout|change]
   *  - 存量 KRKR 格式（FreeMote 转换产物）：[角色名, 出|中|左|右|顔|百分比|消, 表情号, 服装]
   * 存量剧本立绘资源未随包提供（旧版 TODO），引擎只维护槽位状态，UI 层无图时自动隐藏。
   */
  _applyCharacter(charKey, slot = "center", action = "change", extra) {
    // v1.1 新格式：位置就是标准槽位
    if (CH_SLOTS.includes(slot)) {
      if (action === "fadeout") {
        this.characters[slot] = null
      } else {
        this.characters[slot] = { key: charKey, action: action || "change" }
      }
      return
    }
    // 存量 KRKR 格式：位置是中文/百分比
    const pos = legacySlot(slot)
    if (pos === null) return // 无法识别的位置，忽略
    if (slot === "消" || action === "fadeout") {
      this.characters[pos] = null
      return
    }
    const key = extra ? `${charKey}_${extra}` : charKey
    this.characters[pos] = { key, action: "change" }
  }

  /** 选项过滤：条件过滤 + 隐藏线入口首周目置灰 */
  _filterOptions(raw) {
    if (!Array.isArray(raw)) return []
    const unlocked = this.clears && this.clears.length > 0
    return raw
      .filter((opt) => {
        if (!Array.isArray(opt)) return false
        const cond = opt[3]
        if (cond === undefined || cond === null || cond === "") return true
        return Boolean(this.vars.evalCondition(cond))
      })
      .map((opt) => {
        const jump = opt[1]
        // 隐藏线入口选项：未通关任意主线时置灰（仍显示但不可选）
        const locked = HIDDEN_OPTION_JUMPS[jump] === true && !unlocked
        return { text: opt[0], jump, exp: opt[2] || "", enabled: !locked }
      })
  }

  /** 设置已通关线（启动时从存储读取后注入） */
  setClears(arr) {
    this.clears = Array.isArray(arr) ? arr.filter(Boolean) : []
  }

  /** 通关标记：更新内存 + 异步写入存储（供主菜单后日谈/隐藏线解锁读取） */
  _recordClear(name) {
    if (!name || this.clears.includes(name)) return
    this.clears.push(name)
    if (this.adapter && typeof this.adapter.storageSet === "function") {
      this.adapter.storageSet("galgod_clears", JSON.stringify(this.clears)).catch(() => {})
    }
  }

  /** 统一结局处理：标记结束、记录通关线（真结局）、toast、通知 UI */
  _finishGame(rawTarget) {
    this.ended = true
    this._toast("游戏结束")
    const t = String(rawTarget || "").toLowerCase()
    for (const key in END_LINE_NAMES) {
      if (t.indexOf(key) !== -1) {
        this._recordClear(END_LINE_NAMES[key])
        break
      }
    }
    this._emit()
  }

  /** 跨场景跳转（选项指向其他场景的标签） */
  async _jumpToScenarioLabel(label) {
    // label 形如 "scnId@label" 或直接 "label"（当前场景）
    if (label.includes("@")) {
      const [scnId, lab] = label.split("@")
      try {
        const data = await this.adapter.readScenario(scnId)
        this.scriptData = Array.isArray(data) ? data : data.content || []
        this.scnId = scnId
        this.lineIndex = this.scriptData.findIndex(
          (n) => n[0] === SCN_TYPE.LABEL && n[1] === lab
        )
        if (this.lineIndex === -1) this.lineIndex = 0
        this._step()
      } catch (e) {
        this._toast("跳转失败: " + label)
      }
    } else {
      this._toast("未找到标签: " + label)
    }
  }

  /** 当前场景结束 → 按内容包 routes 规则推进 */
  _nextScenario() {
    const nextId = this._resolveNextScn(this.scnId)
    if (nextId) {
      this.load(nextId).catch(() => {
        // 下一场景加载失败（如文件名特殊字符）→ 优雅结束，不崩溃
        this.ended = true
        this._toast("游戏结束")
        this._emit()
      })
    } else {
      this.ended = true
      this._toast("游戏结束")
      this._emit()
    }
  }

  /** 解析下一场景：routes 特殊规则 + 默认列表内顺序 */
  _resolveNextScn(currentId) {
    const cfg = this.config
    if (!cfg) return null
    const route = (cfg.routes || {})[currentId]

    if (route) {
      if (route.type === "flagRoute") {
        let best = null
        for (const t of route.targets || []) {
          const score = this.vars.get(t.flag) || 0
          if (best === null || score > best.score) best = { id: t.next, score }
          else if (score === best.score) best.tie = true
        }
        // 全 0 或并列最高 → fallback
        if (!best || best.score === 0 || best.tie) return route.fallback || null
        return best.id
      }
      if (route.type === "next") return route.next || null
    }

    // 默认：在所属列表内顺序推进
    const item = this._findScenario(currentId)
    if (!item) return null
    const list = cfg.scenarios[item.listName] || []
    const idx = list.findIndex((s) => s.id === currentId)
    const next = list[idx + 1]
    return next ? next.id : null
  }

  _findScenario(id) {
    const cfg = this.config
    if (!cfg) return null
    for (const listName of Object.keys(cfg.scenarios || {})) {
      const item = (cfg.scenarios[listName] || []).find((s) => s.id === id)
      if (item) return { ...item, listName }
    }
    return null
  }

  _applySavedState(saved) {
    if (saved.flags) this.vars.reset(saved.flags)
    if (saved.bg) this.bg = saved.bg
    if (saved.speaker !== undefined) this.speaker = saved.speaker
    if (saved.fullText !== undefined) this.fullText = saved.fullText
    if (saved.chapterName) this.chapterName = saved.chapterName
    if (saved.characters) this.characters = JSON.parse(JSON.stringify(saved.characters))
    this.isTextComplete = true // 读档后全文立即可见
    this._skipNextDialogueInit = true // 下一对话节点保留存档态
    if (this.audio && saved.audio) this.audio.restore(saved.audio)
    this._pendingSaved = null
  }

  _scheduleFF(delay = FAST_FORWARD_DELAY) {
    this.clearFastForward()
    this.fastForwardTimer = setTimeout(() => {
      if (!this.isFastForwarding) return
      this.advance()
      if (this.isFastForwarding) this._scheduleFF()
    }, delay)
  }

  _emit() {
    this.onState({
      scnId: this.scnId,
      lineIndex: this.lineIndex,
      speaker: this.speaker,
      fullText: this.fullText,
      isTextComplete: this.isTextComplete,
      bg: this.bg,
      sd: this.sd,
      ev: this.ev,
      chapterName: this.chapterName,
      characters: this.characters,
      options: this.options,
      showOptions: this.showOptions,
      isSkipping: this.isSkipping,
      isFastForwarding: this.isFastForwarding,
      ended: this.ended
    })
  }

  _toast(msg) {
    if (this.adapter && this.adapter.toast) this.adapter.toast(msg)
  }
}

export default ScriptRuntime
