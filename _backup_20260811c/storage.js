// ============================================================
// js/storage.js — SmartAI 模型持久化（Fate_echo Phase 2）
// 设计（NEW_GAME.md §4.2）：模型与游戏存档分离存储，防损坏连带。
// 实现：统一 JSON 值接口（{weights:[{shape,data}], meta}），
//   - 浏览器：localStorage 独立 key（数据格式与 Node 测试统一；
//     128-64-32 权重 ~100KB，远低于 5MB 上限；若未来超限，仅需把
//     本文件浏览器后端换成 TF.js 原生 indexeddb://，接口不变）
//   - Node/测试：注入 backend（内存 Map / fs 文件）
// 用法：
//   const store = createModelStore({ key: 'fate_echo_smartai', backend });
//   await store.save(value);   // value = {weights, meta}
//   const value = await store.load();  // null = 无存档
// ============================================================

const isNodeEnv = typeof process !== 'undefined' && !!process.versions && !!process.versions.node;

/**
 * @param {object} opts
 * @param {string} opts.key  存储键（默认 fate_echo_smartai）
 * @param {object|null} opts.backend  注入后端 {save(key, value), load(key), clear?(key)}
 */
export function createModelStore({ key = 'fate_echo_smartai', backend = null } = {}) {
  // 注入后端（测试/演示：内存 Map、fs 文件等）
  if (backend) {
    return {
      async save(value) { await backend.save(key, value); },
      async load() { return (await backend.load(key)) || null; },
      async clear() { if (backend.clear) await backend.clear(key); },
    };
  }
  // 浏览器：localStorage（独立 key，与游戏存档分离）
  if (!isNodeEnv) {
    const k = `fate_echo:${key}`;
    return {
      async save(value) {
        // 配额/序列化异常不抛到战斗层（模型存不上只损失学习进度）
        try { localStorage.setItem(k, JSON.stringify(value)); } catch { /* 忽略：下次战斗重试 */ }
      },
      async load() {
        try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } // 损坏/缺失 → 从零训练
      },
      async clear() { try { localStorage.removeItem(k); } catch { /* 存储不可用忽略 */ } },
    };
  }
  // Node 兜底：内存 Map（跨进程持久化由调用方注入 fs backend）
  const mem = new Map();
  return {
    async save(value) { mem.set(key, value); },
    async load() { return mem.get(key) || null; },
    async clear() { mem.delete(key); },
  };
}
