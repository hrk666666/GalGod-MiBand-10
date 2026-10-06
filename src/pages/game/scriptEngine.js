import { DEBUG, SCN_TYPE } from "../../common/constants.js"
import prompt from "@system.prompt"

const fastForwardDelay = 50

export default {
  // 更新EV/SD
  updateEV(evImage) {
    if (evImage === null) {
      this.currentEV = this.currentSD = "" // 收到null信号则清空
      if (DEBUG) console.log("[Game/Engine] EV 播放结束")
    } else if (evImage.startsWith("ev")) {
      // TODO: EV实现
      // this.currentEV = evImage
      if (DEBUG) console.log("[Game/Engine] 播放事件CG：" + evImage)
    } else if (evImage.startsWith("sd")) {
      this.currentSD = evImage
      if (DEBUG) console.log("[Game/Engine] 播放SD：" + evImage)
    } else {
      if (DEBUG) console.log("[Game/Engine] 其他事件CG：" + evImage)
    }
  },

  // 更新背景
  updateBackground(bg) {
    this.currentBg = bg
    if (DEBUG) console.log("[Game/Engine] 背景更新：" + bg)
  },

  // 更新章节标题
  updateChapterTitle(title, showToast = false) {
    this.currentChapterName = title

    if (DEBUG && showToast) {
      console.log("[Game/Engine] 读取到新章节名称: " + this.currentChapterName)

      prompt.showToast({
        message: this.currentChapterName,
        duration: 2000
      })
    }
  },

  // 跳过到下一个选项
  skipUntilSelect() {
    // 如果还未进入下一条剧本，直接返回
    if (!this.scriptData || this.scriptData.length === 0) return

    this.currentEV = this.currentSD = ""

    this.isSkipping = true

    let lastDialogueNode = null

    while (this.currentLineIndex < this.scriptData.length) {
      const node = this.scriptData[this.currentLineIndex]
      const type = node[0]
      const content = node[1]

      switch (type) {
        case SCN_TYPE.SELECT:
          // 停止前，同步最后一句对话内容
          if (lastDialogueNode) {
            this.currentSpeaker = lastDialogueNode[1] || ""
            this.fullText = lastDialogueNode[2] || ""
            this.displayText = this.fullText
            this.isTextComplete = true
          }

          this.isSkipping = false
          this.currentOptions = content
          this.showOptions = true

          // 渲染文本为最后一行对话
          this.isTextComplete = true
          if (DEBUG) console.log("[Game/Engine] 快进停止于选项")
          return // 停止跳过

        // 抓取文本
        case SCN_TYPE.DIALOGUE:
          lastDialogueNode = node
          break

        case SCN_TYPE.BACKGROUND:
          // 更新背景防止错乱
          this.updateBackground(content)
          break

        case SCN_TYPE.CHAPTER_TITLE:
          // 更新章节名称
          this.updateChapterTitle(content, false)
          break

        case SCN_TYPE.EV:
          // 更新EV
          this.updateEV(content)
          break

        default:
          break
      }

      this.currentLineIndex++
    }

    // 如果循环结束还没找到选项，说明本章节结束了
    if (this.currentLineIndex >= this.scriptData.length) {
      this.goToNextScenario()
    }
  },

  showLine() {
    if (!this.scriptData || this.scriptData.length === 0) {
      if (DEBUG) console.warn("[Game/Engine] 等待剧本加载...")
      return
    }

    // 新一句开始，清掉可能残留的自动播放计时
    this.clearAutoPlayTimer()

    // 跨章节连续跳过
    if (this.isSkipping) {
      this.skipUntilSelect()
      return
    }

    const node = this.scriptData[this.currentLineIndex]

    if (!node) {
      this.goToNextScenario()
      return
    }

    const type = node[0]
    const content = node[1]

    switch (type) {
      case SCN_TYPE.BACKGROUND:
        this.updateBackground(content)
        this.currentLineIndex++
        this.showLine()
        break

      case SCN_TYPE.DIALOGUE:
        this.currentSpeaker = content || ""
        this.fullText = node[2] || ""

        // 立绘更新 (数组长度大于3说明有立绘数据)
        // TODO: 立绘实现
        // if (node.length > 3) {
        //   this.currentCharacters = node[3];
        // }

        // 新对话出现时触发节流自动保存
        this.maybeAutoSave()

        this.displayText = ""
        this.isTextComplete = false
        this.currentCharIndex = 0

        if (this.isFastForwarding) {
          // 快进时直接显示完整文字
          this.displayText = this.fullText
          this.isTextComplete = true
          this.clearFastForwardTimer()

          // 延迟fastForwardDelay后跳转到下一句
          this.fastForwardTimer = setTimeout(() => {
            this.currentLineIndex++
            this.showLine()
          }, fastForwardDelay)
        } else {
          this.showTypeWriterEffect()
        }
        break

      case SCN_TYPE.SELECT:
        this.currentOptions = content
        this.showOptions = true
        break

      case SCN_TYPE.CHAPTER_TITLE:
        this.updateChapterTitle(content)
        this.currentLineIndex++
        this.showLine()
        break

      case SCN_TYPE.NEXT:
        const targetLabel = content
        const jumpIndex = this.scriptData.findIndex(
          (item) => item[0] === SCN_TYPE.LABEL && item[1] === targetLabel
        )

        if (jumpIndex !== -1) {
          this.currentLineIndex = jumpIndex
          if (DEBUG) console.info("[Game/Engine] 跳转至节点：" + targetLabel)
          this.showLine()
        } else {
          if (DEBUG) console.error("[Game/Engine] 跳转目标未找到：" + targetLabel)
          this.currentLineIndex++
          this.showLine()
        }
        break

      case SCN_TYPE.LABEL:
        this.currentLineIndex++
        this.showLine()
        break

      case SCN_TYPE.EV:
        this.updateEV(content)
        this.currentLineIndex++
        this.showLine()
        break

    }
  },

  // 点击快进时
  doFastForward() {
    // 显示选项时不允许快进
    if (this.showOptions) return

    // 滚动滚轮至顶部
    const scroll = this.$element("dialogueScroll")
    if (scroll) {
      scroll.scrollTo({ top: 0, behavior: "instant" })
    }

    this.isFastForwarding = true

    if (this.isTextComplete) {
      // 如果当前句子已经播放完成则立即进入下一句
      this.currentLineIndex++
      this.showLine()
    } else {
      // 如果还没播完则直接完成文本，停止打字机，并启动自动下一句
      this.displayText = this.fullText
      this.isTextComplete = true
      this.clearTimer()

      this.clearFastForwardTimer()
      this.fastForwardTimer = setTimeout(() => {
        this.currentLineIndex++
        this.showLine()
      }, 20)
    }
  },

  stopFastForward() {
    this.isFastForwarding = false
    this.clearFastForwardTimer()
  },

  // 自动播放：整句显示完后延迟 500ms 自动进入下一句
  autoPlayNext() {
    if (!this.isAutoPlay) return
    if (this.showOptions || this.isSkipping || this.isFastForwarding) return

    if (this.currentLineIndex < this.scriptData.length - 1) {
      this.currentLineIndex++
      this.showLine()
    } else {
      this.goToNextScenario()
    }
  },

  clearAutoPlayTimer() {
    if (this.autoPlayTimer) {
      clearTimeout(this.autoPlayTimer)
      this.autoPlayTimer = null
    }
  },

  clearFastForwardTimer() {
    if (this.fastForwardTimer) {
      clearTimeout(this.fastForwardTimer)
      this.fastForwardTimer = null
    }
  }
}