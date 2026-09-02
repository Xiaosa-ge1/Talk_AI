import { Suspense } from "react";
import { InterviewPage } from "@/components/InterviewPage";

export default function InterviewRoute() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-ink-secondary">加载中…</div>}>
      <InterviewPage />
    </Suspense>
  );
}
