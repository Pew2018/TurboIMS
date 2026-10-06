# TurboIMS Classic System WebUI 技术与设计规范 v1.0

> 用途：把本文交给其他 LLM 或开发者，制作与 TurboIMS Next 当前 WebUI 在视觉、细节及界面交互方面一致的新 KernelSU / KernelSU Next 模块 WebUI。
>
> 基准：用户本次提供的 9 张截图，以及 Pew2018/TurboIMSNext 的 master 提交 `ca8a31d824fb0101324d01a0ed2fd660f736d53c`，提交说明为 `style(webui): lower dark primary surface lightness for classic white app-bar ink`。读取日期：2026-10-06（Asia/Taipei）。本次只读分析，没有修改仓库。

## 0. 阅读方式与证据边界

本文描述的是该提交实际实现的项目设计系统，不是对官方 Material Design 的逐条宣称。它吸收 Android 7/8、经典 Material 1/早期 2 和早期 OnePlus OxygenOS 设置页的特点，形成自己的系统工具界面。

所有尺寸默认是 **CSS px**；不可把截图的物理像素直接写进 CSS。截图中 690 px 的宽度包含设备像素比例、系统缩放及 WebView 的显示结果。排版以源码参数为准。

截图证明静态外观以及一次动画的中间帧；持续时间、滑动取消、历史栈、异步执行等行为以源码为依据。本文没有重新在 Android 真机执行测试，也没有重新运行仓库 Actions。附录中的颜色示例由当前源码的纯颜色函数计算。

仓库的 `docs/WEBUI_NAVIGATION.md` 包含早期阶段说明，例如「SIM 页面为空」及旧版全行涟漪描述；这些已与当前实现不一致。复现时以当前 `module/webroot/*` 为准，不能照搬旧文档或仅依据代码注释。

## 1. 设计语言：经典 Android 系统工具

目标感受：**清楚、紧凑、克制、锐利，像 Android 设置中的高级工具页面。**

主要识别特征：

- 小型固定顶栏，品牌标题和返回箭头明确；可选择中性顶栏或同色系着色顶栏。
- 页面主体由纵向设置行组成，左侧标题及说明，右侧值、开关或必要的跳转箭头。
- 用小字号分组标题和组间留白组织内容，不靠大标题、装饰插画或大量卡片堆叠。
- 方形操作按钮，准确说是 **2 px 小圆角矩形**，保留 OnePlus 式简洁、紧凑的操作区。
- 主操作为实色轻阴影按钮，次操作为同色系浅色面按钮；两者几何尺寸统一。
- 开关采用细轨道和独立圆形滑块，单选采用细圆环加圆点。
- 底部导航图标在上、文字在下，三个入口等宽；没有选中胶囊或大面积选中背景。
- 可切换平面分组与小圆角卡片分组；两种模式共享同一组排版及控件。
- 反馈来自短促、克制的点按涟漪、开关位移和对话框淡入淡出。
- 所有字体、图标与逻辑本地提供，不依赖 CDN 或在线资源。

复现约束：不加入 Material 3 胶囊、动态壁纸取色、模糊玻璃、噪点、渐变、巨大圆角、弹性动画、浮动导航、装饰性 Dashboard 卡片或现代拟物开关。这些会改变本项目的风格。

## 2. 工程结构与职责

当前是原生 HTML + CSS + JavaScript，没有必要引入 UI 框架才能实现。

| 文件 | 实际职责 | 新项目迁移原则 |
| --- | --- | --- |
| `index.html` | 页面骨架、静态控件、可访问性语义、底部 SVG 导航、共用对话框 | 保留结构模式，替换业务内容 |
| `style.css` | 设计 tokens、控件尺寸、主题基底、布局、动效 | 以语义变量驱动组件 |
| `startup.js` | 首次绘制前读取主题与卡片偏好；捕获初始化失败 | 小而早执行，不调用 root 操作 |
| `feedback.js` | 点按确认涟漪、对话框开关动效 | 与业务、路由、root 调用解耦 |
| `app.js` | 颜色生成、主题、路由、编辑页、对话框、状态渲染、业务交互 | 新项目可拆分，但行为需保持 |
| `bridge.js` | KernelSU Next 异步执行、动作白名单、输出解析 | 按新项目后端适配，不复制 IMS 命令 |

加载顺序：`startup.js` 在样式表前执行；样式表随后加载；`bridge.js`、`feedback.js`、`app.js` 使用 `defer`，保持依赖顺序。界面偏好与系统配置必须分开，不因切换主题或导航而调用特权写入。

## 3. 页面框架与滚动

页面分为顶栏、独立滚动内容区和一级底部导航。`body` 本身不滚动。

| 参数 | 当前值 |
| --- | --- |
| 顶栏内容高 | 56 px |
| 底部导航内容高 | 56 px |
| 主内容最大宽 | 620 px，居中 |
| 顶栏内部最大宽 | 620 px，居中 |
| 平面分组左右 padding | 24 px |
| 页面底部 padding | 32 px + 底部安全区 |
| 内容区 | `flex:1; min-height:0; overflow:auto` |
| 一级内容区底部预留 | 导航 56 px + 底部安全区 |

实现要点：

```css
html { height:100%; overscroll-behavior:none; }
body {
  margin:0; height:var(--app-viewport-height,100vh);
  min-height:0; display:flex; flex-direction:column; overflow:hidden;
}
.toolbar { flex:none; }
#page-content {
  flex:1; min-height:0; overflow:auto;
  overscroll-behavior-y:contain; touch-action:pan-y;
  contain:layout paint; -webkit-overflow-scrolling:touch;
  scroll-behavior:auto;
}
#page-content[data-primary="true"] {
  margin-bottom:calc(var(--bottom-nav-height) + var(--inset-bottom));
}
```

视口高度从 `100vh` 回退开始，依次在支持时使用 `100svh`、`100dvh`。不要给整个页面加滚动模拟器、惯性 JS、全局触摸拦截或强制平滑滚动。

## 4. 排版与视觉密度

字体：`Roboto, "Noto Sans", system-ui, sans-serif`。没有远程字体下载；设备没有前两种字体时自然使用系统回退。整个 body 为 `14px/1.4`。

| 角色 | 字号 | 字重 | 行高 / 补充 |
| --- | --- | --- | --- |
| 顶栏标题 | 20 px | 500 | 1.2 |
| 设置行主标题 | 16 px | 400 | 1.3 |
| 行下说明 | 13.5 px | 400 | 1.35，距标题 3 px |
| 右侧当前值 | 13 px | 400 | 1.3 |
| 分组标题 `.category` | 13 px | 500 | 1.25 |
| 状态正文 | 14 px | 400 | 默认正文节奏 |
| 提示与脚注 | 12 px | 400 | 1.5 |
| 主体操作按钮 | 14 px | 500 | 1.2；中日韩 15 px |
| 文本操作 / 对话框操作 | 13 px | 500 | 48 px 最小触摸高度 |
| 对话框标题 | 16 px | 400 | 1.3 |
| 对话框选项 | 14 px | 400 | 48 px 最小高度 |
| 底部导航标签 | 12 px | 400 | 1.2 |
| 色板名称 | 11 px | 400 | 居中 |
| 日志与 JSON | 12 px | 400 | 1.45，等宽字体 |

注意：HTML 使用 `<strong>` 表达设置项标题，但 CSS 明确将其设为 400。不要把所有主标题做成粗体，这会破坏密度和安静感。按钮中文不加额外字距、不强制大写、不换行。

源码定义了 `--section-label-size:12px`，实际 `.category` 使用 `13px`。复现应采用最终生效的规则，不能仅抄 token 名称。

