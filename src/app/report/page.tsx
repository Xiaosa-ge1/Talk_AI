import { Suspense } from "react";
import { ReportPage } from "@/components/ReportPage";

export default function ReportRoute() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-ink-secondary">加载中…</div>}>
      <ReportPage />
    </Suspense>
  );
}
