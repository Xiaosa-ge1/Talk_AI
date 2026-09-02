import { describe, expect, it } from "vitest";
import { isMeaningfulText, normalizeText, parseResumeText } from "./resume-parser";

describe("normalizeText", () => {
  it("合并 CRLF/CR 为 LF", () => {
    expect(normalizeText("a\r\nb\rc")).toBe("a\nb\nc");
  });

  it("去掉行尾多余空格", () => {
    expect(normalizeText("a  \nb\t\nc")).toBe("a\nb\nc");
  });

  it("压缩 3 个以上连续换行为 2 个", () => {
    expect(normalizeText("a\n\n\n\n\nb")).toBe("a\n\nb");
  });

  it("去除首尾空白", () => {
    expect(normalizeText("  hello  \n")).toBe("hello");
  });
});

describe("isMeaningfulText", () => {
  it("足够长的文本为有意义", () => {
    expect(isMeaningfulText("产品经理简历：负责 xxx 项目，提升留存 20%")).toBe(true);
  });

  it("短文本视为无意义", () => {
    expect(isMeaningfulText("hi")).toBe(false);
    expect(isMeaningfulText("")).toBe(false);
  });

  it("纯空白视为无意义", () => {
    expect(isMeaningfulText("   \n  \t ")).toBe(false);
  });
});

describe("parseResumeText", () => {
  it("返回归一化文本与统计", () => {
    const result = parseResumeText("  姓名：张三  \n\n\n工作经历：\n负责AI产品  ");
    expect(result.text).toBe("姓名：张三\n\n工作经历：\n负责AI产品");
    expect(result.source).toBe("text");
    expect(result.charCount).toBeGreaterThan(0);
    expect(result.charCount).toBe(result.text.length);
  });

  it("空输入返回空文本但不抛错（由调用方判断）", () => {
    const result = parseResumeText("");
    expect(result.text).toBe("");
    expect(result.charCount).toBe(0);
  });
});