## 5. 设置行、右侧值与箭头规则

普通设置行：最小高 64 px，纵向 padding 10 px，左文右控件，列间 gap 12 px；功能开关行最终最小高 68 px。跳转操作行 `.pref-action` 最小高 56 px。

左文容器 `flex:1; min-width:0`，允许说明自然换行；不要固定为单行省略。右值 `flex:none`，普通选择最多占 46%，功能行 42%，自定义 SIM 值 44%。右值使用次要文字色、右对齐、`overflow-wrap:anywhere`，末端 padding 4 px。

```html
<div class="setting-row">
  <span class="row-copy">
    <strong>执行方式</strong>
    <small>简短说明当前设置的作用。</small>
  </span>
  <button class="choice" type="button" aria-haspopup="dialog">当前值</button>
</div>
```

三种行为必须区分：

| 类型 | 右侧表现 | 点击行为 |
| --- | --- | --- |
| 布尔开关 | 自绘 Switch | 直接切换 |
| 列表选择 | 当前值，无箭头 | 打开自绘单选对话框 |
| 独立页面 | 箭头，可搭配值或小色块 | 进入子页面 |

箭头用 CSS 两条边绘制，尺寸 8×8 px、线宽 1.5 px、旋转 45°；不依赖图标字体。不要给每行一律加 `>`。

行点击与涟漪范围是两回事：部分选择行允许点击左侧说明来代理右侧按钮；`label` 开关行支持标签点击；IMS 功能行支持非控件区域切换。但普通 `.setting-row` 不统一绑定涟漪。自定义编辑行 `.sim-edit-row` 本身就是完整按钮，属于全行可点按并显示涟漪的例外。

## 6. 分组：平面与卡片是同一套组件的两种表面

### 6.1 平面模式

背景及分组表面浅色均为白；第一组直接开始。分组标题 padding 为上 16 px、下 8 px；后续组上间距 16 px，加一条弱 divider，padding-top 4 px。组内子标题通常上 padding 24 px，设备状态中的子标题为 16 px。

分割线仅用于组间结构，不为每一条设置行加线。行间层次主要靠高度、留白、字体和语义颜色。

### 6.2 卡片模式

| 参数 | 当前实现 |
| --- | --- |
| 页面浅色背景 | `#EEEEEE` |
| 浅色卡片 | `#FAFAFA` |
| 深色页面 | `#121212` |
| 深色卡片 | `#202020` |
| 卡片左右 margin | 14 px |
| 卡片左右 padding | 18 px |
| 卡片间距 | 12 px |
| 页面顶部 padding | 12 px |
| 卡片底部 padding | 12 px |
| 边框 | 1 px，浅色黑 .055 / 深色白 .05 |
| 圆角 | 2 px |
| 浅色阴影 | `0 1px 2px rgba(0,0,0,.08)` |
| 深色阴影 | 无 |

平面内容左起点为 24 px，卡片内容左起点约为 14 + 1 + 18 = 33 px。不要要求切换卡片后文字仍严格保持原横坐标，这是现有模式差异。

卡片是设置分组的容器，不将每条设置项单独做成卡片。对话框保持自己的表面，不随卡片模式改为页面灰底。

## 7. 主题基底与文字层级

| 语义角色 | 浅色 | 深色 |
| --- | --- | --- |
| 普通页面背景 | `#FFFFFF` | `#121212` |
| 普通表面 / 对话框 | `#FFFFFF` | `#212121` |
| 卡片表面 | `#FAFAFA` | `#202020` |
| 主文字 | `#212121` | 白色 .87 |
| 次文字 | `#707070` | 白色 .60 |
| 普通禁用文字 | `#BDBDBD` | 白色 .38 |
| Divider | 黑色 .06 | 白色 .055 |
| 日志表面 | `#F5F5F5` | `#1E1E1E` |
| 错误文字 | `#B3261E` | `#FFB4AB` |
| 对话框遮罩 | 黑色 .38 | 黑色 .48 |

主题必须有浅色、深色、跟随系统三项。偏好保存在 localStorage；跟随系统时监听 `prefers-color-scheme` 变化并立即更新。强制浅/深色时，系统变化不能改掉用户选择。

`data-theme`、根元素 `color-scheme`、颜色 tokens、主题相关 meta 和安全区背景一起更新。外观调整只影响 WebUI，不触发 root 配置修改。

## 8. 强调色：种子与语义角色必须分开

**不能把用户输入的 HEX 同时直接用于顶栏、按钮、按钮文字、分组文字和导航文字。** 这是当前设计质量最重要的技术基础。

### 8.1 角色映射

| 角色 / CSS 变量 | 用途 |
| --- | --- |
| `--accent` / `--accent-seed` / `--theme-seed` | 用户原始颜色，色板和小色块精确显示 |
| `--primary-surface` | 着色顶栏与主按钮表面 |
| `--on-primary` | 着色表面上的统一黑或白前景 |
| `--primary-surface-pressed` | 保持同一前景下的按下表面 |
| `--accent-ink` | 可读的强调色文字：分组、文本操作等 |
| `--control-accent` | 开关滑块、单选、一般涟漪等非文字控件 |
| `--control-accent-strong` | 聚焦轮廓等较强调的角色 |
| `--action-fill` / `--on-accent` | 主按钮背景和文字 |
| `--action-tonal` / `--on-action-tonal` | 次按钮背景和文字 |
| `--action-tonal-pressed` | 次按钮按下背景 |
| `--bottom-active-icon` | 底部选中图标 |
| `--bottom-active-label` | 底部选中标签 |
| `--switch-on-thumb` / `--switch-on-track` | 开启滑块和 50% 透明轨道 |
| `--accent-text` | 原始色板上勾号的黑/白前景 |

`--action-primary`、`--on-action-primary`、`--action-secondary` 等是同类角色别名；新项目可保留兼容，不能让别名与真实颜色分离。

### 8.2 对比度计算

使用 sRGB 相对亮度：先把每通道除以 255，小于等于 0.04045 时除以 12.92，否则用 `((c + .055) / 1.055) ** 2.4`。亮度权重为 `.2126 R + .7152 G + .0722 B`；对比度为 `(较亮 + .05) / (较暗 + .05)`。

当前算法生成文字色目标为 4.65:1，为最终四舍五入和状态留出余量；非文字控件目标 3.1:1。验收下限分别为 4.5:1 与 3:1。

文字色需要在所有会出现的背景上检查：浅色 `#FFFFFF / #FAFAFA / #EEEEEE`，深色 `#212121 / #202020 / #121212`。次按钮文字同时检查正常和按下背景。导航文字和图标分别生成，不因为标签不达标而随意把所有控件压成同一深色。

### 8.3 派生算法

在本地 JS 中转 OKLab，通过调 L 保持色相方向，仅在超出 sRGB 色域时压缩 a/b 对应的色度。无需 WebView 支持 CSS `oklch()`，最后输出普通 HEX / rgba。

`toneRgb()` 色域压缩使用 22 次二分；`readableTone()` 从原始 L 向浅色所需的更暗方向或深色所需的更亮方向逐步搜索，最多 200 步。所有判断基于最终量化后的 RGB，而不是理论未量化值。

主表面规则：

