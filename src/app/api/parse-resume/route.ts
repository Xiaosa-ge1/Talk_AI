import { NextRequest, NextResponse } from "next/server";
import { parseResumeFile, ResumeParseError } from "@/lib/resume-file";

/**
 * POST /api/parse-resume
 * multipart/form-data，字段名 file。服务端解析 PDF/DOCX 简历，只返回提取文本。
 * 失败返回可识别的 code，由前端引导降级（转粘贴）。
 */
export async function POST(request: NextRequest) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "无法读取上传内容", code: "parse_failed" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "未收到文件", code: "parse_failed" }, { status: 400 });
  }

  try {
    const result = await parseResumeFile(file);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ResumeParseError) {
      const status = err.code === "too_large" ? 413 : 422;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    console.error("resume parse unexpected error:", err);
    return NextResponse.json(
      { error: "解析文件时发生未知错误，请改用粘贴文本", code: "parse_failed" },
      { status: 500 }
    );
  }
}
