/**
 * 浏览器朗读（SpeechSynthesis）封装 —— 音色选择与支持性探测是纯逻辑（可单测），
 * 实际 speak/cancel 是浏览器全局能力，由 useAssistantSpeech 经窄接口注入使用。
 */

/** 测试可注入的合成器窄接口（对应 window.speechSynthesis 的最小面） */
export interface SpeechSynthLike {
  getVoices(): SpeechSynthesisVoice[];
  speak(utterance: SpeechSynthesisUtterance): void;
  cancel(): void;
}

/** 当前环境是否支持朗读（浏览器 + speechSynthesis） */
export function isSpeechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/**
 * 从可用音色里挑中文音色：优先神经/在线音色（Edge 的 Xiaoxiao/Yunxi 等），
 * 否则任意 zh 音色；无中文音色返回 null（浏览器会用默认语言读，效果差）。
 */
export function pickZhVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const zh = voices.filter((v) => v.lang?.toLowerCase().startsWith("zh"));
  if (zh.length === 0) return null;
  const neural = zh.find((v) => /neural|xiaoxiao|yunxi|xiaoyi|xiaochen|hanxiao/i.test(v.name));
  return neural ?? zh[0];
}