1. 浅色默认保留 seed；若白字不足 4.65，尝试同色相降低明度。
2. 不无限压暗所有颜色。按 OKLab 色相角，35°–150° 的最大 L 改变量为 .065，180°–270° 为 .19，其余为 .13；若白字所需改动太大，保留明亮表面并用黑字。
3. 浅色 `#2196F3` 有明确经典蓝例外，主表面为 `#1976D2`。
4. 深色主表面把 OKLab L 上限设为 **.50**，形成稳重且适合白字的深色顶栏/按钮。
5. `foregroundForRgb()` 对真实表面分别计算白字与黑字对比，选择更高者；前景只能是 `#FFFFFF` 或 `#000000`。
6. 主按钮按下时，白字背景 L 减 .035，黑字背景 L 加 .035；若使固定前景不足 4.5，维持原表面。
7. 次按钮背景为 `12% seed + 88% surface` 的逐通道 sRGB 混合，按下为 18%；文字单独派生。

这种设计有意允许浅色黄色/黄绿色使用黑字。不能为「所有按钮白字」而破坏当前颜色策略。深色截图里的蓝色顶栏不是直接使用 `#2196F3`，而是 `#0066AD`。

### 8.4 蓝色参考值：用于核对实现

seed 为 `#2196F3` 时：

| 角色 | 浅色 | 深色 |
| --- | --- | --- |
| 主表面 / 主按钮 | `#1976D2` | `#0066AD` |
| 主表面按下 | `#036BC6` | `#005C9D` |
| 主表面文字 | `#FFFFFF` | `#FFFFFF` |
| 强调文字 | `#006DB8` | `#2196F3` |
| 控件 / 开关滑块 | `#078AE7` | `#2196F3` |
| 次按钮 | `#E4F2FE` | `#212F3A` |
| 次按钮按下 | `#D7ECFD` | `#213647` |
| 次按钮文字 | `#006AB3` | `#36A3FF` |
| 导航激活图标 | `#2196F3` | `#2196F3` |
| 导航激活文字 | `#0077C8` | `#2196F3` |
| 色板勾号 | `#000000` | `#000000` |

数值用于该 seed 的参考，不能把蓝色表硬编码后声称支持任意颜色。完整算法见附录。

## 9. 顶栏、返回图标及安全区

顶栏总高度是 `56 px + --inset-top`，内部内容高 56 px，左右 padding 16 px，元素 gap 16 px。根页面隐藏返回按钮；子页面显示返回按钮。

返回触摸区域 48×48 px，左 margin -8 px。箭头由 11×11 px 的两条 2 px 边绘制，旋转 45°，从 `currentColor` 取色。

着色顶栏时：顶栏背景用派生主表面，标题和返回箭头统一从 `--on-primary` 继承前景，底部分割线透明。不能让文字仍使用普通浅色/深色正文变量；不能让返回图标被另一个强调色覆盖。

未着色时：浅色白底 / 深色 `#121212`，标题用主文字；「导航与返回图标」扩展选项可使返回图标使用强调文字。这个开关并不控制底部导航激活色；底部导航激活色始终属于标准控件颜色。

大多数子页面顶栏仍显示产品名 `TurboIMS Next`，具体页面标题由正文 `.category` 提供；**文本编辑页例外，顶栏显示正在编辑的字段名称**。不要根据路由名称自动把所有子页面顶栏标题改成不同标题。

安全区变量：

```css
--inset-top:var(--safe-area-inset-top, env(safe-area-inset-top, 0px));
--inset-bottom:var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px));
```

当前在 `location.hostname === "mui.kernelsu.org"` 且 `window.ksu?.enableInsets` 存在时，加载宿主的 `/internal/insets.css`，设置 `data-edge-to-edge="true"`。这属于宿主内部资源，不是远程 CDN。

edge-to-edge 时固定 `body::before/after` 分别覆盖状态栏与底部手势安全区，z-index 4、`pointer-events:none`；状态栏背景与顶栏一致，底部导航安全区使用主题 chromeColor（浅白、深 `#121212`）。同步 `theme-color`、`status-bar-color`、`navigation-bar-color` 作为提示。

**原生状态栏图标的黑白模式由 KernelSU 管理器控制。** meta 或 `data-status-bar-icons` 不保证能强制改变图标。截图中着色深顶栏仍出现黑色系统图标属于宿主约束，不能把它作为 WebUI 应主动绘制的样式。不要在页面中假画系统时钟、信号、键盘或手势条。

## 10. 方形操作按钮：形状与行为

| 属性 | 主操作与次操作共用 |
| --- | --- |
| 宽 | 112 px |
| 高 | 48 px |
| 圆角 | 2 px |
| 左右 padding | 16 px |
| 边框 | 1 px 透明 |
| 两按钮间距 | 12 px |
| 操作组顶部 margin | 10 px |
| 文字 | 单行，居中，500；中日韩 15 px |

主按钮用主表面、固定对应前景、`0 2px 3px rgba(0,0,0,.22)` 阴影；按下改背景并把阴影减为 `0 1px 2px rgba(0,0,0,.18)`。

次按钮用 accent tonal 背景和可读的强调文字，无阴影、不额外加实色边框；按下改为更强一点的 tonal 背景。它不是普通白色/灰色 outline 按钮。

**按下状态只改表面和阴影，不改文字颜色、不改标签。** 异步执行期间保持「应用配置」「恢复原值」之类的标签，进度说明放到页面状态区域；不要将按钮改成「处理中」或 Spinner 从而改变宽度。

正常按钮文字在独立 span 中，z-index 2；涟漪 z-index 1，避免遮住按钮文字。主按钮涟漪使用其前景色，opacity .14；次按钮用其文字色，opacity .12。

禁用状态不是整按钮淡出：`opacity:1`，浅色背景黑 .12 / 文字黑 .38，深色背景白 .12 / 文字白 .38，无阴影、透明边框。按钮不可点击或生成涟漪。

小于 310 px 宽时按钮组竖排，按钮仍保留紧凑宽度。文本编辑页是例外，`.text-editor-actions .action-button { flex:1; }` 让保存按钮占据可用宽度。

推荐标记：

```html
<div class="action-group" role="group" aria-label="页面操作">
  <button class="action-button action-button--primary" type="button">
    <span>应用配置</span>
  </button>
  <button class="action-button action-button--secondary" type="button">
    <span>恢复原值</span>
  </button>
</div>
<p class="hint action-summary">一句简短说明操作范围。</p>
```

文字操作用于「检测设备」「刷新」「取消」等，不把所有动作变成方形主按钮。文本操作最小 48 px 触摸尺寸，padding 10×12 px，使用 `--accent-ink`。

## 11. Switch：细轨道、独立滑块与状态区分

使用真实 `input type="checkbox" role="switch"` 保留基础语义，`appearance:none` 后自行绘制。外层 `.switch-hit` 为 48×48 px，用 Grid 居中，负责触摸和涟漪。

| 元素 | 参数 |
| --- | --- |
| 轨道 | 28×10 px，圆角 5 px |
| input margin | 0 3 px |
| 滑块 | 16×16 px，圆形 |
| 滑块起点 | `top:-3px; left:-2px` |
| 开启位移 | `translateX(16px)` |
| 滑块描边 | 1 px |
| 滑块阴影 | `0 1px 1px rgba(0,0,0,.12)` |
| 过渡 | 160 ms ease，仅颜色/位移/描边 |

ON：滑块为派生控件色；轨道是同一 RGB、**50% 透明度**。不开启额外 glow 或亮色外圈。

OFF：浅色轨道黑 .38、滑块 `#EEEEEE`、描边 `#858585`；深色轨道白 .30、滑块 `#BDBDBD`、描边 `#9E9E9E`。

Disabled 使用不透明专用色，并保持 ON/OFF 的位置含义：

| 角色 | 浅色 | 深色 |
| --- | --- | --- |
| 禁用 OFF 轨道 | `#D4D4D4` | `#353535` |
| 禁用 ON 轨道 | `#C0C0C0` | `#484848` |
| 禁用滑块 | `#BDBDBD` | `#616161` |
| 禁用描边 | `#A6A6A6` | `#757575` |

