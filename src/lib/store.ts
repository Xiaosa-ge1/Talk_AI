import type { InterviewSession } from "./types";

/**
 * 本地持久化（IndexedDB）—— 无账号设计下的数据层。
 * 存储：面试会话（含消息与报告）。
 * 容量：保留最近 MAX_SESSIONS 条，超出自动清理最旧的。
 * 浏览器环境专用；服务端组件不得调用（仅在客户端组件中使用）。
 */

const DB_NAME = "interview-coach";
const DB_VERSION = 1;
const STORE_NAME = "sessions";
const MAX_SESSIONS = 50;

let db: IDBDatabase | null = null;
let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available in this environment"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt");
      }
    };
    request.onsuccess = () => {
      db = request.result;
      resolve(request.result);
    };
    request.onerror = () => reject(request.error ?? new Error("open db failed"));
  });
  return dbPromise;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("idb request failed"));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("tx failed"));
    tx.onabort = () => reject(tx.error ?? new Error("tx aborted"));
  });
}

/** 测试专用：关闭连接并删除数据库，重置为干净状态 */
export async function __resetForTests(): Promise<void> {
  dbPromise = null;
  if (db) {
    db.close();
    db = null;
  }
  if (typeof indexedDB !== "undefined") {
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
  }
}

async function getAllSessions(): Promise<InterviewSession[]> {
  const database = await openDb();
  const tx = database.transaction(STORE_NAME, "readonly");
  const store = tx.objectStore(STORE_NAME);
  const all = await requestToPromise(store.getAll() as IDBRequest<InterviewSession[]>);
  return all;
}

/** 写入后清理：若超过上限，删除 updatedAt 最旧的记录 */
async function prune(database: IDBDatabase): Promise<void> {
  const tx = database.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);
  const index = store.index("updatedAt");
  // index key 升序，最旧的在前
  const keys = await requestToPromise(index.getAllKeys() as IDBRequest<IDBValidKey[]>);
  const excess = keys.length - MAX_SESSIONS;
  if (excess > 0) {
    for (let i = 0; i < excess; i++) {
      store.delete(keys[i]);
    }
  }
  await transactionDone(tx);
}

/** 保存或更新一个会话（写入后触发容量清理） */
export async function saveSession(session: InterviewSession): Promise<void> {
  const database = await openDb();
  const tx = database.transaction(STORE_NAME, "readwrite");
  tx.objectStore(STORE_NAME).put(session);
  await transactionDone(tx);
  await prune(database);
}

/** 按 id 读取单个会话 */
export async function getSession(id: string): Promise<InterviewSession | null> {
  const database = await openDb();
  const tx = database.transaction(STORE_NAME, "readonly");
  const store = tx.objectStore(STORE_NAME);
  const result = await requestToPromise(store.get(id) as IDBRequest<InterviewSession | undefined>);
  return result ?? null;
}

/** 列出所有会话：进行中优先，其余按更新时间倒序 */
export async function listSessions(): Promise<InterviewSession[]> {
  const all = await getAllSessions();
  const rank = (s: InterviewSession) => (s.status === "in_progress" ? 1 : 0);
  return all.sort((a, b) => rank(b) - rank(a) || b.updatedAt - a.updatedAt);
}

/** 删除单个会话 */
export async function deleteSession(id: string): Promise<void> {
  const database = await openDb();
  const tx = database.transaction(STORE_NAME, "readwrite");
  tx.objectStore(STORE_NAME).delete(id);
  await transactionDone(tx);
}

/** 清空全部本地数据（设置页「清除数据」即注销） */
export async function clearAllSessions(): Promise<void> {
  const database = await openDb();
  const tx = database.transaction(STORE_NAME, "readwrite");
  tx.objectStore(STORE_NAME).clear();
  await transactionDone(tx);
}
