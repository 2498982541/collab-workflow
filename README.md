# collab-workflow

大项目专用的 Claude + Codex 协作工作流，只在手动输入 `/collab` 时触发。

- **Claude**：和你对齐需求，规划架构，写前端视觉骨架，最后对照需求验收（包括前端好不好看）。
- **Codex**：按阶段写代码，并自己负责代码质量。

## 用法

1. 在项目目录打开 Claude Code，输入 `/collab`。
2. 先用 grill 对齐需求。这是唯一需要你参与的环节，你确认后它会全自动跑完。
3. 只有遇到重大分歧才会停下来找你，同时弹出桌面通知。
   底部状态栏第一行始终显示两边 5 小时额度的剩余和重置倒计时，以及当前上下文占用，例如 `● Claude 60% ↻ 2h13m · ● Codex 93% ↻ 4h05m · 上下文：50k  23%`（灰色表示这是上次记录的值）。在运行 `/collab` 的窗口里，第二行显示工作流进度，例如 `◆ 阶段2/3 写前端  ━━━━━━──── 58% · 3/7 正在跑单元测试 · 2子代理`：进度条按各阶段预估时长加权，`3/7` 是 Codex 自己报告的步骤，后面那句由 Haiku 5.5 每分钟总结一次。
4. Claude 的 5 小时额度不够做下一步、也做不完整个任务时，它会先停下等额度重置，期间每 50 分钟发一条一个字的保活消息，让上下文一直留在缓存里，重置后接着干，不用重新写入整个上下文；等 Codex 额度重置时也一样。
5. 如果中途断了，比如周额度用完或关了窗口，输入 `/collab continue` 接着跑。
6. 跑完后看 `.collab/report.md`，里面有每个阶段的额度消耗，停下等待时每条保活消息是否命中缓存。代码在 `collab/<名字>` 分支上，确认无误后由你自己合并。

笔记本跑的过程中不要合盖（或在"电源设置"里把插电时合盖改成"不采取任何操作"）。合盖会让电脑睡眠，自动续跑和防休眠都挡不住。

## Windows 和 WSL

同一个分支同时支持两种装法，流程、状态栏、Haiku 插件、缓存保活和需求对齐完全相同，只有脚本和安装步骤不同：

- **Windows**：Claude Code 直接装在 Windows 上，脚本是 `.ps1`。
- **WSL**：Claude Code 装在 WSL（Ubuntu）里，脚本是同名的 `.sh`。Codex 留下的进程由 systemd 统一清理，通知和防休眠通过 WSL 互操作交给 Windows。

## 新电脑安装

在任意目录打开 Claude Code，对它说：

- Windows：
  > 装好 git 和 GitHub CLI（gh），让我运行 `gh auth login` 登录，然后用 `gh repo clone 2498982541/collab-workflow "$USERPROFILE/collab-workflow"` 克隆这个仓库，再阅读其中的 INSTALL-windows.md 并按它安装。
- WSL：
  > 装好 git 和 GitHub CLI（gh），让我运行 `gh auth login` 登录，然后用 `gh repo clone 2498982541/collab-workflow ~/collab-workflow` 克隆这个仓库，再阅读其中的 INSTALL-wsl.md 并按它安装。

## 更新

在仓库目录运行 `git pull`。skill 是用目录链接装上的，拉取后直接生效。

以前装过 WSL 版的电脑还停在已删除的 `wsl` 分支上，在仓库目录运行一次 `git fetch && git switch main` 即可。

## 修改工作流

`.ps1` 脚本和同名的 `.sh` 是一对，改一个就要同步改另一个。SKILL.md 里的平台差异只写在开头的对照表里。两个平台相同的安装设置写在 INSTALL-shared.md。仓库里的 CLAUDE.md 写了同样的规则，在这个仓库里让 Claude 改东西时它会照做。

## 目录

```
skills/collab/      主流程（SKILL.md）、给 Codex 的任务和审查模板、脚本（Codex 启动与清理、哨兵和状态栏、防休眠、通知、找空闲端口；.ps1 给 Windows，同名 .sh 给 WSL），以及让 Haiku 总结 Codex 进展的小插件（自动加载）
skills/grilling/    需求对齐，改自 mattpocock/skills（MIT 许可），改成用中文、通过提问工具来问；安装时会替换本机已有的上游版本
INSTALL-*.md        给新电脑上的 AI 看的安装说明：windows、wsl 各一份，两边共用的部分在 shared
CLAUDE.md           在这个仓库里改工作流时给 Claude 看的规则
```
