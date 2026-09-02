import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UploadCard } from "./UploadCard";

function mockFetchResponse(ok: boolean, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok,
    json: () => Promise.resolve(body),
  });
}

function makePdfFile(): File {
  return new File(["fake pdf bytes"], "resume.pdf", { type: "application/pdf" });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("UploadCard", () => {
  it("未选择文件时展示提示文案", () => {
    render(<UploadCard onParsed={() => undefined} />);
    expect(screen.getByText(/点击或拖拽上传简历/)).toBeInTheDocument();
  });

  it("选择文件后调用 /api/parse-resume 并回调 onParsed", async () => {
    const fetchMock = mockFetchResponse(true, { text: "简历文本", source: "pdf", charCount: 12 });
    vi.stubGlobal("fetch", fetchMock);
    const onParsed = vi.fn();
    const user = userEvent.setup();

    render(<UploadCard onParsed={onParsed} />);
    const input = screen.getByTestId("resume-file-input");
    await user.upload(input, makePdfFile());

    await waitFor(() => expect(onParsed).toHaveBeenCalledTimes(1));
    expect(onParsed).toHaveBeenCalledWith({ text: "简历文本", source: "pdf", charCount: 12 });
    // 成功后显示成功提示
    expect(await screen.findByText("简历解析成功")).toBeInTheDocument();
  });

  it("后端返回错误时展示错误提示并可转粘贴", async () => {
    const fetchMock = mockFetchResponse(false, {
      error: "未能从文件中提取到文本（可能是扫描版 PDF），请改用粘贴文本",
      code: "no_text",
    });
    vi.stubGlobal("fetch", fetchMock);
    const onParsed = vi.fn();
    const onSkip = vi.fn();
    const user = userEvent.setup();

    render(<UploadCard onParsed={onParsed} onSkip={onSkip} />);
    const input = screen.getByTestId("resume-file-input");
    await user.upload(input, makePdfFile());

    expect(await screen.findByText(/扫描版 PDF/)).toBeInTheDocument();
    expect(onParsed).not.toHaveBeenCalled();
    // 点「转粘贴」触发 onSkip
    await user.click(screen.getByRole("button", { name: "转粘贴简历文本" }));
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it("文件输入限制为 PDF/Word（accept 属性）", () => {
    render(<UploadCard onParsed={() => undefined} />);
    const input = screen.getByTestId("resume-file-input");
    expect(input).toHaveAttribute("accept", ".pdf,.docx,.doc");
  });

  it("网络异常时展示重试提示", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const user = userEvent.setup();

    render(<UploadCard onParsed={() => undefined} />);
    const input = screen.getByTestId("resume-file-input");
    await user.upload(input, makePdfFile());

    expect(await screen.findByText("网络异常，解析失败，请重试")).toBeInTheDocument();
  });
});
