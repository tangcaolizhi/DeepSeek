# dsh-pet-deepseek-girl

DeepSeek 娘桌宠插件 —— 为 DeepSeek Harness 注入一个随真实任务状态变化的萌系桌宠。

安装、配置与使用说明见仓库根目录的 [`README.md`](../README.md)。

## v0.3 特性

- **会话事件驱动**：host 半订阅 `session/event`，用 PetStatusReducer 区分
  思考 / 工作（搜索·编辑·测试·执行）/ 等待确认（ask_user_question·审批）/
  出错 / 完成，浏览器轮询 `/api/pet/status` 驱动姿态与气泡。
- **大肥鱼帧动画**：全盘采用 dsh-dafeiyu 的 50 张 PNG 帧（19 组动画），
  清单驱动逐帧播放 + 空闲微动画（眨眼/环视）。
- **交互**：拖拽 / 单击戳戳 / 双击摸头 / 右键菜单 / 悬停环视。
- **设置卡**：设置 → 插件 → DeepSeek 娘桌宠（启用/尺寸/气泡时长/活跃程度/
  子 Agent/悬停/余额），经 `GET/PATCH .../config` 即时生效。

## 包结构

```
dsh-pet-deepseek-girl/
├── package.json        # dsh.bundle.patch + dsh.client 声明（双面插件）
├── cordis.patch.yml    # 向 web profile 插入 pet-deepseek-girl 行（含全部配置项）
├── lib/
│   ├── index.js        # node 半：reducer 接线 + 状态/余额/配置端点 + 素材路由
│   ├── reducer.js      # 会话事件状态机（改编自 dsh-dafeiyu，MIT）
│   ├── copy.js         # 状态气泡文案库（DeepSeek 娘 persona）
│   └── client.js       # 浏览器半：帧动画播放器 + 状态轮询 + 设置卡
├── assets/
│   ├── pet/            # 大肥鱼帧动画素材（50 张 PNG，19 组）
│   ├── pet-manifest.json  # 帧序列清单（clips / stateMap / poseMap）
│   ├── pose-*.gif      # 早期蓝发鲸尾女仆 GIF（可通过 images 覆盖使用）
│   ├── spritesheet.webp / pet.json
│   ├── SOURCES.md      # 素材来源与许可说明
│   └── pet.svg         # 兜底形象（素材不可用时）
├── LICENSE
└── README.md
```

## 配置项（cordis.patch.yml → 设置命名空间 `dsh-pet`）

| 键 | 默认值 | 说明 |
|---|---|---|
| `enabled` | `true` | 启用桌宠 |
| `idleTimeout` | `300` | 闲置超时（秒），超时进入休息姿态 |
| `bubbleDuration` | `4000` | 完成/出错气泡展示时长（毫秒） |
| `easterEggMinMs` / `easterEggMaxMs` | `30000` / `90000` | 空闲彩蛋随机间隔范围（毫秒） |
| `easterEggDurationMs` | `2500` | 彩蛋气泡停留时长（毫秒） |
| `size` | `150` | 桌宠尺寸（px） |
| `hoverLook` | `true` | 悬停环视动画 |
| `showBalance` | `true` | 任务完成后查询并展示账户余额 |
| `includeSubagents` | `false` | 是否响应子 Agent 会话 |
| `activityLevel` | `normal` | 空闲活跃程度 quiet/normal/lively |
| `apiKeyEnv` | `DEEPSEEK_API_KEY` | 余额查询所用凭证引用 |
| `baseURL` / `balancePath` | `https://api.deepseek.com` / `/user/balance` | 余额接口地址 |
| `requestTimeoutMs` | `3000` | 余额请求超时（毫秒） |

## 安全与降级

- apiKey 只在 Harness 进程内读取（credentials 服务 / 启动环境变量），
  浏览器端与日志中均不出现。
- 余额查询失败（超时 / Key 无效 / 网络异常）自动降级为仅显示
  「任务已完成 ✅」，不影响桌宠主循环。
- 状态端点不可用 → 退回 sessions running 位模式；素材缺失 → 内嵌 SVG。
- 事件处理异常绝不外抛（不影响共享事件总线其它订阅者）。