禁用 input `opacity:1`、去阴影；不要仅把 OFF 控件透明度降低，因为会使「可用但关闭」和「禁止操作」难以区分。

若后端是三态 ON / OFF / DEFAULT，界面仍是二态开关。DEFAULT 不是 OFF：原项目保留隐藏 select 存真实三态，通过 aria-label 明确「使用原值，点击强制开启」，单项恢复放设置中。新项目有类似三态时必须另给恢复默认入口，不能把关开关等同恢复原值。

## 12. 点按涟漪：本项目的关键交互细节

### 12.1 实际策略

**pointerdown 只记录；pointerup 确认点按后才创建圆形 DOM。** 不是手指一落下就在整行播放动画。

当前绑定范围：底部导航、开关触摸区域、文本操作、右侧 choice、对话框 option、色板按钮、`.sim-edit-row`、页面操作按钮、取消按钮、返回按钮以及显式 `[data-ripple='control']`。动态元素创建后必须再次调用绑定函数。

普通设置行和主滚动区不绑定 pointer 移动跟踪，不为了滑动创建反馈节点。不使用全局 pointermove、`preventDefault()` 或 pointer capture 拦截页面滚动。

### 12.2 点按判定

1. 仅响应主指针、鼠标主键。
2. 排除元素 disabled、包含禁用 input、位于 `aria-disabled="true"` 祖先下的控件。
3. down 保存 pointerId、clientX/Y 和内容区 scrollTop，存于 WeakMap。
4. `pointercancel` 清除记录。
5. up 必须是相同 pointerId；鼠标移动容差 8 px，触摸/其他容差 10 px。
6. 主内容区 scrollTop 变化超过 2 px 就取消涟漪。
7. `prefers-reduced-motion: reduce` 时不创建动画节点。

当前没有按时长排除长按的判断，也没有逐帧追踪全部位移轨迹；不能把它描述成已经实现了这两点。上述位移容差是 **视觉反馈判定**，业务 click 仍是独立的正常事件处理。

### 12.3 圆形几何

在确认后的 up 才读取控件 bounding rect；坐标来自真实松手位置：

```js
const x = event.clientX - rect.left;
const y = event.clientY - rect.top;
const radius = Math.hypot(
  Math.max(x, rect.width - x),
  Math.max(y, rect.height - y)
);
```

圆直径 `2*radius`，left 为 `x-radius`、top 为 `y-radius`，保证展开后覆盖控件最远角。宿主 `position:relative; overflow:hidden; isolation:isolate`，圆形被矩形控件边界裁切。

截图里横向椭圆/弧边的浅蓝反馈，是一个尚未完全展开的圆被设置行/选项矩形裁切的中间帧；不要静态画一块固定椭圆背景。

### 12.4 颜色与时序

| 参数 | 当前值 |
| --- | --- |
| 普通涟漪颜色 | `--control-accent` |
| 浅色 opacity | .14 |
| 深色 opacity | .18 |
| 主按钮 opacity | .14，颜色为对应前景 |
| 次按钮 opacity | .12，颜色为对应文字 |
| 时长 | 360 ms |
| Easing | ease-out |
| 起始 | scale(0)，立即使用目标 opacity |
| 55% 时刻 | 仍保持目标 opacity |
| 结束 | scale(1)，opacity 0 |
| 正常清理 | animationend 后 remove |
| 兜底清理 | 500 ms 定时 remove |

节点 `pointer-events:none`、`aria-hidden=true`，只对该临时节点设置 `will-change:transform,opacity`。WeakSet 避免重复绑定，WeakMap 保存短暂点按信息，避免常驻对象泄漏。

全局关闭 `-webkit-tap-highlight-color` 和 `-webkit-touch-callout`，避免 WebView 默认蓝块叠加。普通文本不允许选择；输入框、日志和诊断数据例外。

**键盘触发或脚本 button.click() 不会合成 pointer-origin 涟漪**，它们通过 focus-visible 表示键盘焦点。不要声称当前对键盘也生成了同样的圆形动画。

## 13. 自绘单选与确认对话框

当前内部 id 虽叫 `sheet`，实际外观是 **屏幕中央的紧凑 Dialog**，不是底部抽屉。

| 参数 | 当前值 |
| --- | --- |
| 遮罩 | fixed inset 0，z-index 10，居中 Flex |
| 屏幕边距 | 24 px |
| 最大宽 | 288 px |
| 最大高 | 85vh，内容可滚动 |
| 对话框 padding | 上 16 px、左右 18 px、下 7 px |
| 圆角 | 3 px |
| 阴影 | `0 8px 20px rgba(0,0,0,.16)` |
| 标题下 margin | 8 px |
| 选项 | 最小高 48 px，padding 6 px 0 |
| 底部动作 | 右对齐，gap 4 px，上 margin 4 px |

选项文本在左，单选圆环在右；圆环 16×16 px，2 px 描边，选中圆点 inset 4 px。圆点 opacity 和 scale(.5→1)、圆环颜色使用 160 ms ease。选中时及时更新 `role=radio`、`aria-checked`，而非只改视觉 class。

选中选项立即更新设置和选中视觉，延迟 **150 ms** 再关闭，留出看到涟漪与选中反馈的时间；取消和确认也保留同类短延迟。不要为等待整段 360 ms 涟漪而让所有选择明显迟钝。

进入：遮罩 opacity 0→1、面板 translateY(4px)→0，160 ms ease-out。退出：遮罩 opacity 1→0，100 ms ease-in；完成后隐藏、恢复焦点、resolve Promise 一次。使用 Web Animations API，并在重开/关闭前 cancel 旧动画。Reduced motion 时直接完成。

支持点遮罩、取消、Escape、系统返回关闭；Tab 焦点在对话框内循环，关闭后 `focus({preventScroll:true})` 返回原触发点。打开时锁住主滚动区。

标记需要 `role=dialog`、`aria-modal=true`、`aria-labelledby` 和 `aria-describedby`。不用 `alert()`、`confirm()`、`prompt()`；可保留隐藏 select 管理值，但不能展示浏览器原生 select UI。

## 14. 输入编辑页与软键盘

自定义字符串使用独立子页面，顶栏返回和字段标题，正文含小标题、标签、输入、提示、错误和保存按钮。不是浏览器 prompt，也不是巨型圆角文本框。

输入规则：背景透明/主题表面、无四周边框、0 圆角、底部 1 px 灰线。文本编辑 input 最小高 48 px、16 px 字号、padding 上 10 px/下 9 px；聚焦时底线用强强调色，加内侧 1 px 阴影。HEX 输入为 15 px，padding 上 8 px/下 6 px。

输入可选中、保留系统输入法；autocomplete off、spellcheck false。错误区域至少 18 px 高，减少出现错误时的跳动；无效时 `aria-invalid=true`、错误文字和下划线使用 danger，保存禁用。

编辑打开约 80 ms 后 focus，把光标移至末尾。根据字段规则清洗字符、大小写转换和校验，更新值时尽量保留光标。**输入保存可以只保存草稿；系统应用动作由独立应用按钮执行。** 不要把保存自定义字段自动变成 root 写入。

使用 `visualViewport.height` 更新 `--app-viewport-height`（最低 180 px），监听 visualViewport resize/scroll 及 window resize，使软键盘弹出后输入和操作仍可见。输入 `scrollIntoView({block:"center"})`。离开编辑页需 blur、清理编辑状态、移除临时 viewport height。

截图中聚焦后的外侧蓝色轮廓来自通用 `input:focus-visible`：2 px outline、offset 2 px，它可以与下划线同时存在。严格复现不要擅自删除；也不要误认为该输入在未聚焦时就是四边框。

