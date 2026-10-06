/**
 * saveSystem.js — 存档系统（多槽位）
 *
 * 平台无关。存储介质通过 adapter 注入：
 *  - AIoT：storage 键值（键内 JSON）
 *  - Node/PC：内存 Map（可替换为文件）
 */

const DEFAULT_SLOTS = 4

export class SaveSystem {
  /**
   * @param {Object} deps
   * @param {Object} deps.adapter 平台适配（storageGet/storageSet）
   * @param {number} deps.slotCount 槽位数
   */
  constructor({ adapter, slotCount = DEFAULT_SLOTS }) {
    this.adapter = adapter
    this.slotCount = slotCount
  }

  _key(slot) {
    return `save_slot_${slot}`
  }

  /** 保存到槽位（返回存档摘要供列表展示） */
  async save(slot, state, meta = {}) {
    if (slot < 0 || slot >= this.slotCount) throw new Error("slot out of range")
    const record = {
      slot,
      savedAt: Date.now(),
      meta: meta || {},
      state
    }
    await this.adapter.storageSet(this._key(slot), JSON.stringify(record))
    return record
  }

  /** 读取槽位，无存档返回 null */
  async load(slot) {
    const raw = await this.adapter.storageGet(this._key(slot))
    if (!raw) return null
    try {
      const record = JSON.parse(raw)
      return record.state || null
    } catch (e) {
      return null
    }
  }

  /** 槽位摘要列表（标题/时间/场景） */
  async list() {
    const out = []
    for (let i = 0; i < this.slotCount; i++) {
      const raw = await this.adapter.storageGet(this._key(i))
      if (!raw) {
        out.push({ slot: i, empty: true })
        continue
      }
      try {
        const record = JSON.parse(raw)
        out.push({
          slot: i,
          empty: false,
          savedAt: record.savedAt,
          meta: record.meta || {}
        })
      } catch (e) {
        out.push({ slot: i, empty: true })
      }
    }
    return out
  }

  async remove(slot) {
    await this.adapter.storageSet(this._key(slot), "")
  }
}

export default SaveSystem
