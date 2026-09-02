"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { getSession, saveSession } from "@/lib/store";
import { completeSession } from "@/lib/session";
import { ReportView } from "./ReportView";
import type { InterviewReport, InterviewSession } from "@/lib/types";

type Phase = "loading" | "generating" | "ready" | "error";

/**
 * 报告页：?id=<sessionId>&generate=1
 * - 会话已有报告 → 直接展示（历史回看）
 * - generate=1 且无报告 → 调 /api/report 生成并落库
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
      // 生成报告
      generatedRef.current = true;
      setPhase("generating");
      try {
        const res = await fetch("/api/report", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            resume: s.resume,
            messages: s.messages,
            questionCount: s.questionCount,
          }),
        });
        const data = (await res.json()) as { report?: InterviewReport; error?: string };
        if (!res.ok || !data.report) {
          setPhase("error");
          setErrorMsg(data.error ?? "报告生成失败，请重试");
          return;
        }
        const done = completeSession(s, data.report);
        setSession(done);
        await saveSession(done);
        setPhase("ready");
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
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <span className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <p className="mt-4 text-[14px] text-ink-secondary">AI 正在复盘你的面试，生成报告…</p>
            <p className="mt-1 text-[12px] text-ink-muted">通常需要 20~40 秒</p>
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