样式还保留对话框 `data-ime=true` 时按 visualViewport 限高、可滚动内容与 sticky 底部动作的适配；当前自定义 SIM 字段主路径是独立编辑页，不能因存在这些 CSS 就声称所有输入都在对话框。

## 15. 强调色选择页与外观功能

两个预设分组和自定义 HEX：4 列 Grid，gap 纵 14 px / 横 6 px，色板方块 36×36 px、圆角 2 px、1 px 弱边框；整项 min-height 63 px，方块与名称 gap 5 px，名称 11 px。

选中方块显示 `✓`，19 px、500，黑或白颜色根据 **原始 seed** 的对比度计算。色块显示用户所选原值，不显示派生主表面。

| OnePlus Classic | HEX | Material Colors | HEX |
| --- | --- | --- | --- |
| OnePlus Blue | `#42A5F5` | Blue | `#2196F3` |
| Golden | `#CC6F4E` | Teal | `#009688` |
| Lemon Yellow | `#E6A545` | Green | `#4CAF50` |
| Grass Green | `#7DC22F` | Red | `#F44336` |
| Charm Purple | `#9575CD` | Orange | `#FF9800` |
| Sky Blue | `#26C6DA` | Purple | `#9C27B0` |
| Vigour Red | `#F06292` | Cyan | `#00BCD4` |
| Fashion Pink | `#BA68C8` | Indigo | `#3F51B5` |
| — | — | Pink | `#E91E63` |
| — | — | Blue Grey | `#607D8B` |
| — | — | Deep Orange | `#FF5722` |
| — | — | Light Green | `#8BC34A` |

默认 seed 是 `#42A5F5`，不是截图中用户后来选择的 `#2196F3`。

HEX：6 位 HEX + `#`，总长 7，统一大写，过滤非法字符；不完整显示「请输入 6 位 HEX 颜色值」，仅完整有效时立即应用并保存。选预设同样即时生效，不额外弹「确定」对话框。

外观功能包括：分组卡片、显示模式、强调色、额外着色范围。扩展范围包括顶栏背景、分组标题、顶栏返回图标；开关只影响对应范围，标准控件仍始终带强调色。

当前默认均为：跟随系统、卡片关闭、三个扩展范围关闭。截图展示的是用户打开部分选项后的外观，不能将其误写成所有新安装实例的默认值。

持久化 key：`turboims-theme`、`turboims-accent`、`turboims-card-groups`、`turboims-accent-toolbar`、`turboims-accent-section-labels`、`turboims-accent-navigation-icons`。新项目用自己的前缀，避免偏好串用。

## 16. 底部导航与历史返回

三个等权入口：IMS / SIM 卡信息 / 设置。其他项目按真实业务替换名称与本地 SVG，但保留同类三入口结构及交互方式。

导航固定在底部、内容高 56 px，安全区额外 padding；内部 max-width 620 px。图标 24×24 px、fill currentColor，图标和标签 gap 2 px，标签始终可见。各按钮 `flex:1`，不加圆角、选中胶囊、缩放或改变字号。

未选中用次文字色；选中标签用 `--bottom-active-label`、图标用 `--bottom-active-icon`。选中 `aria-current=page`。平面导航跟随页面背景；卡片导航使用普通 surface（浅白、深 `#212121`）。

路由原则：

- 一级 tab 切换用 `history.replaceState()`，不把每次切换加入返回栈。
- 子页面用不同 hash + `pushState()`，顶栏返回 `history.back()`。
- 同时监听 `popstate` 和 `hashchange`，统一同步显示。
- 页面 DOM 保持挂载，通过 hidden 切换，不因切 tab 丢失未应用表单。
- 每个一级页面单独记 scrollTop；子页面进入前将父级滚动记录在 history.state。
- `history.scrollRestoration="manual"`，明确恢复共享滚动容器的位置。
- 根页面无返回箭头、显示底导航；子页面显示返回箭头、隐藏底导航。
- 导航与历史同步不保存配置、不调用 root、不重新应用系统设置。

对话框也 push 一条临时 history；确认、取消和系统返回都消耗同一条记录。系统返回先关对话框，再回子页，再由宿主在无可返回历史时退出。已处理确认不得在浏览器 forward 中复活、重新执行。

KernelSU Next 宿主原生返回能力及预测返回动画属于宿主；WebUI 要提供真实 same-document history，不能仅维护一个 JS 数组然后期待宿主知道如何返回。浏览器测试不能代替真机手势验证。

## 17. 状态信息与诊断层级

设备状态留在主页顶部，是只读摘要：小状态圆点 + 一句状态标题，随后紧凑键值对和「检测设备」「刷新」文本操作。不得把它整体伪装成进入二级页的大卡片。

状态点 7×7 px、与文字 gap 11 px，顶部 offset 6 px。neutral 灰 `#9E9E9E`，success 使用 control accent，warning `#E6A545`，danger `#D32F2F`。当前 success 不固定为绿色，允许跟随主题；警告与危险保留独立语义。

键值对：13 px、左右对齐、gap 16 px、每行纵 padding 3 px；左项 muted、右值 ink。不要把所有正常结果做成彩色徽章。

分别表达「配置已验证」「IMS 已注册」「功能实际可用」，不将写入/读取成功等同于电话一定可用。缺失结果显示未查询/未知。不同项目同样需要区分任务执行、状态核对和最终效果。

主页信息用短中文；技术细节、逐项失败、原始 JSON 和日志放在诊断页面。日志 max-height 45vh、min-height 110 px、padding 12 px、0 圆角、`white-space:pre`，保留横向滚动，不把 JSON 强制换行到难以阅读。

普通页面禁用选中文字和长按菜单；输入、诊断摘要、SIM 数据和日志保留可选择复制。选中区域使用低透明度强调色（`rgba(--press-rgb,.22)`）。

## 18. 异步执行与 UI 流畅度

特权操作必须异步，通过宿主 `ksu.spawn` 返回 stdout/stderr 和退出事件。不要用同步 exec 阻塞主线程，也不要在 UI 点击回调中进行长时间同步 shell 操作。

原项目 `operation()` 使用 busy 标记防止并发；期间禁用会修改参数或启动操作的控件，保持顶栏返回和三个底部入口可用。进度在状态区域表达；按钮文本稳定；完成或失败在 finally 恢复控件，再重算业务依赖的禁用状态。

新项目应从实际业务条件重新计算禁用状态。例如没有定时检查时，间隔依然禁用。不要简单全量解禁后忘掉条件。

桥接动作白名单、输入校验、异步超时和输出大小限制属于工程质量。当前桥接超时 190 s 用于覆盖原项目执行器 180 s 限制；新项目应根据自己的执行器确定，不盲抄数值。**JS 超时并不取消已启动的 root 写入**，不能在超时后自动重新应用。

页面切换、主题变化和涟漪不调用桥接。滚动过程中不做高频布局测量；涟漪只在确认点按后测量一次；不为每行常驻 `will-change`。对话框只动画 opacity/transform，开关只动画自身状态。

## 19. 首屏与失败展示

初始 `html data-loading=true`；显示简单「正在加载…」和 64×2 px 的弱强调色线（opacity .45），隐藏尚未读取完整的主体和底部导航。无骨架卡片、进度大转圈或假状态。

startup.js 首次绘制前只预置主题和卡片偏好；完整 seed 调色与范围设置在 app.js 中初始化，不要声称所有外观 tokens 都已在首屏脚本预置。

