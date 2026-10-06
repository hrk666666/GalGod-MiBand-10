/**
 * fxManager.js — 特效管理器
 *
 * 平台无关的"特效请求"通道：剧本发出特效指令，UI 层订阅 onFx 回调
 * 并实现具体动画（@keyframes / transition / 振动）。这样特效实现
 * 完全在 UI 层，引擎只负责触发与排队。
 *
 * 内置特效（格式 v1.1 节点 9）：
 *  - whiteflash 白闪（转场/事件）
 *  - blackout   黑幕（进入章节）
 *  - fadein     画面淡入
 *  - fadeout    画面淡出
 *  - vibrate    振动反馈（手环短振）
 */

export const FX_NAMES = ["whiteflash", "blackout", "fadein", "fadeout", "vibrate"]

export class FxManager {
  /**
   * @param {Object} deps
   * @param {Function} deps.onFx  特效回调 (name, param) => void（UI 实现）
   * @param {Function} deps.vibrate 振动函数（可选，适配器注入）
   */
  constructor({ onFx, vibrate } = {}) {
    this.onFx = onFx || (() => {})
    this.vibrate = vibrate || null
    this._queue = []
    this._running = false
  }

  /**
   * 触发特效
   * @param {string} name 特效名
   * @param {number|string} param 时长(ms) 或参数
   */
  trigger(name, param) {
    if (name === "vibrate") {
      if (this.vibrate) this.vibrate()
      return
    }
    this._queue.push({ name, param })
    this._drain()
  }

  _drain() {
    if (this._running || this._queue.length === 0) return
    this._running = true
    const { name, param } = this._queue.shift()
    // 返回 Promise 表示 UI 可异步完成（动画结束再放行下一条）
    const ret = this.onFx(name, param)
    if (ret && typeof ret.then === "function") {
      ret.then(() => {
        this._running = false
        this._drain()
      })
    } else {
      this._running = false
      this._drain()
    }
  }

  clear() {
    this._queue = []
    this._running = false
  }
}

export default FxManager
