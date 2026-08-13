# 命运回响 Fate_echo

纯前端 ES6 中文回合制 roguelike RPG。文字冒险 + 抽卡收集 + 回合制战斗，AI 大赛参赛项目。

## 运行

```bash
# 方式一：本地静态服务器（推荐，index.html 走 ES 模块需要）
python -m http.server 8000
# 然后浏览器打开 http://localhost:8000

# 方式二：Windows 直接双击 start-server.cmd（内置 8000 端口服务）
```

## 测试

```bash
npm install        # 仅需安装 @tensorflow/tfjs（AI 自学习用）
npm test           # 运行全部测试（tools/run_all.mjs，17 个测试套件）
```

## 目录结构

```
js/       游戏逻辑（引擎、战斗、技能、AI、存档、界面）
tools/    测试套件（Node ESM，.mjs）
css/      样式
index.html 入口
NEW_GAME.md   游戏设计文档（规则、数值、技能表）
AGENTS.md     开发约束与关键实现说明
DESIGN_NOTES.md 设计决策记录
```

## 特性

- 回合制战斗：AP 行动点系统（上限 8）、技能瞬发/主行动、终焉技
- 抽卡收集：角色、装备、收藏品（图鉴）
- 敌人 AI：自学习决策（TensorFlow.js 权重 + 规则兜底），40 个敌人技能
- 区域推进：塔/区域地图、事件、随机遭遇
- 自动战斗（autoloop）与自战 AI 训练脚本