初始只读 status 成功或失败后展示主体。主应用已运行但桥接慢时，6 s 到期仅结束加载视图，操作仍保持禁用到异步结束；不伪造配置、不追加第二次调用。主脚本根本未初始化时，startup.js 的 10 s 失败兜底给出错误和重新加载按钮。

捕获脚本加载失败、早期 error 和 unhandledrejection；不能失败后无限白屏。

## 20. 可访问性与响应式

真实 button/input、显式 type、switch role、radio group、dialog 语义、`aria-disabled`、`aria-invalid`、`aria-current`、`aria-pressed` 应与视觉同步。状态使用 role=status / aria-live=polite；图标和涟漪为 aria-hidden，SVG focusable=false。

`focus-visible` 统一为 2 px 强强调色轮廓、outline-offset 2 px，适用于按钮、输入、summary 和日志。不要用 outline:none 消灭键盘焦点。

小于 350 px：页面 padding 18 px、dialog padding 17 px、遮罩 padding 16 px、choice 最大宽 43%；4 列色板保留。小于 310 px：按钮组竖排。保持长中文说明和长值可换行，避免横向溢出。

Reduced motion：全局取消 transition/animation，feedback.js 不生成涟漪，对话框直接开关。不要仅改 duration 而保留一堆无用动画节点。

## 21. 当前实现的细小边界：复用时不要误读

这些是源码边界，不要求重现其中可能的遗漏：

- 普通行虽可能可点，未统一播放全行涟漪；`.sim-edit-row` 是例外。不要按旧导航文档实现全局全行反馈。
- 文本编辑页动态替换保存/清除按钮后，当前 `editTextPreference()` 没显式调用 `TouchFeedback.bind()`；startup 的失败重试按钮也晚于初次 bind。新项目应在所有动态按钮挂载后补绑定，让设计规则一致，而非复制遗漏。
- 保存/清除等动态按钮的文本当前可直接是 textContent；推荐复用时统一 label span 层级，避免 ripple 与文本争抢层级。
- `--pressed-opacity` 存在但不代表所有行有统一的按下背景；核心反馈是绑定控件上的 confirmed tap ripple。
- `data-ime` CSS 的存在不代表当前所有对话框都启用了键盘模式。
- 文案「使用柔和的同色系背景」不能理解为固定粉彩顶栏；真实算法使用对比度合格的主表面。
- 系统键盘、状态栏图标、预测返回动画不可通过 WebUI 复制来保证一致；需在目标管理器验证。

## 22. 给实施 LLM 的明确任务契约

请基于本文制作新的本地模块 WebUI，业务名称和字段按新项目替换。视觉及界面能力的默认实现必须满足以下约束：

1. 使用紧凑经典设置页结构、56 px 顶栏、56 px 三入口底导航、24 px 平面内容边距和 620 px 最大宽。
2. 保留平面/卡片两种模式、浅/深/跟随系统、两组强调色预设和自定义 HEX、额外着色范围开关及持久化。
3. 使用语义颜色生成算法；保持 seed 原值；按实际表面生成文字、控件、按钮和导航颜色。
4. 方形按钮是 112×48 px / 2 px 圆角；主实色、次同色系 tonal；按下及忙碌期间标签和文字颜色保持稳定。
5. 开关使用细轨道、16 px 圆形滑块、48 px hit area、50% ON 轨道；OFF 与 disabled 分开绘制。
6. 单选与确认对话框自绘；字段输入使用下划线式独立编辑页；不使用原生网页弹窗。
7. 使用真实 History API，tabs replace、子页 push、对话框临时 push；支持返回、滚动恢复、取消承诺和保留草稿。
8. 点按涟漪采用确认后创建、坐标起源、位移和滚动取消、360 ms 动画、500 ms 清理；滑动不制造蓝块。
9. root 桥接异步；主题/导航/涟漪不触发后端写入；进度和错误可见。
10. 全部资源本地；保留可访问性、键盘适配、安全区、reduced motion、初始化失败展示。

如果新项目缺少某类业务控件可以不显示，但基础外观设置和组件行为应可复用。不要为了「美化」改变上述形状、布局、排版和动效策略。新增业务功能不得藏入外观组件。

## 23. 验收清单

| 场景 | 预期 |
| --- | --- |
| 首次加载 / 重开 | 无白屏；主题和卡片偏好保留；无半初始化假数据 |
| 浅/深/系统 | 实时切换，正文、卡片、对话框、导航、安全区一致 |
| 全部预设和黑/白/黄/灰 seed | seed 不变；文字≥4.5:1；控件≥3:1 |
| 正常及按下按钮 | 前景与标签不变化；对应背景仍满足文字对比 |
| 普通滚动、从控件处开始滚动 | 无误涟漪，不阻塞惯性滚动 |
| 点击开关、choice、编辑行、色板、tab | 起点跟随点按坐标，裁切正确，不残留节点 |
| disabled input/button/row | 不操作、不产生涟漪，OFF/disabled 视觉可区分 |
| 连续打开关闭 Dialog | 无旧动画/Promise 重复、无涟漪残留 |
| 选择一项 | 立即更新单选状态，约150ms后开始关闭 |
| 系统返回 / Escape / 点遮罩 | 先取消 Dialog；没有保存或意外 root 操作 |
| 子页多层返回 | 回到直接父级；tab 仍正确；滚动恢复 |
| 连续切三 tab | 不积累返回步数、不丢失表单草稿、不调用写入 |
| 浏览器 forward / reload / hash | 已回答确认不复活，不重复执行 |
| 异步慢操作 / 失败 | 标签稳定、导航可用、状态可见、正确恢复禁用条件 |
| 输入与软键盘 | 输入/保存可见，光标和校验正常，退出恢复视口 |
| 长日志 / JSON | 可选择复制、横向滚动，不影响顶栏和导航 |
| 320 / 360 / 412 px 宽及更宽 | 说明/值不溢出；布局规则一致；宽屏居中 |
| Reduced motion | 不生成涟漪节点，开关与 Dialog 无动画 |
| 断网 | 本地 UI 和外观功能可用，没有字体/图标/CDN请求 |
| 真机 KernelSU 管理器 | 系统返回、安全区、键盘与宿主图标模式实际核对 |

当前仓库的 Node 回归覆盖了语义颜色、角色路由、按钮标签稳定、root 历史、单选状态、离线资源、异步桥接等；颜色测试包含全部预设、极值、灰阶以及 512 个确定性 RGB 样本。本文只检查了测试源码，没有重新声称这些测试已在本轮运行通过。

本轮另对读取到的纯颜色函数独立计算了 512 个确定性 RGB 样本，在浅/深交替模式下核对 2,048 组主/次按钮正常及按下表面与固定文字的对比度，均达到 4.5:1。这是颜色函数的有限抽样核对，不等同于运行完整仓库测试或真机验证。

## 24. 固定版本源码索引

