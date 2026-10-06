# collab-workflow

大项目专用的 Claude + Codex 协作工作流，只在手动输入 `/collab` 时触发。

- **Claude**：和你对齐需求，规划架构，写前端视觉骨架，最后对照需求验收（包括前端好不好看）。
- **Codex**：按阶段写代码，并自己负责代码质量。

## 用法

1. 在项目目录打开 Claude Code，输入 `/collab`。
2. 先用 grill 对齐需求。这是唯一需要你参与的环节，你确认后它会全自动跑完。
3. 只有遇到重大分歧才会停下来找你，同时弹出桌面通知。
   底部状态栏第一行始终显示两边 5 小时额度的剩余和重置倒计时，以及当前上下文占用，例如 `● Claude 60% ↻ 2h13m · ● Codex 93% ↻ 4h05m · 上下文：50k  23%`（灰色表示这是上次记录的值）。在运行 `/collab` 的窗口里，同一行的右侧会显示进度，例如 `⚙ 阶段2/3 写前端 · 65% · 3子代理`（窗口太窄时换到第二行）。
4. 如果中途断了，比如周额度用完或关了窗口，输入 `/collab continue` 接着跑。
5. 跑完后看 `.collab/report.md`，里面有每个阶段的额度消耗。代码在 `collab/<名字>` 分支上，确认无误后由你自己合并。

笔记本跑的过程中不要合盖（或在"电源设置"里把插电时合盖改成"不采取任何操作"）。合盖会让电脑睡眠，自动续跑和防休眠都挡不住。

## 新电脑安装

在任意目录打开 Claude Code，对它说：

> 装好 git 和 GitHub CLI（gh），让我运行 `gh auth login` 登录，然后用 `gh repo clone 2498982541/collab-workflow "$USERPROFILE/collab-workflow"` 克隆这个仓库，再阅读其中的 INSTALL.md 并按它安装。

## 更新

在仓库目录运行 `git pull`。skill 是用目录链接装上的，拉取后直接生效。

## 目录

```
skills/collab/      主流程（SKILL.md）、给 Codex 的任务和审查模板、脚本（Codex 启动与清理、哨兵和状态栏、防休眠、通知）
skills/grilling/    需求对齐，来自 mattpocock/skills（MIT 许可）；本机已有就不会重复安装
INSTALL.md          给新电脑上的 AI 看的安装说明
```
