/**
 * audioManager.js — 音频管理器（单播放器通道策略）
 *
 * Vela 快应用 audio 是单实例：同一时刻只能播放一个声音。
 * 策略：
 *  - BGM：直接切换（旧曲停、新曲 loop）
 *  - 音效（SE）：若 BGM 在播，暂停 BGM → 播 SE → SE ended 后恢复 BGM
 *  - 音量统一管理，供设置页使用
 *
 * 通过 adapter.audio 接口操作底层（AIoT 为 @system.audio，Node 为 mock）。
 */

export class AudioManager {
  /**
   * @param {Object} deps
   * @param {Object} deps.adapterAudio 平台音频接口：
   *   play(src, {loop}) / pause() / stop() / setVolume(v) / onEnded(cb) / getState()
   * @param {number} deps.volume 初始音量 0~1
   */
  constructor({ adapterAudio, volume = 1 }) {
    this.audio = adapterAudio
    this.volume = volume
    this.currentBgm = null
    this.currentSe = null
    this._seResumeBgm = null // SE 打断的 BGM，结束后恢复
    if (this.audio && this.audio.onEnded) {
      this.audio.onEnded(() => this._onEnded())
    }
  }

  /**
   * 播放音乐
   * @param {string} name 资源名（不带扩展名）
   * @param {string} kind "bgm" | "se"
   * @param {string} mode "loop" | "once"
   */
  play(name, kind = "bgm", mode = "loop") {
    if (!name || !this.audio) return
    if (kind === "se") {
      this._playSe(name)
    } else {
      this._playBgm(name, mode === "once")
    }
  }

  _playBgm(name, once = false) {
    // 若有 SE 在播，先停掉
    if (this.currentSe) {
      this.audio.stop()
      this.currentSe = null
    }
    this.currentBgm = name
    this.audio.play(name, { loop: !once })
  }

  _playSe(name) {
    // 单通道：记录当前 BGM，暂停，播 SE
    if (this.currentBgm && !this.currentSe) {
      this._seResumeBgm = this.currentBgm
      this.audio.pause()
    }
    this.currentSe = name
    this.audio.play(name, { loop: false })
  }

  _onEnded() {
    // SE 播完 → 恢复被暂停的 BGM
    if (this.currentSe) {
      this.currentSe = null
      if (this._seResumeBgm) {
        const resume = this._seResumeBgm
        this._seResumeBgm = null
        this.currentBgm = resume
        this.audio.play(resume, { loop: true })
      }
    }
  }

  stopAll() {
    this.currentBgm = null
    this.currentSe = null
    this._seResumeBgm = null
    if (this.audio) this.audio.stop()
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v))
    if (this.audio) this.audio.setVolume(this.volume)
  }

  /** 存档快照 */
  snapshot() {
    return { bgm: this.currentBgm, se: this.currentSe }
  }

  /** 读档恢复 */
  restore(snap) {
    if (!snap) return
    this.stopAll()
    if (snap.bgm) this._playBgm(snap.bgm)
  }
}

export default AudioManager
