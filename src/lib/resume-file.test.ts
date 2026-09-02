// @vitest-environment node
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import fs from "node:fs";
import path from "node:path";
import { ResumeParseError, parseResumeFile } from "./resume-file";
import { isMeaningfulText, normalizeText, parseResumeText } from "./resume-parser";

function fakeFile(name: string, buffer: Buffer): File {
  return {
    name,
    size: buffer.length,
    arrayBuffer: () =>
      Promise.resolve(
        buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
      ),
  } as File;
}

async function makeDocx(text: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>${text}</w:t></w:r></w:p>
  </w:body>
</w:document>`
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("parseResumeFile (PDF)", () => {
  it("解析真实 PDF 并返回文本", async () => {
    const pdfPath = path.join(__dirname, "__fixtures__", "sample-resume.pdf");
    const pdfBuf = fs.readFileSync(pdfPath);
    const result = await parseResumeFile(fakeFile("sample-resume.pdf", pdfBuf));
    expect(result.source).toBe("pdf");
    expect(result.text).toContain("Product Manager");
    expect(result.charCount).toBe(result.text.length);
  }, 20000);
});

describe("parseResumeFile (DOCX)", () => {
  it("解析 docx 并返回归一化文本", async () => {
    const docxBuf = await makeDocx("姓名：张三\n\n工作经历：负责 AI 产品，提升留存 20%");
    const result = await parseResumeFile(fakeFile("resume.docx", docxBuf));
    expect(result.source).toBe("docx");
    expect(result.text).toContain("张三");
    expect(result.text).toContain("留存");
  });

  it("拒绝超大文件（>20MB）", async () => {
    const big = Buffer.alloc(21 * 1024 * 1024, 0);
    const promise = parseResumeFile(fakeFile("big.pdf", big));
    await expect(promise).rejects.toBeInstanceOf(ResumeParseError);
    await expect(promise).rejects.toMatchObject({ code: "too_large" });
  });

  it("拒绝不支持的文件类型", async () => {
    const buf = Buffer.from("hello", "utf8");
    const promise = parseResumeFile(fakeFile("resume.txt", buf));
    await expect(promise).rejects.toMatchObject({ code: "unsupported_type" });
  });

  it("扫描版 PDF（无文本）抛出 no_text", async () => {
    const docxBuf = await makeDocx("A");
    // 内容太短 -> 判定无意义
    const promise = parseResumeFile(fakeFile("short.docx", docxBuf));
    await expect(promise).rejects.toMatchObject({ code: "no_text" });
  }, 20000);
});

describe("resume-parser 纯逻辑", () => {
  it("normalizeText / isMeaningfulText / parseResumeText 可用", () => {
    expect(isMeaningfulText("这是一份足够长的中文简历内容")).toBe(true);
    expect(normalizeText("a\r\nb")).toBe("a\nb");
    const r = parseResumeText("简历");
    expect(r.source).toBe("text");
    expect(r.text.length).toBeGreaterThan(0);
  });
});
