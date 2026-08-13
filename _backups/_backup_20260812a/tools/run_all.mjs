// ============================================================
// tools/run_all.mjs — Fate_echo 全量测试执行器
// 自动发现并运行 tools/ 下所有 test_*.mjs 与 _review*/_fuzz*（回归基线）,
// 任一失败退出码 1。demo_battle.mjs 是验收演示（非断言测试），不纳入。
// 用法: node tools/run_all.mjs（或 npm test）
// ============================================================

import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const toolsDir = join(root, 'tools');

const items = readdirSync(toolsDir)
  .filter((f) => f.endsWith('.mjs'))
  .filter((f) => f.startsWith('test_') || f.startsWith('_review') || f.startsWith('_fuzz'))
  .sort();

if (items.length === 0) {
  console.error('未发现任何测试（tools/test_*.mjs）');
  process.exit(1);
}

console.log(`========== Fate_echo 全量测试开始（${items.length} 项） ==========`);
const failed = [];
for (const f of items) {
  const t0 = Date.now();
  try {
    execFileSync(process.execPath, [join(toolsDir, f)], { cwd: root, stdio: 'inherit' });
    console.log(`[PASS] ${f} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  } catch (err) {
    failed.push(f);
    console.log(`[FAIL] ${f}（见上方错误输出）`);
  }
  console.log('');
}

if (failed.length) {
  console.log(`========== 测试结果：${items.length - failed.length}/${items.length} 通过，失败：${failed.join(', ')} ==========`);
  process.exit(1);
}
console.log(`========== 测试结果：全部通过（${items.length} 项） ==========`);
