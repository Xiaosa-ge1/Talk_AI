import { beforeEach, describe, expect, it } from "vitest";
import type { InterviewSession } from "./types";
import {
  __resetForTests,
  clearAllSessions,
  deleteSession,
  getSession,
  listSessions,
  saveSession,
} from "./store";

function makeSession(overrides: Partial<InterviewSession> & { id: string }): InterviewSession {
  const now = Date.now();
  return {
    resume: "",
    questionCount: 8,
    status: "in_progress",
    messages: [],
    report: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

beforeEach(async () => {
  await __resetForTests();
});

describe("store", () => {
  it("保存后可读回同一个会话", async () => {
    const session = makeSession({ id: "s1", resume: "hello" });
    await saveSession(session);

    const loaded = await getSession("s1");
    expect(loaded).not.toBeNull();
    expect(loaded?.id).toBe("s1");
    expect(loaded?.resume).toBe("hello");
  });

  it("读取不存在的会话返回 null", async () => {
    expect(await getSession("nope")).toBeNull();
  });

  it("超过 50 条时自动清理最旧的（按 updatedAt）", async () => {
    // 先写 60 条，updatedAt 递增，id 从 0 到 59
    for (let i = 0; i < 60; i++) {
      await saveSession(makeSession({ id: `s${i}`, updatedAt: 1000 + i }));
    }
    const sessions = await listSessions();
    expect(sessions.length).toBe(50);
    // 最旧的 10 条（s0..s9）应被清掉，最新的 s59 应保留
    const ids = sessions.map((s) => s.id);
    expect(ids).toContain("s59");
    expect(ids).not.toContain("s0");
    expect(ids).not.toContain("s9");
  });

  it("listSessions 按进行中优先、更新时间倒序排列", async () => {
    await saveSession(makeSession({ id: "old", status: "completed", updatedAt: 100 }));
    await saveSession(makeSession({ id: "mid", status: "in_progress", updatedAt: 200 }));
    await saveSession(makeSession({ id: "new", status: "completed", updatedAt: 300 }));

    const sessions = await listSessions();
    expect(sessions.map((s) => s.id)).toEqual(["mid", "new", "old"]);
  });

  it("更新同一会话会覆盖并刷新 updatedAt 顺序", async () => {
    await saveSession(makeSession({ id: "a", status: "completed", updatedAt: 100 }));
    await saveSession(makeSession({ id: "b", status: "completed", updatedAt: 200 }));
    await saveSession(
      makeSession({ id: "a", updatedAt: 999, status: "completed", report: null })
    );

    const sessions = await listSessions();
    expect(sessions.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("deleteSession 删除后不可读", async () => {
    await saveSession(makeSession({ id: "x" }));
    await deleteSession("x");
    expect(await getSession("x")).toBeNull();
  });

  it("clearAllSessions 清空所有会话", async () => {
    await saveSession(makeSession({ id: "a" }));
    await saveSession(makeSession({ id: "b" }));
    await clearAllSessions();
    expect(await listSessions()).toHaveLength(0);
  });
});
