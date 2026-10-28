# collab-workflow

大项目专用的 Claude + Codex 协作工作流，只在手动输入 `/collab` 时触发。

- **Claude**：和你对齐需求，规划架构，写前端视觉骨架，最后对照需求验收（包括前端好不好看）。
- **Codex**：按阶段写代码，并自己负责代码质量。
- **Pi（DeepSeek）**：只接大规模、模式化的批量活，比如照一个模板写几十个同构接口、批量迁移或铺测试数据，用的是 OpenCode Go 订阅里的 DeepSeek V4.1 Flash。Claude 规划时判断要不要用，多数任务用不到。它的活一旦出问题就整个交给 Codex，Codex 的代码审查也在 Codex 没额度时由它代做。

## 用法

1. 在项目目录打开 Claude Code，输入 `/collab`。
2. 先用 grilling 对齐需求，再确认它整理出的中文需求摘要和验收标准。给你确认之前，它会先让 Codex 和一个独立的 Claude 子代理各审一遍需求，改好后连同审阅意见摘要（采纳了什么、没采纳什么）一起给你看；之后的开发计划也会这样审一遍，但不再问你。只有这一步需要你参与，确认后它会全自动跑完。
3. 底部状态栏第一行是两边 5 小时额度的剩余和重置倒计时，以及上下文占用（灰色表示上次记录的值）。在运行 `/collab` 的窗口里，第二行是工作流进度：当前阶段、进度条，以及 Codex 正在做什么（Pi 铺量时显示完成了几个）。
4. Claude 或 Codex 的额度不够时，它会自己停下等重置，并在对话里说明在等什么、预计几点继续，期间每隔一段时间回一行等待状态；重置后接着跑，不用你管。如果 Codex 是 credits 用完、过了预计时间仍没恢复，会弹桌面通知提醒你，可能需要你充值。
5. 跑完后看 `.collab/report.md`：每条验收标准的结果和证据、它替你做的决定、你自己怎么验收（启动命令、用哪个浏览器打开、逐项怎么试），以及每个阶段的额度消耗。每条验收标准都有对应的检查脚本，提交在 `.collab/acceptance/`，你可以自己重跑。代码在 `collab/<名字>` 分支上，确认无误后由你自己合并。

跑的过程中不要关终端窗口，关了 Claude Code 就退出了。笔记本也不要合盖（或者在"电源设置"里把插电时合盖改成"不采取任何操作"），合盖会让电脑睡眠，自动续跑和防休眠都拦不住。

## 出事怎么办

- **它停下来找你：** 只有遇到重大分歧才会这样，同时会弹出桌面通知，状态栏显示"collab 等你决定"。直接在同一个窗口回复你的决定就行。
- **想中途停掉：** 按 Esc 打断，然后退出 Claude Code。正在跑的 Codex 和防休眠会一起结束；Claude 自己开的开发服务器可能还在，下次 `/collab continue` 时会清理掉。
- **中途断了**（关了窗口、周额度用完、主动停过）：在同一个项目目录输入 `/collab continue` 接着跑。

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
skills/collab/      主流程（SKILL.md）、给 Codex 的任务和审查模板、给 Pi 的任务模板、脚本（Codex 和 Pi 的启动与清理、Pi 的 git 拦截、哨兵和状态栏、防休眠、通知、找空闲端口；.ps1 给 Windows，同名 .sh 给 WSL），以及让 Haiku 总结 Codex 进展的小插件（自动加载）
skills/grilling/    需求对齐，改自 mattpocock/skills（MIT 许可），改成用中文、通过提问工具来问；安装时会替换本机已有的上游版本
INSTALL-*.md        给新电脑上的 AI 看的安装说明：windows、wsl 各一份，两边共用的部分在 shared
CLAUDE.md           在这个仓库里改工作流时给 Claude 看的规则
```
