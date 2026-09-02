"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { getSession, saveSession } from "@/lib/store";
import { completeSession } from "@/lib/session";
import { streamReport } from "@/lib/report-client";
import { ReportView } from "./ReportView";
import type { InterviewSession } from "@/lib/types";

type Phase = "loading" | "generating" | "ready" | "error";

/** 报告生成进度状态（用于进度条展示） */
interface GenProgress {
  /** 0-100 估算进度 */
  percent: number;
  /** 已生成字符数 */
  chars: number;
}

/**
 * 报告页：?id=<sessionId>&generate=1
 * - 会话已有报告 → 直接展示（历史回看）
 * - generate=1 且无报告 → 流式生成（SSE）并落库
 * 「重答这题」→ 用该问题开一个新会话（不带简历上下文则复用原简历）
 */
export function ReportPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("id");
  const generate = searchParams.get("generate") === "1";

  const [session, setSession] = useState<InterviewSession | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [progress, setProgress] = useState<GenProgress>({ percent: 0, chars: 0 });
  const generatedRef = useRef(false);

  // 加载会话并按需生成报告
  useEffect(() => {
    if (!sessionId) return;
    void getSession(sessionId).then(async (s) => {
      if (!s) {
        router.replace("/");
        return;
      }
      setSession(s);
      if (s.report) {
        setPhase("ready");
        return;
      }
      if (!generate || generatedRef.current) {
        setPhase("error");
        setErrorMsg("这份面试还没有生成报告。");
        return;
      }
      // 生成报告（流式，实时更新进度）
      generatedRef.current = true;
      setPhase("generating");
      setProgress({ percent: 0, chars: 0 });
      try {
        await streamReport(
          { resume: s.resume, messages: s.messages, questionCount: s.questionCount },
          {
            onText: (delta) => {
              setProgress((prev) => {
                const chars = prev.chars + delta.length;
                // 报告全文约 1200-1500 字；按 1600 估算，封顶 95%
                const percent = Math.min(95, Math.round((chars / 1600) * 100));
                return { percent, chars };
              });
            },
            onDone: (report) => {
              const done = completeSession(s, report);
              setSession(done);
              void saveSession(done);
              setProgress({ percent: 100, chars: 0 });
              setPhase("ready");
            },
            onError: (msg) => {
              setPhase("error");
              setErrorMsg(msg);
            },
          }
        );
      } catch {
        setPhase("error");
        setErrorMsg("网络异常，报告生成失败，请重试");
      }
    });
  }, [sessionId, generate, router]);

  const handleRetry = useCallback(
    (question: string) => {
      if (!session) return;
      // 重答：复用同一简历开新会话，URL 携带 seed 问题
      const params = new URLSearchParams();
      if (session.resume) params.set("resume", session.resume);
      if (question) params.set("seed", question);
      router.push(`/interview?${params.toString()}`);
    },
    [session, router]
  );

  if (!session) {
    return <div className="p-8 text-center text-ink-secondary">加载中…</div>;
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-ink-muted hover:text-ink" aria-label="返回首页">
              ←
            </Link>
            <span className="text-[14px] font-semibold text-ink">面试报告</span>
          </div>
          <Link
            href="/"
            className="rounded-lg border border-border px-3 py-1.5 text-[13px] font-medium text-ink transition-colors hover:border-primary/50 hover:text-primary"
          >
            再来一次
          </Link>
        </div>
      </header>

      <main>
        {phase === "generating" && (
          <div className="mx-auto flex w-full max-w-md flex-col items-center justify-center px-4 py-24 text-center">
            {/* 真实进度条（由 LLM 文本增量驱动） */}
            <div className="w-full">
              <div className="flex items-baseline justify-between">
                <span className="text-[14px] font-semibold text-ink">AI 正在撰写你的面试报告</span>
                <span className="text-[13px] font-medium text-primary">{progress.percent}%</span>
              </div>
              <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-soft-gray">
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-200 ease-out"
                  style={{ width: `${Math.max(progress.percent, 4)}%` }}
                  role="progressbar"
                  aria-valuenow={progress.percent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                />
              </div>
            </div>

            {/* 阶段文案：按进度切换，让用户知道当前在做什么 */}
            <p className="mt-6 text-[14px] leading-6 text-ink-secondary">
              {progress.percent < 8
                ? "正在通读你的面试对话…"
                : progress.percent < 40
                  ? "正在评估表达与回答质量…"
                  : progress.percent < 70
                    ? "正在逐题诊断，找出最该改进的地方…"
                    : "正在收尾，润色鼓励与建议…"}
            </p>
            {progress.chars > 0 && (
              <p className="mt-2 text-[12px] text-ink-muted">
                已生成 {progress.chars.toLocaleString()} 字 · 通常需要 20~40 秒，请稍候
              </p>
            )}
            {progress.percent < 8 && (
              <p className="mt-2 text-[12px] text-ink-muted">首次生成约需 3~10 秒思考时间</p>
            )}
          </div>
        )}

        {phase === "error" && (
          <div className="mx-auto max-w-md px-4 py-20 text-center">
            <p className="text-[15px] text-ink">{errorMsg}</p>
            <Link
              href="/"
              className="mt-4 inline-block rounded-xl bg-primary px-5 py-2.5 text-[14px] font-semibold text-white"
            >
              返回首页
            </Link>
          </div>
        )}

        {phase === "ready" && session.report && (
          <ReportView report={session.report} onRetryQuestion={handleRetry} />
        )}
      </main>
    </div>
  );
}
