# AI 面试陪练（Interview Coach）

上传真实简历（PDF/Word）→ AI 扮演**产品经理面试官**进行多轮文字追问 → 练完生成专属面试报告（总评 + 维度评估 + 重点改进 3 处 + 重答这题）。

纯文字、无语音、无账号，数据只保存在本浏览器（IndexedDB）。本项目同时是「产品思维 + AI 编程 agent 协作」的训练场：所有架构决策与质量红线记录在 [`AGENTS.md`](AGENTS.md)，AI agent 开发时必须遵守。

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 配置 DeepSeek API Key
cp .env.example .env.local
# 编辑 .env.local，填入 DEEPSEEK_API_KEY（https://platform.deepseek.com/ 获取）

# 3. 启动
npm run dev
# 打开 http://localhost:3000
```

## 功能

- **上传简历 / 粘贴简历 / 跳过简历** 三种入口；PDF/Word 服务端解析（扫描版 PDF 会提示转粘贴）
- **对话式面试**：AI 一次一题、顺着简历追问；题目数可设（8/10/12）；流式输出；生成中禁输入防乱序
- **面试报告**：一句话总评 + 4 维度评分（表达逻辑/专业深度/数据思维/应变）+ 重点改进 3 处 + 说得好的 1 句
- **重答这题**：报告里对薄弱题一键重练（临时会话，不污染历史）
- **历史记录**：IndexedDB 保存最近 50 条，进行中会话断线可恢复

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 本地开发 |
| `npm run quality` | **质量门禁**：lint + format:check + typecheck + 全部测试（交付前必须全绿） |
| `npm run test` | 跑测试 |
| `npm run coverage` | 覆盖率报告（lib 核心逻辑 ≥80%） |
| `npm run lint` / `npm run typecheck` | 单项检查 |
| `npm run format` | 自动格式化 |

## 架构

```
浏览器（Next.js SPA）
 ├─ /            首页：上传/粘贴简历、题量、历史
 ├─ /interview   对话页（?id= 正式会话 | ?resume=&seed= 重练）
 ├─ /report      报告页（?id=xxx&generate=1）
 └─ 数据：IndexedDB（会话/报告，最多 50 条）

服务端 API route（无状态，密钥只在服务端）
 ├─ POST /api/parse-resume   解析 PDF/DOCX（pdfjs-dist + mammoth）
 ├─ POST /api/chat           面试对话（SSE 流式转发 DeepSeek）
 └─ POST /api/report         生成结构化报告（JSON 解析失败自动重试）
```

设计要点：

- **无状态 API**：会话历史由前端随请求携带，服务端不存用户数据（无账号、最小必要）
- **密钥红线**：`DEEPSEEK_API_KEY` 只在服务端读取，绝不进前端代码（勿用 `NEXT_PUBLIC_*`）
- **质量门禁**：AI agent 交付必须 `npm run quality` 全绿，靠命令裁定不靠自证（详见 AGENTS.md）
- 报告 JSON 解析：容忍 markdown 包裹/杂音，失败自动重试一次，再失败降级提示

## 开发约定

- 共享类型一律从 `src/lib/types.ts` 导入
- LLM 测试必须 mock（`vi.mock` 掉 deepseek 模块），不得发起真实网络请求
- 任何需求变更先更新 AGENTS.md 再改代码；P0 范围外功能（语音/账号/RAG/部署）不做
