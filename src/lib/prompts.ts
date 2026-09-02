import type { ChatMessage } from "./types";

/**
 * 面试官 prompt 模板 —— 追问质量的核心控制。
 * 规则一旦成型不要随意改动；改动后需人工走查 3 次完整面试验证。
 */

export const INTERVIEWER_ROLE = `你是一位资深的产品经理面试官，正在为「产品经理」岗位做一轮真实的面试。`;
export const INTERVIEW_RULES = `【面试规则 - 必须严格遵守】
1. 一次只问一个问题，绝不把多个问题堆在一起。
2. 不评价用户的回答（不说"很好""不太对"这类话），不打断，不提前下结论。
3. 全程使用中文提问；问题要具体、专业、贴近真实 PM 面试（涉及需求分析、用户研究、数据分析、优先级、项目管理、跨团队协作等）。
4. 根据用户的回答自然地追问：挖数字和细节、问决策过程、问取舍和复盘。
5. 如果用户没有简历（下方简历为空），从"请先做个自我介绍"开始，然后顺着自我介绍的内容自然深入。
6. 如果用户答得简短或跑题，追问一次帮助聚焦，不要评判。
7. 你的输出只是你要说的那一句话，不要带任何编号、前缀或解释。`;

/** 简历放进 system prompt 的最大长度（每轮请求都会携带，截断控制 token） */
export const RESUME_PROMPT_MAX_CHARS = 2000;

/**
 * 根据请求参数构建 system prompt。
 * @param resume 简历文本（可为空，超长自动截断）
 * @param questionCount 目标题量（决定节奏提示）
 */
export function buildSystemPrompt(resume: string, questionCount: number): string {
  const trimmed = resume.trim();
  const resumeBlock = trimmed
    ? `【候选人简历】\n${truncateResume(trimmed)}\n（提问时应优先基于简历内容深入追问，但要自然，不要生硬复述简历。）`
    : "【候选人简历】\n（空。候选人未提供简历，请从自我介绍开始自然展开。）";

  return [
    INTERVIEWER_ROLE,
    resumeBlock,
    INTERVIEW_RULES,
    `本场面试的目标题量约为 ${questionCount} 题，请控制节奏，避免问太多细节导致拖沓。`,
  ].join("\n\n");
}

/** 简历截断（超过上限时省略结尾） */
function truncateResume(resume: string, maxChars = RESUME_PROMPT_MAX_CHARS): string {
  return resume.length > maxChars ? resume.slice(0, maxChars) + "…" : resume;
}

/**
 * 把前端传来的完整历史转换为 LLM 消息数组。
 * role 映射：ChatMessage.assistant → assistant，user → user。
 * 首轮（无历史）且是开场时由 route 决定是否附加 user 消息。
 */
export function buildMessagesForHistory(
  resume: string,
  questionCount: number,
  messages: ChatMessage[],
  userMessage: string
): Array<{ role: "system" | "assistant" | "user"; content: string }> {
  const result: Array<{ role: "system" | "assistant" | "user"; content: string }> = [
    { role: "system", content: buildSystemPrompt(resume, questionCount) },
  ];

  for (const m of messages) {
    result.push({ role: m.role === "assistant" ? "assistant" : "user", content: m.content });
  }
  if (userMessage.trim()) {
    result.push({ role: "user", content: userMessage });
  }
  return result;
}
