# 🧸 DeepSeek 娘桌宠插件 —— 设计说明与安装使用指南

> 为 DeepSeek Harness 开发环境注入一个萌系「桌宠」助手：多状态动画、对话气泡、
> 鼠标交互、任务状态与账户余额实时反馈。

本仓库包含一个可直接安装的双面（node + 浏览器）DSH 插件包
[`dsh-pet-deepseek-girl/`](dsh-pet-deepseek-girl)，以及本文档。

---

## 一、功能总览（与需求规格的对应）

| 规格要求 | 实现 |
|---|---|
| 形象与资源 | 全盘采用「大肥鱼」DeepSeek 娘帧动画素材（50 张 238px PNG，19 组动画：待机/眨眼/环视/思考/工作/搜索/执行/等待/成功/出错/拖拽/摸头/戳戳/行走等），来自 dsh-dafeiyu；清单驱动逐帧播放，支持替换素材 |
| 任务状态气泡 | **会话事件驱动**：host 半用 PetStatusReducer 监听 session/event，区分思考（分析/准备）、工作（搜索/编辑/测试/执行）、等待确认（ask_user_question/审批）、出错、完成；浏览器轮询状态并驱动姿态与气泡文案 |
| 余额实时反馈 | 任务完成（SUCCESS 脉冲）时经同源 `/api/pet/balance` 查询余额，气泡显示「任务已完成 ✅ | 剩余额度：¥18.50」；失败（超时 / Key 无效）优雅降级；气泡按 `bubbleDuration` 自动消失 |
| 闲置休息 | 无任务且无交互达到 `idleTimeout`（默认 5 分钟）自动切换蹲坐 / 趴卧休息姿态 |
| 自由拖拽 | 左键按住拖拽，`position: fixed` 跟随鼠标，释放停留；位置持久化到 localStorage；拖拽时播放专用姿态 |
| 悬停反馈 | 悬停时播放「环视」动画（`hoverLook` 可关） |
| 交互 | 单击=戳戳反应、双击=摸头反应、右键=姿态菜单（站立/蹲坐/趴卧/思考/跳舞）+ 尺寸调节 + 重置位置 |
| 随机彩蛋 | 闲置时随机间隔冒出颜文字 / 吐槽，停留 2~3 秒（`activityLevel` 控制频率） |
| 设置卡 | 设置 → 插件 → DeepSeek 娘桌宠：启用/尺寸/气泡时长/活跃程度/子 Agent/悬停/余额，即时生效 |

## 二、架构设计

DSH 的 web 面插件是「双面包」：同一 npm 包同时提供 **node 半**（host 侧
行为）与 **浏览器半**（通过 `package.json` 的 `dsh.client` 声明被发现，
浏览器加载 `/plugins/<id>/client.js`）。

```
┌──────────────────────────── DSH Host 进程 ────────────────────────────┐
│  dsh-pet-deepseek-girl (node 半, lib/index.js)                          │
│   ├─ 订阅 session/event（global）→ PetStatusReducer 状态机             │
│   │    THINKING / WORKING(活动分类) / WAITING(等待确认/审批) /          │
│   │    ERROR / SUCCESS(瞬态脉冲) / IDLE，多会话优先级选取               │
│   ├─ 路由：GET /api/pet/status（状态快照+配置）                         │
│   │        GET /api/pet/balance（凭证进程内读取，3s 超时，不落日志）     │
│   │        GET/PATCH /plugins/dsh-pet-deepseek-girl/config（设置卡）    │
│   │        GET /plugins/dsh-pet-deepseek-girl/assets/*（帧动画素材）     │
│   └─ 注册设置命名空间 dsh-pet（patch yml 为 base 层）                   │
└──────────────────────────────┬─────────────────────────────────────────┘
                               │ 同源 fetch（无 CORS、无密钥暴露）
┌──────────────────────────────▼─────────────────────────────────────────┐
│  DSH Web GUI（浏览器）                                                   │
│  dsh-pet-deepseek-girl (浏览器半, lib/client.js)                         │
│   ├─ ctx.slots.register({name:"shell.overlay", id}) → 桌宠组件           │
│   ├─ 每 1.2s 轮询 /api/pet/status → 姿态/气泡（状态驱动）                │
│   ├─ pet-manifest.json 帧序列 → ClipPlayer 逐帧动画 + 空闲微动画          │
│   ├─ 交互：拖拽 / 戳戳 / 摸头 / 右键菜单 / 彩蛋                          │
│   ├─ 设置卡 settings.plugin.item（keyed=dsh-pet）经配置端点读写          │
│   └─ 降级：status 不可用→sessions running 位；素材缺失→内嵌 SVG          │
└─────────────────────────────────────────────────────────────────────────┘
```

