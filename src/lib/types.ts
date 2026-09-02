/**
 * 共享类型定义 —— 本项目所有 TS 类型的唯一来源。
 * 前端组件、store、API route 都从这里导入，禁止在别处重复定义。
 */

export type MessageRole = "assistant" | "user";

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: number;
}

/** 面试进行状态 */
export type InterviewStatus = "in_progress" | "completed";

/** 报告维度键（PM 面试核心评估维度） */
export type DimensionKey = "logic" | "depth" | "data" | "agility";

export interface DimensionScore {
  key: DimensionKey;
  /** 维度显示名，如「表达逻辑」 */
  label: string;
  /** 1–5 分 */
  score: number;
  /** 一句话点评 */
  comment: string;
}

/** 重点改进项（原题 → 你的回答 → 问题 → 建议） */
export interface ImprovementItem {
  question: string;
  yourAnswer: string;
  issue: string;
  suggestion: string;
}

/** 说得好的 1 处（正反馈优先原则） */
export interface Highlight {
  question: string;
  quote: string;
  praise: string;
}

/** 面试报告（会话结束后由 /api/report 生成的结构化结果） */
export interface InterviewReport {
  /** 一句话总评（鼓励优先） */
  summary: string;
  dimensions: DimensionScore[];
  /** 重点改进，按影响排序，最多 3 处 */
  improvements: ImprovementItem[];
  highlight: Highlight;
  createdAt: number;
}

/** 一次完整面试会话 */
export interface InterviewSession {
  id: string;
  /** 解析后的简历文本（跳过简历时为空字符串） */
  resume: string;
  /** 用户设定的目标题量 */
  questionCount: number;
  status: InterviewStatus;
  messages: ChatMessage[];
  report: InterviewReport | null;
  createdAt: number;
  updatedAt: number;
}

/** 首页创建面试时前端提交的参数 */
export interface StartInterviewInput {
  resume: string;
  questionCount: number;
}

/** /api/chat 的请求体（无状态：会话历史由前端随请求携带） */
export interface ChatRequestBody {
  /** 解析后的简历文本（无简历时为空字符串） */
  resume: string;
  /** 完整对话历史（含 AI 提问与用户作答，不含本轮 userMessage） */
  messages: ChatMessage[];
  /** 目标题量（用于开场与节奏提示） */
  questionCount: number;
  /** 用户本轮的回答文本 */
  userMessage: string;
}

/** /api/chat 的流式事件类型 */
export type ChatStreamEvent =
  | { type: "text"; delta: string }
  | { type: "done"; messageId: string }
  | { type: "error"; message: string };

/** /api/report 的请求体（无状态：由前端携带完整问答） */
export interface ReportRequestBody {
  /** 解析后的简历文本 */
  resume: string;
  /** 完整对话历史 */
  messages: ChatMessage[];
  /** 目标题量（展示用） */
  questionCount: number;
}

/** /api/report 的流式事件类型（生成进度 + 最终报告） */
export type ReportStreamEvent =
  /** LLM 生成的原始文本增量（用于估算进度，不直接展示） */
  | { type: "text"; delta: string }
  /** 完成：携带最终结构化报告 */
  | { type: "done"; report: InterviewReport }
  | { type: "error"; message: string };

/** 简历解析结果 */
export interface ParseResumeResult {
  /** 提取出的纯文本（换行归一化） */
  text: string;
  /** 来源文件类型 */
  source: "pdf" | "docx" | "text";
  /** 字符数 */
  charCount: number;
}
