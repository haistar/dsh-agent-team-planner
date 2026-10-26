# DSH Agent Team Planner · Design System v1（Workbench）

> 适用：DSH Web 主区 Workbench（`sidebar.panellist` → `main` 面板）、会议横幅、配置页。
> 基调：**夜间开发者控制台**。深色、高密度、克制、可信；一屏判断"版本卡在哪、下一步做什么"。
> 旋钮：variance 3 / motion 2 / density 8。桌面 1440×900 优先，一页不滚动（列内滚动）。

## 1. 风格决策

| 排序 | 风格 | 采用度 | 原因 |
|---|---|---|---|
| 1 | Data-Dense Dashboard · dark | 采用 | 8–12px 紧凑间距、12–14px 字号、栅格化信息；与 density=8 一致 |
| 2 | Dark Mode (OLED) · restrained | 配色纪律 | 近黑蓝灰画布 + 单一强调色；不用纯黑 |
| 3 | Modern Dark (Cinema) | 仅参考层次 | 拒绝 glassmorphism / ambient glow / blur |
| — | Exaggerated Minimalism | 不采用 | 超大字号/留白与高密度看板冲突 |
| — | Cyberpunk / Neon | 拒绝 | 霓虹/发光在长时开发中伤眼且对比不稳 |

**原则**：层级靠明度差、状态靠少量语义色、结构靠 1px 描边与对齐；不做装饰性动画与光效。

## 2. 颜色令牌

| Token | HEX / 值 | 用途 |
|---|---|---|
| `--dt-canvas` | `#0F172A` | 应用底 |
| `--dt-surface` | `#1B2336` | 面板/卡片 |
| `--dt-surface-raised` | `#272F42` | 输入、悬浮、选中行 |
| `--dt-surface-sunken` | `#0F172A` | 代码块/凹槽 |
| `--dt-text-primary` | `#F8FAFC` | 主文本（对 canvas ≈15.8:1） |
| `--dt-text-secondary` | `#94A3B8` | 次要（对 surface ≈6.7:1） |
| `--dt-text-tertiary` | `#94A3B8` | 占位/弱信息（非关键） |
| `--dt-accent` | `#22C55E` | 唯一强调、当前阶段、主操作（对 canvas ≈5.8:1） |
| `--dt-accent-hover` | `#22C55E` | hover / focus ring |
| `--dt-accent-muted` | `#272F42` | 选中底、会议横幅 |
| `--dt-accent-foreground` | `#0F172A` | **强调色上的文字**（白字仅 3.2:1，禁用） |
| `--dt-border-subtle` | `#272F42` | 分隔线、卡片描边 |
| `--dt-border-strong` | `#334155` | hover/激活边界 |
| `--dt-border-control` | `#475569` | 输入/控件边界（非文本 3:1） |
| `--dt-success` / `bg` | `#22C55E` / `rgba(63,191,127,.12)` | 完成/确认 |
| `--dt-warning` / `bg` | `#FBBF24` / `rgba(217,164,65,.12)` | 待确认/门禁/阻塞 |
| `--dt-danger` / `bg` | `#EF4444` / `rgba(229,96,107,.12)` | 错误/危险 |
| `--dt-focus-ring` | `#22C55E` | `:focus-visible` 2px + offset 2 |

**规则**
- 一屏只有一个主强调色；语义色只做小面积（chip/2px 状态条/图标），不做整卡背景。
- 状态三重编码：文字 + 颜色 + 图标/形状；禁止只靠颜色。
- 正文 ≥4.5:1、大字/图标 ≥3:1；`text-tertiary` 不承载关键信息。

## 3. 字体

```css
--dt-font: "Inter","SF Pro Text","Segoe UI","PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif;
--dt-mono: "JetBrains Mono","Cascadia Code","SF Mono",Consolas,"Liberation Mono",monospace;
```

| Token | 字号/行高 | 用途 |
|---|---|---|
| overline | 10 / 1.2 | 极短标签（≤6 字，可大写 0.02em） |
| caption | 11 / 1.35 | 时间、ID、辅助说明 |
| body-sm | 12 / 1.4 | 列表次要行 |
| body | 12–13 / 1.45 | 主文本、表单、表格 |
| title | 14 / 1.3 | 区块标题 |
| page | 16 / 1.25 | 面板/页面标题 |
| display | 20 / 1.2 | 仅关键数字与 Modal 标题 |

