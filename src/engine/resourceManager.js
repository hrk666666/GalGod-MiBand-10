/**
 * resourceManager.js — 资源管理器
 *
 * 平台无关。职责：
 *  - 按内容包配置解析资源 URI（背景/事件图/立绘/音频）
 *  - 从剧本数据扫描资源引用，产出"场景预加载清单"（懒加载/体积治理）
 *  - 提供 URI 归一化接口，UI 层据此渲染 image 组件
 */

export const RES_TYPES = {
  bg: { dir: "bg", ext: "jpg" },
  sd: { dir: "sd", ext: "png" },
  ev: { dir: "ev", ext: "jpg" },
  ch: { dir: "ch", ext: "png" },
  audio: { dir: "audio", ext: "mp3" }
}

export class ResourceManager {
  /**
   * @param {Object} config 内容包 resources 配置：
   *   { base: "/common", bg: "bg", sd: "sd", ev: "ev", ch: "ch", audio: "audio" }
   */
  constructor(config = {}) {
    this.base = config.base || "/common"
    this.dirs = Object.assign(
      { bg: "bg", sd: "sd", ev: "ev", ch: "ch", audio: "audio" },
      config.dirs || config
    )
  }

  /** 资源 URI：uri("bg", "moon") -> "/common/bg/moon.jpg" */
  uri(type, name) {
    const t = RES_TYPES[type] || RES_TYPES.bg
    const dir = this.dirs[type] || t.dir
    return `${this.base}/${dir}/${name}.${t.ext}`
  }

  /** 剧本内引用（供预加载清单） */
  scanScript(scriptData) {
    const refs = { bg: new Set(), sd: new Set(), ev: new Set(), ch: new Set(), audio: new Set() }
    if (!Array.isArray(scriptData)) return refs
    for (const node of scriptData) {
      if (!Array.isArray(node)) continue
      const t = node[0]
      switch (t) {
        case 2: // 背景
          if (node[1]) refs.bg.add(node[1])
          break
        case 3: // 对话内立绘
          if (Array.isArray(node[3])) {
            for (const item of node[3]) {
              if (Array.isArray(item) && item[0]) refs.ch.add(item[0])
            }
          }
          break
        case 5: // 事件 CG / 立绘差分
          if (node[1]) {
            // sd* → sd/ 目录（立绘差分，PNG）
            // ev* / cg* → ev/ 目录（事件 CG，JPEG）
            if (node[1].startsWith("sd")) refs.sd.add(node[1])
            else refs.ev.add(node[1])
          }
          break
        case 7: // 立绘指令
          if (node[1]) refs.ch.add(node[1])
          break
        case 8: // 音乐
          if (node[1]) refs.audio.add(node[1])
          break
        default:
          break
      }
    }
    return refs
  }

  /** 场景预加载清单（URI 数组，供 UI 提前加载） */
  preloadList(scriptData) {
    const refs = this.scanScript(scriptData)
    const out = []
    for (const type of ["bg", "sd", "ev", "ch"]) {
      for (const name of refs[type]) out.push(this.uri(type, name))
    }
    return out
  }
}

export default ResourceManager
