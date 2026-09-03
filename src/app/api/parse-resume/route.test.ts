// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResumeParseError } from "@/lib/resume-file";

// 只 mock 文件解析这个系统边界；保留真实 ResumeParseError 类，route 的 instanceof 判定才真实
vi.mock("@/lib/resume-file", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/resume-file")>();
  return { ...actual, parseResumeFile: vi.fn() };
});

const { parseResumeFile } = await import("@/lib/resume-file");
const mockParse = vi.mocked(parseResumeFile);
const { POST } = await import("./route");

const ROUTE_URL = "http://localhost/api/parse-resume";

function formDataRequest(withFile: boolean): NextRequest {
  const fd = new FormData();
  if (withFile) {
    fd.append("file", new File(["fake-pdf-bytes"], "resume.pdf", { type: "application/pdf" }));
  } else {
    fd.append("notFile", "hello");
  }
  return new NextRequest(ROUTE_URL, { method: "POST", body: fd });
}

beforeEach(() => {
  mockParse.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/parse-resume", () => {
  it("请求体不是 multipart/form-data → 400 parse_failed", async () => {
    const req = new NextRequest(ROUTE_URL, {
      method: "POST",
      body: "plain text",
      headers: { "Content-Type": "text/plain" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("parse_failed");
  });

  it("表单里没有 file 字段 → 400 parse_failed", async () => {
    const res = await POST(formDataRequest(false));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("parse_failed");
  });

  it("文件超过大小限制（too_large）→ 413 + 原始 code", async () => {
    mockParse.mockRejectedValue(new ResumeParseError("too_large", "文件超过 20MB"));
    const res = await POST(formDataRequest(true));
    expect(res.status).toBe(413);
    const body = (await res.json()) as { code?: string; error?: string };
    expect(body.code).toBe("too_large");
    expect(body.error).toBe("文件超过 20MB");
  });

  it("类型不支持等其余业务错误 → 422 + 原始 code", async () => {
    mockParse.mockRejectedValue(new ResumeParseError("no_text", "未提取到文本"));
    const res = await POST(formDataRequest(true));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("no_text");
  });

  it("未知异常 → 500 parse_failed（不泄漏内部错误）", async () => {
    mockParse.mockRejectedValue(new Error("pdfjs internal explosion"));
    const res = await POST(formDataRequest(true));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { code?: string; error?: string };
    expect(body.code).toBe("parse_failed");
    expect(body.error).not.toContain("pdfjs");
  });

  it("解析成功 → 200 返回提取文本", async () => {
    mockParse.mockResolvedValue({
      text: "张三，5 年产品经验",
      source: "pdf",
      charCount: 11,
    });
    const res = await POST(formDataRequest(true));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { text?: string };
    expect(body.text).toBe("张三，5 年产品经验");
  });
});
