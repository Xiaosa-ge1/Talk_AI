"use client";

import { useCallback, useRef, useState } from "react";
import type { ParseResumeResult } from "@/lib/types";

/**
 * 简历上传卡片：拖拽/点击选择 PDF/DOCX → /api/parse-resume 解析。
 * 状态：idle（未选）→ parsing（解析中）→ success / error。
 * 错误（扫描版/损坏/超大）显示友好提示，允许重选或转粘贴。
 */

interface UploadCardProps {
  onParsed: (result: ParseResumeResult) => void;
  /** 用户选择「跳过简历」或「转粘贴」时回调 */
  onSkip?: () => void;
}

type Status =
  | { kind: "idle" }
  | { kind: "parsing"; fileName: string }
  | { kind: "success"; result: ParseResumeResult }
  | { kind: "error"; message: string };

export function UploadCard({ onParsed, onSkip }: UploadCardProps) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      const isDoc =
        file.name.toLowerCase().endsWith(".pdf") ||
        file.name.toLowerCase().endsWith(".docx") ||
        file.name.toLowerCase().endsWith(".doc");
      if (!isDoc) {
        setStatus({ kind: "error", message: "仅支持 PDF 或 Word 文件" });
        return;
      }
      setStatus({ kind: "parsing", fileName: file.name });
      try {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/parse-resume", { method: "POST", body: form });
        const data = (await res.json()) as ParseResumeResult & { error?: string; code?: string };
        if (!res.ok || data.code) {
          setStatus({ kind: "error", message: data.error ?? "解析失败，请重试" });
          return;
        }
        setStatus({ kind: "success", result: data });
        onParsed(data);
      } catch {
        setStatus({ kind: "error", message: "网络异常，解析失败，请重试" });
      }
    },
    [onParsed]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      void handleFile(e.dataTransfer.files?.[0]);
    },
    [handleFile]
  );

  return (
    <div className="w-full">
      <div
        role="button"
        tabIndex={0}
        aria-label="上传简历文件（PDF 或 Word）"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors ${
          dragOver
            ? "border-primary bg-primary-soft"
            : "border-border hover:border-primary/50 hover:bg-soft-gray"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.docx,.doc"
          className="hidden"
          onChange={(e) => void handleFile(e.target.files?.[0])}
          data-testid="resume-file-input"
        />
        {status.kind === "idle" && (
          <>
            <span className="text-2xl" aria-hidden>
              📄
            </span>
            <p className="text-[15px] font-medium text-ink">
              点击或拖拽上传简历 <span className="text-ink-secondary">（PDF / Word）</span>
            </p>
            <p className="text-[13px] text-ink-muted">上传后 AI 面试官会基于你的简历深度追问</p>
          </>
        )}
        {status.kind === "parsing" && (
          <>
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" aria-hidden />
            <p className="text-[15px] font-medium text-ink">正在解析 {status.fileName}…</p>
          </>
        )}
        {status.kind === "success" && (
          <>
            <span className="text-2xl" aria-hidden>
              ✅
            </span>
            <p className="text-[15px] font-medium text-ink">简历解析成功</p>
            <p className="max-w-md truncate text-[13px] text-ink-secondary">
              已识别 {status.result.charCount} 个字符
            </p>
          </>
        )}
        {status.kind === "error" && (
          <>
            <span className="text-2xl" aria-hidden>
              ⚠️
            </span>
            <p className="text-[15px] font-medium text-ink">{status.message}</p>
            <p className="text-[13px] text-ink-muted">可重新选择文件，或改用下方粘贴简历</p>
          </>
        )}
      </div>

      {status.kind === "error" && onSkip && (
        <button
          type="button"
          onClick={onSkip}
          className="mt-3 w-full rounded-lg border border-border px-4 py-2.5 text-[14px] font-medium text-ink transition-colors hover:bg-soft-gray"
        >
          转粘贴简历文本
        </button>
      )}
    </div>
  );
}