要点：

- **UI 插槽**：使用 Harness 现成的 `shell.overlay` 插槽（`ui-layout` 在根
  插槽注册时声明，`kind: list, scope: root`，注册必须带唯一 `id`）。该层
  本身 `pointer-events: none`，桌宠根节点自行恢复交互。
- **状态监听（v0.3 核心）**：不靠轮询屏幕或猜测，而是 host 半订阅
  `session/event` 全局事件（turn/start、tool/call、tool/result、
  turn/end、approval、todo/write……），把真实 Agent 工作流折叠成桌宠状态。
  事件处理异常一律兜住，绝不打断共享事件总线的其它订阅者。
- **动画**：`assets/pet-manifest.json` 声明帧序列 clip（frames/frameMs/
  loop/motion），浏览器逐帧播放；空闲时随机插入眨眼/环视微动画。
- **余额安全**：apiKey 只存在于 host 进程；浏览器只拿结果。官方余额接口
  `GET https://api.deepseek.com/user/balance`。
- **降级**：状态端点、余额、素材、设置服务全部 try-catch / 可选注入，
  任何一环缺失桌宠照常工作（仅少显示相应信息）。

## 三、目录结构

```
deepseek娘/
├── README.md                        ← 本文档（设计 + 安装 + 使用）
├── tests/                           ← 验证脚本与测试夹具
│   ├── verify-host.mjs              ← host 半测试（状态/余额/配置端点/素材/安全）
│   ├── verify-reducer.mjs           ← 会话事件状态机单元测试
│   ├── verify-client.mjs            ← client 工厂校验
│   └── fixture-home/                ← 手动安装布局的测试夹具（DSH_HOME 草稿）
├── preview/                         ← 形象预览（index.html）
└── dsh-pet-deepseek-girl/           ← 插件包（可直接安装）
    ├── package.json                 ← dsh.bundle.patch + dsh.client 声明
    ├── cordis.patch.yml             ← 组合行插入（含全部配置项）
    ├── lib/index.js                 ← node 半（reducer 接线 + 路由）
    ├── lib/reducer.js               ← 会话事件状态机（改编自 dsh-dafeiyu）
    ├── lib/copy.js                  ← 状态气泡文案库
    ├── lib/client.js                ← 浏览器半（帧动画 + 轮询 + 设置卡）
    ├── assets/pet/                  ← 大肥鱼帧动画素材（50 张 PNG，19 组）
    ├── assets/pet-manifest.json     ← 帧序列清单（clips/stateMap/poseMap）
    ├── assets/SOURCES.md            ← 素材来源与许可说明
    ├── LICENSE
    └── README.md
```

## 四、安装

### 方式 A：dsh CLI + pnpm（推荐）

插件通过 DSH 的 profile 插件机制安装：把包加入
`$DSH_HOME/profiles/web` 的依赖与 `dsh.profile.bundles` 层列表。

```powershell
# 1) 让 CLI 指向与桌面 App 相同的 DSH_HOME（本机示例；其他环境按需修改）
$env:DSH_HOME = "$env:APPDATA\dsh-desktop\harness"

# 2) 安装插件（dsh bin 指向桌面 App 内置的 CLI 入口）
node "D:\APP\DSH Desktop\resources\app\node_modules\@deepseek-ai\dsh\lib\bin.js" `
     plugin --profile web add "C:\my deepseek horness\deepseek娘\dsh-pet-deepseek-girl"