- [index.html](https://github.com/Pew2018/TurboIMSNext/blob/ca8a31d824fb0101324d01a0ed2fd660f736d53c/module/webroot/index.html)：骨架、语义、对话框与 SVG。
- [style.css](https://github.com/Pew2018/TurboIMSNext/blob/ca8a31d824fb0101324d01a0ed2fd660f736d53c/module/webroot/style.css)：所有实际尺寸、颜色基底、组件状态与布局。
- [app.js](https://github.com/Pew2018/TurboIMSNext/blob/ca8a31d824fb0101324d01a0ed2fd660f736d53c/module/webroot/app.js)：调色、外观、路由、编辑、选择和操作。
- [feedback.js](https://github.com/Pew2018/TurboIMSNext/blob/ca8a31d824fb0101324d01a0ed2fd660f736d53c/module/webroot/feedback.js)：确认点按涟漪及 Dialog 动画。
- [startup.js](https://github.com/Pew2018/TurboIMSNext/blob/ca8a31d824fb0101324d01a0ed2fd660f736d53c/module/webroot/startup.js)：首屏偏好和失败兜底。
- [bridge.js](https://github.com/Pew2018/TurboIMSNext/blob/ca8a31d824fb0101324d01a0ed2fd660f736d53c/module/webroot/bridge.js)：异步宿主桥接。
- [ci/test_webui.cjs](https://github.com/Pew2018/TurboIMSNext/blob/ca8a31d824fb0101324d01a0ed2fd660f736d53c/ci/test_webui.cjs)：现有回归依据。

下列附录保留基准实现的纯颜色函数和反馈模块，供精确复现，不包含 IMS 后端代码。新项目需遵守原项目的适用授权，并调整业务相关标识。


## 附录 A. 当前纯颜色算法（可复用 JavaScript）

输入合法的 `#RRGGBB` 与布尔 `dark`，调用 `generateThemePalette(seed, dark)`。这个代码块保留基准源码；附录内未使用的便利函数也一并保留，便于比对。将返回值映射到第 8 节的 CSS 变量，不能只设置 `--accent`。

```js
function colorHex(rgb) { return "#" + rgb.map(value => Math.max(0,Math.min(255,Math.round(value))).toString(16).padStart(2,"0")).join("").toUpperCase(); }
function relativeLuminance(rgb) {
  const linear = rgb.map(c => {
    c /= 255;
    return c <= .04045 ? c/12.92 : ((c+.055)/1.055)**2.4;
  });
  return linear[0]*.2126 + linear[1]*.7152 + linear[2]*.0722;
}
function contrastRatio(a,b) {
  const lighter = Math.max(a,b), darker = Math.min(a,b);
  return (lighter + .05) / (darker + .05);
}
const LIGHT_FOREGROUND = "#FFFFFF";
const DARK_FOREGROUND = "#000000";
function rgbForHex(hex) { return [1,3,5].map(i => parseInt(hex.slice(i,i+2),16)); }
function foregroundForRgb(rgb) {
  const background = relativeLuminance(rgb);
  const white = contrastRatio(background,1), black = contrastRatio(background,0);
  return {color:white >= black ? LIGHT_FOREGROUND : DARK_FOREGROUND,contrast:Math.max(white,black)};
}
// Local OKLab/OKLCH lightness adjustment. Reduce chroma only when required to
// fit sRGB; no WebView OKLCH support or network dependency is needed.
function rgbToOklab(rgb) {
  const [r,g,b] = rgb.map(v => { v /= 255; return v <= .04045 ? v/12.92 : ((v+.055)/1.055)**2.4; });
  const l = Math.cbrt(.4122214708*r+.5363325363*g+.0514459929*b);
  const m = Math.cbrt(.2119034982*r+.6806995451*g+.1073969566*b);
  const s = Math.cbrt(.0883024619*r+.2817188376*g+.6299787005*b);
  return [.2104542553*l+.793617785*m-.0040720468*s,
    1.9779984951*l-2.428592205*m+.4505937099*s,
    .0259040371*l+.7827717662*m-.808675766*s];
}
function oklabToLinear([L,a,b]) {
  const l=(L+.3963377774*a+.2158037573*b)**3;
  const m=(L-.1055613458*a-.0638541728*b)**3;
  const s=(L-.0894841775*a-1.291485548*b)**3;
  return [4.0767416621*l-3.3077115913*m+.2309699292*s,
    -1.2684380046*l+2.6097574011*m-.3413193965*s,
    -.0041960863*l-.7034186147*m+1.707614701*s];
}
function toneRgb(rgb, lightness) {
  const [,a,b]=rgbToOklab(rgb), L=Math.max(0,Math.min(1,lightness));
  let chroma=1, linear=oklabToLinear([L,a,b]);
  if (!linear.every(v=>v>=-1e-7 && v<=1+1e-7)) {
    let lo=0,hi=1;
    for(let i=0;i<22;i++){
      const mid=(lo+hi)/2, values=oklabToLinear([L,a*mid,b*mid]);
      if(values.every(v=>v>=-1e-7 && v<=1+1e-7)) lo=mid; else hi=mid;
    }
    chroma=lo; linear=oklabToLinear([L,a*chroma,b*chroma]);
  }
  return linear.map(v=>{v=Math.max(0,Math.min(1,v));return Math.round(255*(v<=.0031308 ? 12.92*v : 1.055*v**(1/2.4)-.055));});
}
function readableTone(rgb, backgrounds, dark, target=4.65) {
  const start=rgbToOklab(rgb)[0];
  for(let step=0;step<=200;step++){
    const L=start+(dark ? 1-start : -start)*step/200;
    const ink=toneRgb(rgb,L);
    if(backgrounds.every(bg=>contrastRatio(relativeLuminance(ink),relativeLuminance(bg))>=target))
      return ink;
  }
  return dark ? [255,255,255] : [0,0,0];
}
function accentInkForRgb(rgb, backgrounds, dark) {
  return colorHex(readableTone(rgb,backgrounds,dark));
}
function mixRgb(a,b,strength) { return a.map((v,i)=>Math.round(v*strength+b[i]*(1-strength))); }
function pressedSurface(rgb, foreground, dark) {
  const white=foreground===LIGHT_FOREGROUND, L=rgbToOklab(rgb)[0];
  const pressed=toneRgb(rgb,L+(white ? -.035 : .035));
  if(contrastRatio(relativeLuminance(pressed),relativeLuminance(rgbForHex(foreground)))>=4.5) return pressed;
  return rgb; // Preserve the fixed foreground even at a gamut boundary.
}
// Only derived roles are adjusted. The chosen/saved seed and picker swatches
// remain exact. Warm/yellow-green themes retain a bright surface and black ink.
function primarySurfaceForRgb(rgb, dark) {
  const [L,a,b]=rgbToOklab(rgb);
  let surface=dark ? toneRgb(rgb,Math.min(L,.50)) : rgb;
  if(!dark && contrastRatio(relativeLuminance(surface),1)<4.65){
    const hue=(Math.atan2(b,a)*180/Math.PI+360)%360;
    const maxChange=hue>=35 && hue<=150 ? .065 : (hue>=180 && hue<=270 ? .19 : .13);
    const whiteSurface=readableTone(rgb,[[255,255,255]],false);
    if(L-rgbToOklab(whiteSurface)[0]<=maxChange) surface=whiteSurface;
  }
  // Classic blue app bar reference, still subject to final contrast checks.
  if(!dark && colorHex(rgb)==="#2196F3") surface=rgbForHex("#1976D2");
  return surface;
}
function generateThemePalette(seed, dark) {
  const rgb=rgbForHex(seed);
  const surface=dark ? [33,33,33] : [255,255,255];
  const card=dark ? [32,32,32] : [250,250,250];
  const page=dark ? [18,18,18] : [238,238,238];
  const backgrounds=[surface,card,page];
  const primary=primarySurfaceForRgb(rgb,dark);
  const onPrimary=foregroundForRgb(primary).color;
  const primaryPressed=pressedSurface(primary,onPrimary,dark);
  const ink=readableTone(rgb,backgrounds,dark);
  const control=readableTone(rgb,backgrounds,dark,3.1);
  const secondary=mixRgb(rgb,surface,.12);
  const secondaryPressed=mixRgb(rgb,surface,.18);
  const onSecondary=readableTone(rgb,[secondary,secondaryPressed],dark);
  const navBackgrounds=dark ? [[18,18,18],surface] : [[255,255,255],surface];
  const navIcon=readableTone(rgb,navBackgrounds,dark,3.1);
  const navLabel=readableTone(rgb,navBackgrounds,dark);
  return {
    seed,primarySurface:colorHex(primary),primaryPressed:colorHex(primaryPressed),
    primarySurfaceDark:colorHex(primarySurfaceForRgb(rgb,true)),onPrimary,
    accentInk:colorHex(ink),controlAccent:colorHex(control),controlStrong:colorHex(ink),
    actionPrimary:colorHex(primary),onActionPrimary:onPrimary,
    actionPrimaryPressed:colorHex(primaryPressed),
    actionSecondary:colorHex(secondary),onActionSecondary:colorHex(onSecondary),
    actionSecondaryPressed:colorHex(secondaryPressed),
    switchThumb:colorHex(control),switchTrack:"rgba("+control.join(",")+",.50)",
    navIcon:colorHex(navIcon),navLabel:colorHex(navLabel),
    swatchForeground:foregroundForRgb(rgb).color
  };
}
```

## 附录 B. 当前反馈模块（可复用 JavaScript）

模块依赖 `#page-content` 获取主页面滚动位置；对话框内部需 `.dialog`；通过 `window.TouchFeedback.bind(root)` 给新增按钮补绑定。应先加载此模块，再初始化应用的动态控件。顶部注释仅是历史说明，实际绑定、节点创建与测量行为请看代码。

```js
"use strict";
// Presentation only: lightweight dialog transitions. No document-level
// pointer listeners, transient nodes, layout measurement or scroll interception.
(() => {
  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const duration = (name, fallback) => {
    if (reduced()) return 0;
    return parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || fallback;
  };
  const dialogAnimations = new WeakMap();
  function cancelDialogAnimations(backdrop) {
    for (const animation of dialogAnimations.get(backdrop) || []) animation.cancel();
    dialogAnimations.delete(backdrop);
  }
  // Attach only to compact controls; rows and the scrolling viewport do not
  // observe pointer movement or allocate visual nodes.
  const bound = new WeakSet();
  const pending = new WeakMap();
  function bindRipple(surface) {
    if (!surface || bound.has(surface)) return;
    bound.add(surface);
    surface.dataset.ripple = "control";
    surface.addEventListener("pointerdown", event => {
      if (!event.isPrimary || event.button !== 0 || surface.disabled || surface.querySelector('input:disabled') ||
          surface.closest('[aria-disabled="true"]')) return;
      pending.set(surface,{
        id:event.pointerId,x:event.clientX,y:event.clientY,
        scroll:document.getElementById("page-content")?.scrollTop || 0
      });
    },{passive:true});
    surface.addEventListener("pointercancel",()=>pending.delete(surface),{passive:true});
    surface.addEventListener("pointerup",event => {
      const tap = pending.get(surface);
      pending.delete(surface);
      if (!tap || tap.id !== event.pointerId || surface.disabled || surface.querySelector('input:disabled') ||
          surface.closest('[aria-disabled="true"]')) return;
      const slop = event.pointerType === "mouse" ? 8 : 10;
      const scroll = document.getElementById("page-content")?.scrollTop || 0;
      if (Math.hypot(event.clientX-tap.x,event.clientY-tap.y)>slop ||
          Math.abs(scroll-tap.scroll)>2 ||
          matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const rect = surface.getBoundingClientRect();
      const x=event.clientX-rect.left,y=event.clientY-rect.top;
      const radius=Math.hypot(Math.max(x,rect.width-x),Math.max(y,rect.height-y));
      const circle=document.createElement("span");
      circle.className="tap-ripple";
      circle.style.width=circle.style.height=radius*2+"px";
      circle.style.left=x-radius+"px";
      circle.style.top=y-radius+"px";
      circle.setAttribute("aria-hidden","true");
      // WebView may skip animationend if a tab becomes hidden mid-animation.
      const cleanup = setTimeout(()=>circle.remove(),500);
      circle.addEventListener("animationend",()=>{
        clearTimeout(cleanup);
        circle.remove();
      },{once:true});
      surface.append(circle);
    },{passive:true});
  }
  function bind(root=document) {
    const selector=".bottom-tab,.switch-hit,.text-action,.choice,.option,.swatch-item,.sim-edit-row,.feature-reset,.action-button,.dialog-cancel,.back,[data-ripple='control']";
    if (root.matches?.(selector)) bindRipple(root);
    root.querySelectorAll?.(selector).forEach(bindRipple);
  }
  bind();
  window.TouchFeedback = {
    bind,
    openDialog(backdrop) {
      cancelDialogAnimations(backdrop);
      delete backdrop.dataset.closing;
      const dialog = backdrop.querySelector(".dialog");
      if (reduced() || !backdrop.animate) return;
      const time = duration("--dialog-enter-duration",160);
      const animations = [
        backdrop.animate([{opacity:0},{opacity:1}],{duration:time,easing:"ease-out"}),
        dialog.animate([{transform:"translateY(4px)"},{transform:"translateY(0)"}],{duration:time,easing:"ease-out"})
      ];
      dialogAnimations.set(backdrop,animations);
    },
    closeDialog(backdrop, complete) {
      cancelDialogAnimations(backdrop);
      backdrop.dataset.closing = "true";
      if (reduced() || !backdrop.animate) {
        delete backdrop.dataset.closing;
        complete();
        return;
      }
      const time = duration("--dialog-exit-duration",100);
      const animation = backdrop.animate(
        [{opacity:1},{opacity:0}],
        {duration:time,easing:"ease-in",fill:"forwards"}
      );
      dialogAnimations.set(backdrop,[animation]);
      animation.finished.catch(() => {}).then(() => {
        complete();
        cancelDialogAnimations(backdrop);
        delete backdrop.dataset.closing;
      });
    }
  };
})();
```

## 附录 C. 涟漪必需 CSS

以下与第 12 节配套；根变量及按钮专用覆盖也要保留，否则只能看到普通反馈，不能复现按钮层级与颜色。

```css
:root { --ripple-opacity:.14; --ripple-duration:360ms; }
:root[data-theme="dark"] { --ripple-opacity:.18; }
[data-ripple="control"],.bottom-tab { position:relative; overflow:hidden; isolation:isolate; }
.tap-ripple { position:absolute; z-index:1; border-radius:50%; pointer-events:none;
  background:var(--control-accent); opacity:0; transform:scale(0);
  will-change:transform,opacity;
  animation:tap-ripple var(--ripple-duration) ease-out forwards; }
@keyframes tap-ripple {
  0% { opacity:var(--ripple-opacity); transform:scale(0); }
  55% { opacity:var(--ripple-opacity); }
  100% { opacity:0; transform:scale(1); }
}
.action-button > span:not(.tap-ripple) { position:relative; z-index:2; }
.action-button--primary { --action-ripple:var(--on-accent); --ripple-opacity:.14; }
.action-button--secondary { --action-ripple:var(--on-action-tonal); --ripple-opacity:.12; }
.action-button .tap-ripple { background:var(--action-ripple); }
@media(prefers-reduced-motion:reduce) {
  * { transition:none !important; animation:none !important; }
  .tap-ripple { animation:none; display:none; }
}
```

## 附录 D. 快速交付检查顺序

先做好颜色 tokens 和布局骨架，再制作设置行、开关、按钮、对话框、编辑页、色板，随后接入涟漪和真实历史栈，最后接入异步后端。先对照蓝色浅/深参考值，再检查全部强调色和边界颜色，最终在目标 KernelSU 管理器上核对返回、安全区和键盘。

给实施者的最终要求：**交付可运行的本地 WebUI、完整外观功能和交互细节；不能只交一张相似静态页面。**
