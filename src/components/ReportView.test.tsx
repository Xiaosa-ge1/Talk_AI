import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReportView } from "./ReportView";
import type { InterviewReport } from "@/lib/types";

const report: InterviewReport = {
  summary: "整体表现不错，逻辑清晰，数据思维突出",
  dimensions: [
    { key: "logic", label: "表达逻辑", score: 4, comment: "条理清楚" },
    { key: "depth", label: "专业深度", score: 3, comment: "可再深入" },
    { key: "data", label: "数据思维", score: 5, comment: "指标意识强" },
    { key: "agility", label: "应变能力", score: 2, comment: "需加强" },
  ],
  improvements: [
    {
      question: "介绍一个你负责过的项目？",
      yourAnswer: "我做过一个推荐项目",
      issue: "缺少量化结果",
      suggestion: "补充核心指标变化",
    },
  ],
  highlight: { question: "q", quote: "我们把转化率提升了 30%", praise: "有数据支撑" },
  createdAt: Date.now(),
};

describe("ReportView", () => {
  it("展示总评与维度分", () => {
    render(<ReportView report={report} onRetryQuestion={() => undefined} />);
    expect(screen.getByText("整体表现不错，逻辑清晰，数据思维突出")).toBeInTheDocument();
    expect(screen.getByText("表达逻辑")).toBeInTheDocument();
    expect(screen.getByText("4 / 5")).toBeInTheDocument();
  });

  it("展示重点改进与说得好的句子", () => {
    render(<ReportView report={report} onRetryQuestion={() => undefined} />);
    expect(screen.getByText(/介绍一个你负责过的项目/)).toBeInTheDocument();
    expect(screen.getByText(/缺少量化结果/)).toBeInTheDocument();
    expect(screen.getByText(/转化率提升了 30%/)).toBeInTheDocument();
  });

  it("点「重答这题」回调该问题文本", async () => {
    const onRetry = vi.fn();
    const user = userEvent.setup();
    render(<ReportView report={report} onRetryQuestion={onRetry} />);
    await user.click(screen.getByRole("button", { name: /重答这题/ }));
    expect(onRetry).toHaveBeenCalledWith("介绍一个你负责过的项目？");
  });

  it("展示维度评分依据（evidence），让分数可人工核验", () => {
    const withEvidence: InterviewReport = {
      ...report,
      dimensions: [
        {
          key: "data",
          label: "数据思维",
          score: 5,
          comment: "指标意识强",
          evidence: "日活从 10 万提升到 15 万",
        },
      ],
    };
    render(<ReportView report={withEvidence} onRetryQuestion={() => undefined} />);
    expect(screen.getByText(/评分依据/)).toBeInTheDocument();
    expect(screen.getByText(/日活从 10 万提升到 15 万/)).toBeInTheDocument();
  });

  it("evidence 缺失时不显示评分依据", () => {
    render(<ReportView report={report} onRetryQuestion={() => undefined} />);
    expect(screen.queryByText(/评分依据/)).toBeNull();
  });

  it("空 improvements 时显示鼓励徽章", () => {
    const empty: InterviewReport = {
      ...report,
      improvements: [],
      highlight: { question: "", quote: "", praise: "" },
    };
    render(<ReportView report={empty} onRetryQuestion={() => undefined} />);
    expect(screen.getByText(/没有明显硬伤/)).toBeInTheDocument();
  });
});