```

- 首次执行会在 `$DSH_HOME/profiles/web` 初始化（若尚未初始化）。
- 命令末尾的路径会由 `dsh plugin` 自动解析为绝对路径并转交 pnpm；
  pnpm 负责把包安装进 profile 的 `node_modules`，并把包追加到
  `dsh.profile.bundles`（因为包声明了 `dsh.bundle.patch`）。
- 安装完成后 **重启桌面 App / 刷新 Web GUI**（组合层在启动时应用）。

### 方式 B：手动安装（无 pnpm / 不想用 CLI 时）

1. 把 `dsh-pet-deepseek-girl` 整个目录复制到
   `$DSH_HOME\profiles\web\node_modules\dsh-pet-deepseek-girl\`。
2. 编辑 `$DSH_HOME\profiles\web\package.json`：
   - `dependencies` 增加 `"dsh-pet-deepseek-girl": "file:<ASCII 绝对路径>"`；
   - `dsh.profile.bundles` 追加 `"dsh-pet-deepseek-girl"`。
3. 重启 App。

> ⚠️ **路径必须为纯 ASCII**：Windows 下如果插件目录路径含非 ASCII 字符
> （如中文目录名），Node 解析模块时会损坏路径，导致启动失败
> （`Cannot find package ...`）。本机建议把插件放到
> `C:\Users\<用户名>\dsh-pet-deepseek-girl`（纯 ASCII）。改完源码后运行
> `scripts\sync-live.ps1` 一键同步并重启即可。

### 方式 C：桌面 App 的插件管理

若桌面 App 的「设置 → 插件」面板支持从本地路径添加 bundle（与内置
`dshmarket` / 动态插件面板同级的 profile 插件管理），选择本目录即可；
原理与方式 A 相同（追加 bundles + pnpm install）。

### 验证安装

```powershell
# 检查组合树中出现 pet-deepseek-girl 行（不开服务）
node "D:\APP\DSH Desktop\resources\app\node_modules\@deepseek-ai\dsh\lib\bin.js" `
     --profile web --dump-config 2>$null | Select-String "pet-deepseek-girl"
```

浏览器验证：打开 GUI 后（需刷新页面）应看到右下角桌宠；
开发者控制台可检查 `/plugins/dsh-pet-deepseek-girl/client.js` 是否 200。

## 五、配置

| 配置项 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 启用桌宠（false 时隐藏） |
| `idleTimeout` | `300`（秒） | 无任务无交互超时后进入休息姿态 |
| `bubbleDuration` | `4000`（ms） | 完成/出错气泡展示时长，随后自动消失 |
| `easterEggMinMs` / `easterEggMaxMs` | `30000` / `90000` | 彩蛋随机间隔范围 |
| `easterEggDurationMs` | `2500`（ms） | 彩蛋停留时长 |
| `size` | `150`（px） | 桌宠尺寸 |
| `hoverLook` | `true` | 悬停时播放环视动画 |
| `showBalance` | `true` | 任务完成后展示余额 |
| `includeSubagents` | `false` | 是否响应子 Agent 会话 |
| `activityLevel` | `normal` | 空闲活跃程度：quiet / normal / lively |
| `apiKeyEnv` | `DEEPSEEK_API_KEY` | 余额查询的凭证引用 |
| `baseURL` / `balancePath` | `https://api.deepseek.com` / `/user/balance` | 余额接口 |
| `requestTimeoutMs` | `3000`（ms） | 余额请求超时 |

修改方式（二选一）：

1. **设置 → 插件 → DeepSeek 娘桌宠**（设置卡，即时生效）：经
   `GET/PATCH /plugins/dsh-pet-deepseek-girl/config` 写入
   `$DSH_HOME/settings.yaml` 的 `dsh-pet:` 段。
2. **profile 的 `cordis.patch.yml` / 本包 `cordis.patch.yml`**：覆盖默认值
   （作为设置命名空间的 base 层，重启生效）。

余额所用密钥：Web「模型」页写入的托管凭证（默认引用 `DEEPSEEK_API_KEY`），
或启动环境变量 `DEEPSEEK_API_KEY` —— 与 `dsh-llm-deepseek` 完全一致。

## 六、使用

| 操作 | 桌宠响应 |
|---|---|
| 左键按住拖拽 | 跟随鼠标（拖拽姿态），释放停留；重启恢复上次位置 |
| 单击 | 「戳戳」反应（戳戳动画 + 气泡） |
| 双击 | 「摸头」反应（摸头动画 + 气泡） |
| 右键点击 | 姿态菜单：站立 / 蹲坐 / 趴卧 / 思考 / 跳舞（立即生效）；尺寸 ±、重置位置 |
| 鼠标悬停 | 播放「环视」动画 |
| Harness 开始任务 | 「思考中…」+ 思考动画（准备/分析阶段文案轮换） |
| Harness 调用工具 | 「工作中」+ 活动分类动画与文案（搜索→奔走、执行→奔走、编辑/测试→工作） |
| Harness 等待用户/审批 | 「等你确认」+ 等待动画 |
| Harness 任务出错 | 「出错了」+ 生气动画（错误气泡） |
| Harness 任务结束 | 「任务已完成 ✅」+ 庆祝动画 + 实时余额，数秒后恢复闲置 |
| 闲置超时（默认 5 分钟） | 自动转为蹲坐 / 趴卧休息 |
| 空闲随机 | 冒颜文字 / 吐槽 2~3 秒 |
| 右键 → 重置位置 | 回到右下角默认位置 |

