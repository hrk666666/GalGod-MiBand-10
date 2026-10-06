export const DEBUG = false
export const SETTINGS_KEY = "settings"
export const SAVE_KEY = "user_save_data"
export const AUTO_SAVE_KEY = "auto_save_data"
export const CLEARS_KEY = "galgod_clears"

// 本作是「单主线 + 结尾分流」结构，没有《千恋＊万花》那样的多条角色线。
// 后日谈只有一个（后日谈 · 诺提拉），由剧本自身的 true_end_finish 变量解锁：
// 剧本在 [6,"L5158"] 处判断 f.true_end_finish == 1，成立才进入后日谈段。
// 因此这里只记录「后日谈段在剧本流里的起点标签」，由引擎按标签跳转。
// 场景列表由内容包 src/common/game.txt 驱动（引擎 data-driven）。

// 后日谈入口：跳到剧本里该标签所在位置
export const AFTER_STORY = {
  name: "诺提拉",
  label: "L5158"
}

// 场景分块：chunk001.txt …（每块约 500 节点，由 tools/convert_galgod.py 生成）

// 剧本节点类型
export const SCN_TYPE = {
  LABEL: 0, // 标签/跳转点 [0, "label_name"]
  CHAPTER_TITLE: 1, // 章节标题 [1, "章节标题"]
  BACKGROUND: 2, // 背景切换 [2, "bg_name"]
  DIALOGUE: 3, // 对话 [3, "说话人", "内容", [立绘列表]] // 立绘列表可空
  SELECT: 4, // 选项 [4, [["文字", "跳转", "表达式", "条件"]]]
  EV: 5, // 事件CG [5, "ev_img_name"]
  NEXT: 6, // 跳转 [6, "target_label", "条件?"]
  CHARACTER: 7, // 立绘 [7, "角色id_表情", "left|center|right", "fadein|fadeout|change"]
  MUSIC: 8, // 音乐 [8, "曲名", "bgm|se", "loop|once"]
  FX: 9, // 特效 [9, "whiteflash|...", 时长]
  VAR: 10 // 变量 [10, "f.x += 1"]
}
