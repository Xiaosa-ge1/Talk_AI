"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { UploadCard } from "./UploadCard";
import { createSession } from "@/lib/session";
import { listSessions, saveSession } from "@/lib/store";
import { isMeaningfulText, parseResumeText } from "@/lib/resume-parser";
import type { InterviewSession, ParseResumeResult } from "@/lib/types";

type InputMode = "upload" | "paste";

export function HomePage() {
  const router = useRouter();
  const [mode, setMode] = useState<InputMode>("upload");
  const [resume, setResume] = useState("");
  const [resumeReady, setResumeReady] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [questionCount, setQuestionCount] = useState(10);
  const [history, setHistory] = useState<InterviewSession[]>([]);
  const [starting, setStarting] = useState(false);

  // 从本地历史读取（进行中 + 已完成报告）
  useEffect(() => {
    void listSessions().then(setHistory);
  }, []);

  const handleParsed = useCallback((result: ParseResumeResult) => {
    setResume(result.text);
    setResumeReady(true);
  }, []);

  const canStart = useMemo(() => {
    if (mode === "upload") return resumeReady;
    return isMeaningfulText(pasteText);
  }, [mode, resumeReady, pasteText]);

  const handleStart = useCallback(() => {
    if (!canStart || starting) return;
    const text = mode === "paste" ? parseResumeText(pasteText).text : resume;
    setStarting(true);
    const session = createSession(text, questionCount);
    void saveSession(session)
      .then(() => router.push(`/interview?id=${session.id}`))
      .finally(() => setStarting(false));
  }, [mode, pasteText, resume, questionCount, canStart, starting, router]);

  const handleSkip = useCallback(() => {
    if (starting) return;
    // 跳过简历：直接以空简历开始
    setStarting(true);
    const session = createSession("", questionCount);
    void saveSession(session)
      .then(() => router.push(`/interview?id=${session.id}`))
      .finally(() => setStarting(false));
  }, [questionCount, starting, router]);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* 导航条（Notion 风格：白底、紧凑、蓝主按钮） */}
      <header className="sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-[15px] font-bold text-white">
              A
            </span>
            <span className="text-[15px] font-semibold text-ink">AI 面试陪练</span>
          </div>
          <nav className="flex items-center gap-5 text-[14px] text-ink-secondary">
            <Link href="/" className="hover:text-ink">
              开始练习
            </Link>
            <a href="#history" className="hover:text-ink">
              历史记录
            </a>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-6">
        {/* Hero */}
        <section className="py-14 text-center sm:py-20">
          <h1 className="mx-auto max-w-2xl text-4xl font-bold tracking-tight text-ink sm:text-5xl">
            像真面试官一样，陪你练出
            <span className="text-primary"> 产品经理 </span>岗位
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-[15px] leading-7 text-ink-secondary">
            上传简历，AI 面试官基于你的经历深度追问。练完生成专属报告：
            讲得好的、答不好的、该怎么改，一次讲清。
          </p>
        </section>

        {/* 上传 / 粘贴卡片区 */}
        <section className="mx-auto max-w-xl">
          <div className="mb-4 flex items-center justify-center gap-1 rounded-xl bg-soft-gray p-1 text-[14px]">
            <button
              type="button"
              onClick={() => setMode("upload")}
              className={`flex-1 rounded-lg px-4 py-2 font-medium transition-colors ${
                mode === "upload"
                  ? "bg-white text-ink shadow-sm"
                  : "text-ink-secondary hover:text-ink"
              }`}
            >
              上传简历
            </button>
            <button
              type="button"
              onClick={() => setMode("paste")}
              className={`flex-1 rounded-lg px-4 py-2 font-medium transition-colors ${
                mode === "paste"
                  ? "bg-white text-ink shadow-sm"
                  : "text-ink-secondary hover:text-ink"
              }`}
            >
              粘贴简历
            </button>
          </div>

          {mode === "upload" ? (
            <UploadCard onParsed={handleParsed} onSkip={() => setMode("paste")} />
          ) : (
            <div className="rounded-xl border border-border p-1">
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder="把简历文字粘贴到这里（也可只粘贴关键经历）……"
                rows={6}
                className="w-full resize-none rounded-lg px-3 py-2.5 text-[14px] leading-6 text-ink outline-none placeholder:text-ink-muted"
              />
            </div>
          )}

          {/* 题量选择 */}
          <div className="mt-5 flex items-center justify-center gap-2 text-[14px] text-ink-secondary">
            <span>本次面试题量：</span>
            {[8, 10, 12].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setQuestionCount(n)}
                className={`rounded-lg px-3 py-1.5 text-[14px] font-medium transition-colors ${
                  questionCount === n
                    ? "bg-primary text-white"
                    : "border border-border text-ink hover:border-primary/40 hover:text-ink"
                }`}
              >
                {n} 题
              </button>
            ))}
          </div>

          <div className="mt-6 flex flex-col items-center gap-3">
            <button
              type="button"
              disabled={!canStart || starting}
              onClick={() => void handleStart()}
              className="w-full rounded-xl bg-primary px-6 py-3.5 text-[15px] font-semibold text-white shadow-sm transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              {starting ? "正在准备面试…" : "开始面试"}
            </button>
            <button
              type="button"
              onClick={() => void handleSkip()}
              className="text-[13px] text-ink-muted underline-offset-4 hover:text-ink-secondary hover:underline"
            >
              跳过简历，直接开始
            </button>
          </div>
        </section>

        {/* 三步特性（Notion 浅色块卡片） */}
        <section className="mx-auto mt-20 grid max-w-3xl gap-4 sm:grid-cols-3">
          {[
            {
              bg: "bg-soft-blue",
              icon: "🎙️",
              title: "真实追问",
              desc: "像资深 PM 面试官，深挖你的项目、数据与决策。",
            },
            {
              bg: "bg-soft-orange",
              icon: "📊",
              title: "专属报告",
              desc: "总评 + 维度分析 + 3 个最该改进的地方。",
            },
            {
              bg: "bg-soft-amber",
              icon: "🔁",
              title: "重答这题",
              desc: "报告里每题可一键重练，练到会为止。",
            },
          ].map((f) => (
            <div key={f.title} className={`${f.bg} rounded-xl p-5`}>
              <div className="text-[22px]">{f.icon}</div>
              <h3 className="mt-2 text-[15px] font-semibold text-ink">{f.title}</h3>
              <p className="mt-1 text-[13px] leading-5 text-ink-secondary">{f.desc}</p>
            </div>
          ))}
        </section>

        {/* 历史记录 */}
        <section id="history" className="mx-auto mt-16 max-w-3xl pb-20">
          <h2 className="text-lg font-semibold text-ink">最近练习</h2>
          {history.length === 0 ? (
            <p className="mt-3 text-[14px] text-ink-muted">
              还没有练习记录，完成第一次面试后这里会展示报告。
            </p>
          ) : (
            <ul className="mt-4 space-y-2">
              {history.slice(0, 8).map((s) => (
                <li key={s.id}>
                  <Link
                    href={
                      s.status === "completed" && s.report
                        ? `/report?id=${s.id}`
                        : `/interview?id=${s.id}`
                    }
                    className="flex items-center justify-between rounded-xl border border-border px-4 py-3 transition-colors hover:border-primary/40 hover:bg-soft-gray"
                  >
                    <span className="text-[14px] text-ink">
                      {s.resume ? "带简历面试" : "无简历面试"} · {s.questionCount} 题
                    </span>
                    <span className="text-[12px] text-ink-muted">
                      {s.status === "completed" ? "已结束 · 查看报告 →" : "进行中 · 继续 →"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>

      <footer className="border-t border-border py-6 text-center text-[13px] text-ink-muted">
        数据仅保存在本浏览器 · AI 面试陪练 MVP
      </footer>
    </div>
  );
}
