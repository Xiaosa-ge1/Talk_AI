"use client";

import type { InterviewReport } from "@/lib/types";

/**
 * 报告展示（纯渲染，便于测试）：
 * 一句话总评 → 维度条形 → 重点改进 3 处（含重答入口）→ 说得好的 1 处。
 */

interface ReportViewProps {
  report: InterviewReport;
  /** 点击「重答这题」回调（传入该问题的文本） */
  onRetryQuestion: (question: string) => void;
}

const DIM_COLORS: Record<string, string> = {
  logic: "bg-primary",
  depth: "bg-[#4c9aff]",
  data: "bg-[#7cb3ff]",
  agility: "bg-[#a8c9ff]",
};

export function ReportView({ report, onRetryQuestion }: ReportViewProps) {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8">
      {/* 总评 */}
      <section className="rounded-2xl border border-border bg-white p-6">
        <div className="text-[13px] font-medium text-ink-secondary">本次面试复盘</div>
        <p className="mt-2 text-[20px] font-semibold leading-8 text-ink">{report.summary}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {report.improvements.length === 0 && (
            <span className="rounded-full bg-primary-soft px-3 py-1 text-[12px] font-medium text-primary">
              ✨ 没有明显硬伤，继续保持
            </span>
          )}
          <span className="rounded-full bg-soft-gray px-3 py-1 text-[12px] text-ink-secondary">
            {new Date(report.createdAt).toLocaleString("zh-CN")}
          </span>
        </div>
      </section>

      {/* 维度条形 */}
      {report.dimensions.length > 0 && (
        <section className="mt-4 rounded-2xl border border-border bg-white p-6">
          <h3 className="text-[15px] font-semibold text-ink">维度评估</h3>
          <ul className="mt-4 space-y-3">
            {report.dimensions.map((d) => (
              <li key={d.key}>
                <div className="flex items-center justify-between text-[13px]">
                  <span className="font-medium text-ink">{d.label}</span>
                  <span className="text-ink-secondary">{d.score} / 5</span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-soft-gray">
                  <div
                    className={`h-full rounded-full ${DIM_COLORS[d.key] ?? "bg-primary"}`}
                    style={{ width: `${(d.score / 5) * 100}%` }}
                  />
                </div>
                {d.comment && <p className="mt-1 text-[12px] text-ink-muted">{d.comment}</p>}
                {/* 评分依据：LLM 引用的对话原句，让分数可人工核验 */}
                {d.evidence && (
                  <p className="mt-1.5 border-l-2 border-border pl-2.5 text-[12px] leading-5 text-ink-muted">
                    <span className="text-ink-secondary">评分依据：</span>“{d.evidence}”
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 重点改进 3 处 */}
      {report.improvements.length > 0 && (
        <section className="mt-4 rounded-2xl border border-border bg-white p-6">
          <h3 className="text-[15px] font-semibold text-ink">
            最该改进的 {report.improvements.length} 处
          </h3>
          <ul className="mt-3 space-y-5">
            {report.improvements.map((imp, i) => (
              <li key={i} className="border-t border-border pt-4 first:border-t-0 first:pt-0">
                <div className="text-[13px] text-ink-secondary">问题：{imp.question}</div>
                {imp.yourAnswer && (
                  <p className="mt-1 text-[13px] leading-5 text-ink-muted">
                    <span className="text-ink-muted">你的回答：</span>
                    {imp.yourAnswer}
                  </p>
                )}
                <div className="mt-2 rounded-lg bg-soft-orange px-3 py-2 text-[13px] leading-5 text-ink">
                  <span className="font-medium">问题点：</span>
                  {imp.issue}
                </div>
                {imp.suggestion && (
                  <p className="mt-2 text-[13px] leading-5 text-ink-secondary">
                    <span className="font-medium text-ink">改进建议：</span>
                    {imp.suggestion}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => onRetryQuestion(imp.question)}
                  className="mt-2 rounded-lg border border-primary/40 px-3 py-1.5 text-[12px] font-medium text-primary transition-colors hover:bg-primary-soft"
                >
                  🎤 重答这题
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 说得好的 1 句（鼓励优先） */}
      {report.highlight.quote && (
        <section className="mt-4 rounded-2xl bg-soft-blue p-6">
          <h3 className="text-[15px] font-semibold text-ink">说得好的 1 句</h3>
          <p className="mt-2 rounded-xl bg-white px-4 py-3 text-[14px] italic leading-6 text-ink">
            “{report.highlight.quote}”
          </p>
          <p className="mt-2 text-[13px] leading-5 text-ink-secondary">{report.highlight.praise}</p>
        </section>
      )}
    </div>
  );
}