> 桌宠“看着”真实 Agent 事件流（不读屏、不猜），只做展示，不影响任务本身。

## 七、形象与自定义

- **默认形象（v0.3 起）**：全盘采用「大肥鱼」DeepSeek 娘帧动画素材（来自
  [QCYTSN/dsh-dafeiyu](https://github.com/QCYTSN/dsh-dafeiyu)，
  50 张 238px PNG，19 组动画）。`assets/pet-manifest.json` 声明帧序列与
  状态/姿态映射；浏览器逐帧播放，空闲时随机插入眨眼/环视。素材清单与许可
  说明见 `assets/SOURCES.md`（上游视觉文件未随 MIT 代码许可，公开发布前
  请自行确认授权）。
- **替换形象**：把新素材放入 `assets/pet/` 并调整 `pet-manifest.json`
  （clips / poseMap），或在设置里用
  `images: { stand: "/plugins/dsh-pet-deepseek-girl/assets/xxx.png", ... }`
  按姿态覆盖为单图（GIF/逐帧动画亦可）。
- **兜底**：素材清单不可用时显示 client 内嵌的简易 SVG，不影响主循环。

## 八、常见问题

- **桌宠没出现**：确认刷新了页面；`dsh --profile web --dump-config` 是否
  包含 `pet-deepseek-girl` 行；浏览器控制台 Network 中
  `/plugins/dsh-pet-deepseek-girl/client.js` 是否 200；若 404 说明包未进入
  profile 的 node_modules（重做安装）。
- **启动报 `list slot "shell.overlay" requires options.id`**：这是向 list 型
  插槽注册但未提供 `options.id` 所致（本插件 0.1.0 初版有该缺陷，已修复；
  任何注册 `shell.overlay` 的插件都必须带唯一 `id`）。
- **只显示「任务已完成」没有余额**：属预期降级。检查
  `settings.yaml` 的 `dsh-pet:` 段 `showBalance: true`、模型页已配置
  `DEEPSEEK_API_KEY`、网络可达 `api.deepseek.com`（3 秒超时）。
- **桌宠不在最顶层**：`shell.overlay` 覆盖层 z-index 为 20，一般足够；
  若与其它插件覆盖层冲突，可在 `shell.overlay` 内调整 z-index。
- **想完全卸载**：`dsh plugin --profile web remove dsh-pet-deepseek-girl`
  （或从 `package.json` 移除依赖与 bundles 后重启）。

## 九、测试

```powershell
$env:DSH_HOME = "$PWD\tests\fixture-home"

# 状态机：会话事件 → 状态/脉冲/优先级/子代理过滤
node tests\verify-reducer.mjs

# host 半：状态/余额/配置端点/素材服务/路径穿越/同源防护/降级
node tests\verify-host.mjs

# client 半：工厂可执行、导出与注入声明正确
node tests\verify-client.mjs
```

`tests/fixture-home` 是按「手动安装」方式摆放的测试夹具（含插件副本）；
先运行一次 `dsh --profile web --dump-config`（DSH_HOME 指向夹具）以建立
flat module fallback，host 测试才能解析 `@deepseek-ai/*` 依赖。

## 十、注意事项

- 当前 Harness 处于开发者预览版，客户端服务（`slots` / `sessions` /
  `settingsScope`）均为公开 API 但可能演进；建议锁定 DSH 版本使用。
- apiKey 不会出现在日志、localStorage 或任何浏览器存储中。
- 桌宠是 Web GUI 窗口内的悬浮层（应用覆盖层），并非操作系统级“全局置顶
  窗口”；如需真正桌面级置顶，需要桌面壳（Electron）提供原生透明窗口能力，
  不在本插件范围内。