> 字号取值为 `design.tokens.json` 的 `fontSize.scale`（10/11/12/13/14/16/20px），高密度下保持 4px 基准之外的声明式例外。

- 字重仅 400/500/600；数字与 ID 用 `tabular-nums`；ID/版本/taskId/JSON 用等宽字体。
- 中英混排保留 1/4 空格；中文用全角标点；不做全大写中文。

## 4. 间距 / 圆角 / 描边 / 阴影

| 维度 | 值 | 说明 |
|---|---|---|
| 间距 | 4 / 8 / 12 / 16 / 20 / 24 / 32 | 4px 基准；常用 8（列/卡片）、12（面板内）、16（Modal） |
| 组件高度 | chip 20–22、按钮/输入 28、工具栏 32–40、行 28–32 | density 8 |
| 圆角 | 4（控件）/ 6（卡片、面板）/ 8（Modal）；999 胶囊 | 不用 12/16 卡片 |
| 描边 | 1px `--dt-border-subtle`；控件 `--dt-border-control`；hover `--dt-border-strong` | 对齐靠描边而非阴影 |
| 焦点 | 2px `--dt-focus-ring`，offset 2 | 所有可交互元素 |
| 阴影 | 常规无；浮层 `0 4px 12px rgba(0,0,0,.35)`；Modal `0 16px 40px rgba(0,0,0,.55)` | 禁止 glow/彩色投影 |
| 动效 | 120–150ms；按压 scale(.98)；仅状态确认 | `prefers-reduced-motion` 可关闭 |

布局：页面 padding 8；主/侧列 gap 8；列内 gap 8；面板顶栏 ≥40px；整页 `overflow:hidden`，仅列内滚动；滚动区 ≤2 层。

## 5. UX 规则

1. **信息层级**：P0 当前版本/阶段/唯一下一步/阻塞 → P1 待人工处置 → P2 需求/任务/产出物/负载/时间线 → P3 日志/JSON。固定槽位，切版本不跳位。
2. **异步反馈**：首屏骨架（>300ms）；轮询保留旧数据、局部更新、不跳滚动；快速操作乐观更新 + 失败回滚；长任务控件内进度 + 取消，不锁面板；命令带 revision，旧响应不覆盖新状态。
3. **错误可执行**：`[错误码] 人话 → 下一步（具体按钮）[主操作]（折叠技术详情）`；门禁缺失项逐条可跳转；表单错误就地显示并保留输入；区分可重试/不可重试；禁止静默失败与只给原始 JSON。
4. **密度与可读**：行高 ≥20px；点击区 ≥24px；图标按钮有 tooltip + aria-label；列表标题单行省略 + tooltip；ID 等宽 + 复制；抽屉/Modal 单层。
5. **无障碍**：焦点可见、Esc 关闭 Modal、Tab 顺序按视觉、语义控件；对比达标。

## 6. 反模式（禁止）

- 霓虹/发光/玻璃拟态/环境光斑、纯黑 `#000` + 纯白 `#FFF`。
- 低对比灰字（<4.5:1）、全大写铺满、300 细体、<11px 正文。
- 每个卡片彩边/彩底/阴影；装饰性图表/假指标；超大 hero 字与极端留白。
- 弹窗套弹窗、自动刷新导致滚动跳动、截断无 tooltip/复制。
- 禁用按钮无原因、颜色作为唯一状态、装饰性循环动画、blur 降低文字对比。

## 7. 实现映射（本插件）

- Token 通过 `lib/client.js` 注入 `<style id="devteam-design-tokens">`，作用域 `.dt-root`；Workbench 根节点 `className="dt-root"`。
- 组件样式常量 `S.*` 全部改为 `var(--dt-*)`；主按钮使用 `--dt-accent` + `--dt-accent-foreground`（深色字）。
- Modal/抽屉在 `.dt-root` 子树内，继承 token；遮罩 `rgba(0,0,0,.55)`。
- 已加 `:focus-visible` 焦点环、细滚动条、`prefers-reduced-motion` 关闭动效。
- 验证：`npm test`（Host 12 + Client 18 + Renderer 43）；视觉走查按 `E2E-CHECKLIST.md` A–F。
