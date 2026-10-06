// 短振动反馈工具（手环 9/10/11 均支持 vibrator.vibrate；start/stop 仅 S5 支持，不使用）
import vibrator from "@system.vibrator"

export function vibrateShort() {
  try {
    vibrator.vibrate({ mode: "short" })
  } catch (e) {
    // 设备不支持时静默失败，不影响功能
  }
}
