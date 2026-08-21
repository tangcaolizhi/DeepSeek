// ─────────────────────────────────────────────────────────────────────────────
// dsh-pet-deepseek-girl —— 浏览器（client）半
//
// 把 DeepSeek 娘（大肥鱼形象帧动画）桌宠渲染进 `shell.overlay` 插槽。
//
// v0.3 架构（借鉴 dsh-dafeiyu 的设计）：
//   · host 半用 PetStatusReducer 把 session/event 折叠成状态快照，
//     浏览器每 ~1.2s 轮询 /api/pet/status（状态驱动姿态与气泡）。
//   · 动画：assets/pet-manifest.json 定义帧序列 clip；ClipPlayer 逐帧播放，
//     空闲时随机插入眨眼/环视微动画。
//   · 交互：单击=戳戳、双击=摸头、拖拽=拖拽姿态、右键=菜单。
//   · 设置卡：注册进 settings.plugin.item（keyed 插槽），经
//     GET/PATCH /plugins/dsh-pet-deepseek-girl/config 读写。
//   · 降级：status 端点不可用时退回 session 列表 running 位模式；
//     素材清单不可用时退回内嵌 SVG。
// ─────────────────────────────────────────────────────────────────────────────
window.__ModuleLoader__.load({
	id: "dsh-pet-deepseek-girl",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let { jsx, jsxs, Fragment } = require("react/jsx-runtime");

		//#region 常量与工具
		const PLUGIN_ID = "dsh-pet-deepseek-girl";
		const ASSETS_BASE = `/plugins/${PLUGIN_ID}/assets`;
		const MANIFEST_URL = `${ASSETS_BASE}/pet-manifest.json`;
		const STATUS_URL = "/api/pet/status";
		const BALANCE_URL = "/api/pet/balance";
		const CONFIG_URL = `/plugins/${PLUGIN_ID}/config`;

		const POSE_STAND = "stand";
		const POSE_SQUAT = "squat";
		const POSE_LIE = "lie";
		const POSE_THINK = "think";
		const POSE_DANCE = "dance";
		const POSE_CELEBRATE = "celebrate";
		const POSES = [
			{ id: POSE_STAND, label: "站立" },
			{ id: POSE_SQUAT, label: "蹲坐" },
			{ id: POSE_LIE, label: "趴卧" },
			{ id: POSE_THINK, label: "思考" },
			{ id: POSE_DANCE, label: "跳舞" }
		];
		const REST_POSES = [POSE_SQUAT, POSE_LIE];

		const EASTER_EGGS = [
			"(´･ω･)",
			"(╯°□°)╯︵ ┻━┻",
			"(*´▽`*)",
			"(｡•̀ᴗ-)✧",
			"(ノ°ο°)ノ",
			"(＾▽＾)",
			"……Zzz",
			"摸鱼中～",
			"余额还剩多少呢？",
			"好耶！",
			"(¬‿¬)",
			"(•̀ᴗ•́)و",
			"右键可以换姿势哦～"
		];
		const POKE_COPY = ["戳我干嘛～(>_<)", "呀！", "别戳啦～"];
		const HEADPAT_COPY = ["摸摸头～(*´▽`*)", "蹭蹭～"];

		const CURRENCY_SYMBOLS = { CNY: "¥", USD: "$", EUR: "€", JPY: "¥", GBP: "£", HKD: "HK$", SGD: "S$" };

		const DEFAULTS = {
			enabled: true,
			idleTimeout: 300,
			bubbleDuration: 4000,
			easterEggMinMs: 30000,
			easterEggMaxMs: 90000,
			easterEggDurationMs: 2500,
			size: 150,
			hoverLook: true,
			showBalance: true,
			includeSubagents: false,
			activityLevel: "normal",
			images: {}
		};

		const LS = {
			pos: "dsh-pet-deepseek-girl:pos",
			pose: "dsh-pet-deepseek-girl:pose",
			size: "dsh-pet-deepseek-girl:size",
			welcome: "dsh-pet-deepseek-girl:welcome"
		};

		function readLS(key, fallback) {
			try {
				const raw = window.localStorage.getItem(key);
				return raw === null ? fallback : JSON.parse(raw);
			} catch {
				return fallback;
			}
		}
		function writeLS(key, value) {
			try {
				if (value === null || value === void 0) window.localStorage.removeItem(key);
				else window.localStorage.setItem(key, JSON.stringify(value));
			} catch {
				/* 隐私模式等场景下静默 */
			}
		}
		function clamp(value, min, max) {
			return value < min ? min : value > max ? max : value;
		}
		function pick(array) {
			return array[(Math.random() * array.length) | 0];
		}
		function formatBalance(primary) {
			const symbol = CURRENCY_SYMBOLS[primary.currency] ?? `${primary.currency} `;
			const total = Number.isFinite(primary.total) ? primary.total : 0;
			return `${symbol}${total.toFixed(2)}`;
		}
		async function fetchJson(url, options) {
			const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(4000), ...options });
			if (!response.ok) throw new Error(`http ${response.status}`);
			return response.json();
		}
		async function fetchBalance() {
			try {
				const data = await fetchJson(BALANCE_URL, { headers: { accept: "application/json" } });
				return data !== null && typeof data === "object" && data.ok === true ? data : null;
			} catch {
				return null;
			}
		}
		//#endregion

		//#region 内嵌兜底形象（素材清单/帧集不可用时的应急 SVG）
		const FALLBACK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" width="160" height="160"><ellipse cx="80" cy="150" rx="36" ry="6" fill="#232A4D" opacity="0.12"/><circle cx="80" cy="72" r="30" fill="#4D6BFE"/><ellipse cx="80" cy="82" rx="20" ry="16" fill="#FFE9D9"/><circle cx="70" cy="80" r="4" fill="#232A4D"/><circle cx="90" cy="80" r="4" fill="#232A4D"/><path d="M76 90 Q80 94 84 90" stroke="#232A4D" stroke-width="2" stroke-linecap="round" fill="none"/><rect x="58" y="104" width="44" height="34" rx="12" fill="#4D6BFE"/><circle cx="66" cy="96" r="7" fill="#4D6BFE"/><circle cx="94" cy="96" r="7" fill="#4D6BFE"/></svg>`;
		//#endregion

		//#region 样式（作用域限定在 .dsh-pet-stage 下）
		const CSS = `
.dsh-pet-stage{position:fixed;z-index:2147483000;pointer-events:auto;user-select:none;-webkit-user-select:none;touch-action:none;cursor:grab;font-family:system-ui,-apple-system,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;}
.dsh-pet-stage[data-dragging]{cursor:grabbing;}
.dsh-pet-anim{position:absolute;inset:0;}
.dsh-pet-img{width:100%;height:100%;object-fit:contain;pointer-events:none;image-rendering:auto;}
@keyframes dp-breathe{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-3px) scale(1.015)}}
@keyframes dp-think-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
@keyframes dp-bounce{0%,100%{transform:translateY(0)}30%{transform:translateY(-16px)}55%{transform:translateY(0)}75%{transform:translateY(-7px)}}
@keyframes dp-shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-4px)}40%{transform:translateX(4px)}60%{transform:translateX(-3px)}80%{transform:translateX(3px)}}
@keyframes dp-pop{from{transform:translateX(-50%) scale(.7);opacity:0}to{transform:translateX(-50%) scale(1);opacity:1}}
@keyframes dp-pop2{from{transform:scale(.92);opacity:0}to{transform:scale(1);opacity:1}}
@keyframes dp-pulse{0%,100%{opacity:1}50%{opacity:.55}}
.dsh-pet-stage[data-pose="stand"] .dsh-pet-anim{animation:dp-breathe 2.8s ease-in-out infinite;}
.dsh-pet-stage[data-pose="think"] .dsh-pet-anim{animation:dp-think-float 2.2s ease-in-out infinite;}
.dsh-pet-stage[data-pose="celebrate"] .dsh-pet-anim{animation:dp-bounce .9s ease-in-out 2;}
.dsh-pet-stage[data-pose="fail"] .dsh-pet-anim{animation:dp-shake .5s ease-in-out infinite;}
.dsh-pet-stage[data-pose="squat"] .dsh-pet-anim{transform:translateY(12%) scaleY(.96);}
.dsh-pet-stage[data-pose="lie"] .dsh-pet-anim{transform:rotate(90deg) translate(9%,11%) scale(.9);}
.dsh-pet-stage[data-dragging] .dsh-pet-anim{animation:none!important;transform:none;}
.dsh-pet-bubble{position:absolute;left:50%;bottom:calc(100% - 2px);transform:translateX(-50%);background:#fff;border:2px solid #4D6BFE;border-radius:12px;padding:6px 11px;font-size:13px;line-height:1.5;color:#232A4D;box-shadow:0 4px 14px rgba(35,42,77,.18);max-width:230px;text-align:center;animation:dp-pop .18s ease-out;pointer-events:none;z-index:2;white-space:normal;}
.dsh-pet-bubble:after{content:"";position:absolute;left:50%;bottom:-8px;transform:translateX(-50%);border:6px solid transparent;border-top-color:#4D6BFE;border-bottom:none;}
.dsh-pet-bubble:before{content:"";position:absolute;left:50%;bottom:-5px;transform:translateX(-50%);border:5px solid transparent;border-top-color:#fff;border-bottom:none;z-index:1;}
.dsh-pet-bubble[data-kind="think"]{animation:dp-pop .18s ease-out, dp-pulse 1.6s ease-in-out infinite;}
.dsh-pet-balance{color:#3A53D4;font-weight:600;font-variant-numeric:tabular-nums;margin-top:2px;}
.dsh-pet-menu{position:fixed;z-index:3;width:172px;background:#fff;border:1px solid rgba(77,107,254,.35);border-radius:12px;box-shadow:0 8px 28px rgba(35,42,77,.22);padding:8px;color:#232A4D;animation:dp-pop2 .12s ease-out;pointer-events:auto;}
.dsh-pet-menu-backdrop{position:fixed;inset:0;z-index:2;background:transparent;pointer-events:auto;}
.dsh-pet-menu-title{font-size:12px;font-weight:600;color:#4D6BFE;padding:4px 8px 6px;}
.dsh-pet-menu-group{display:flex;flex-direction:column;gap:2px;margin-bottom:6px;}
.dsh-pet-menu button{font:inherit;font-size:13px;color:#232A4D;background:transparent;border:none;border-radius:8px;padding:6px 8px;text-align:left;cursor:pointer;}
.dsh-pet-menu button:hover{background:rgba(77,107,254,.1);}
.dsh-pet-menu button[data-active]{color:#4D6BFE;font-weight:600;}
.dsh-pet-menu-row{flex-direction:row;align-items:center;justify-content:space-between;padding:0 4px;}
.dsh-pet-menu-row button{text-align:center;width:30px;height:28px;padding:0;background:rgba(77,107,254,.08);border-radius:8px;}
.dsh-pet-menu-row span{font-size:12px;color:#4D6BFE;}
.dsh-pet-menu-reset{border-top:1px solid rgba(77,107,254,.15);border-radius:0!important;margin-top:2px;padding-top:8px!important;color:#8A93B5!important;}
@media (prefers-reduced-motion:reduce){.dsh-pet-stage .dsh-pet-anim{animation:none!important}}
`;
		const CSS_TAG = "dsh-pet-deepseek-girl/pet.css";
		if (typeof document !== "undefined" && document.querySelector(`style[data-plugin-css=${JSON.stringify(CSS_TAG)}]`) === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = PLUGIN_ID;
			tag.dataset.pluginCss = CSS_TAG;
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}
		//#endregion

		//#region 素材清单与帧播放器
		function usePetManifest() {
			const [manifest, setManifest] = react.useState(null);
			react.useEffect(() => {
				let alive = true;
				fetchJson(MANIFEST_URL)
					.then((data) => {
						if (alive && data !== null && typeof data === "object") setManifest(data);
					})
					.catch(() => {
						if (alive) setManifest(null);
					});
				return () => {
					alive = false;
				};
			}, []);
			return manifest;
		}

		/** 预取清单中所有帧，保证播放无闪烁。 */
		function usePreloadFrames(manifest) {
			react.useEffect(() => {
				if (manifest === null || typeof manifest !== "object") return;
				const clips = manifest.clips ?? {};
				for (const clip of Object.values(clips)) {
					for (const frame of clip?.frames ?? []) {
						const image = new Image();
						image.src = `${ASSETS_BASE}/pet/${frame}`;
					}
				}
			}, [manifest]);
		}

		/** 解析姿态/状态 → clip 名。 */
		function clipNameOf(manifest, pose) {
			if (manifest === null || typeof manifest !== "object") return null;
			return manifest.poseMap?.[pose] ?? pose;
		}

		/** 单帧播放器：按 frameMs 循环/单次切换帧。 */
		function ClipPlayer({ clip, reducedMotion }) {
			const frames = clip?.frames ?? [];
			const frameMs = clip?.frameMs ?? 180;
			const loop = clip?.loop !== false;
			const indexRef = react.useRef(0);
			const [index, setIndex] = react.useState(0);
			react.useEffect(() => {
				indexRef.current = 0;
				setIndex(0);
				if (frames.length <= 1 || reducedMotion) return;
				let alive = true;
				let timer;
				const step = () => {
					if (!alive) return;
					const next = indexRef.current + 1;
					if (next >= frames.length) {
						if (!loop) return;
						indexRef.current = 0;
						setIndex(0);
						timer = setTimeout(step, frameMs);
						return;
					}
					indexRef.current = next;
					setIndex(next);
					timer = setTimeout(step, frameMs);
				};
				timer = setTimeout(step, frameMs);
				return () => {
					alive = false;
					clearTimeout(timer);
				};
			}, [frames, frameMs, loop, reducedMotion]);
			const src = frames[Math.min(index, frames.length - 1)];
			if (!src) return null;
			return jsx("img", { className: "dsh-pet-img", src: `${ASSETS_BASE}/pet/${src}`, alt: "DeepSeek 娘", draggable: false });
		}

		/** 形象渲染：单图覆盖（images 配置）> 帧动画 clip > 内嵌兜底。 */
		function Sprite({ pose, manifest, images, reducedMotion }) {
			const override = images === void 0 ? void 0 : images[pose];
			if (typeof override === "string" && override.length > 0) {
				return jsx("img", { className: "dsh-pet-img", src: override, alt: "DeepSeek 娘", draggable: false });
			}
			const clipName = clipNameOf(manifest, pose);
			const clip = manifest === null || manifest === void 0 ? null : (manifest.clips?.[clipName] ?? null);
			if (clip !== null) {
				return jsx(ClipPlayer, { clip, reducedMotion });
			}
			return jsx("div", { className: "dsh-pet-svg", dangerouslySetInnerHTML: { __html: FALLBACK_SVG } });
		}
		//#endregion

		//#region 配置（设置命名空间 → 默认值）
		function useScopeConfig(scope) {
			const [snapshot, setSnapshot] = react.useState(() => (scope === void 0 ? null : scope.getSnapshot()));
			react.useEffect(() => {
				if (scope === void 0) return;
				setSnapshot(scope.getSnapshot());
				const off = scope.subscribe(() => setSnapshot(scope.getSnapshot()));
				return off;
			}, [scope]);
			return react.useMemo(() => {
				const base = snapshot === null || snapshot === void 0 ? void 0 : snapshot.value;
				const merged = { ...DEFAULTS, ...(base !== null && typeof base === "object" ? base : {}) };
				for (const key of ["idleTimeout", "bubbleDuration", "easterEggMinMs", "easterEggMaxMs", "easterEggDurationMs", "size"]) {
					const value = merged[key];
					if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) merged[key] = DEFAULTS[key];
				}
				for (const key of ["enabled", "hoverLook", "showBalance", "includeSubagents"]) {
					if (typeof merged[key] !== "boolean") merged[key] = DEFAULTS[key];
				}
				if (!["quiet", "normal", "lively"].includes(merged.activityLevel)) merged.activityLevel = DEFAULTS.activityLevel;
				if (merged.images === null || typeof merged.images !== "object" || Array.isArray(merged.images)) merged.images = {};
				return merged;
			}, [snapshot]);
		}
		//#endregion

		//#region 气泡
		function BubbleView({ bubble }) {
			if (bubble === null) return null;
			if (bubble.kind === "done") {
				const balance = bubble.balance;
				const line = balance !== null && balance !== void 0 && balance.ok === true && balance.primary !== void 0 ? formatBalance(balance.primary) : null;
				return jsxs("div", {
					className: "dsh-pet-bubble",
					"data-kind": "done",
					children: [
						jsx("div", { children: "任务已完成 ✅" }),
						line !== null && jsx("div", { className: "dsh-pet-balance", children: `剩余额度：${line}` })
					]
				});
			}
			if (bubble.kind === "state") {
				return jsx("div", { className: "dsh-pet-bubble", "data-kind": bubble.state === "WAITING" ? "think" : "state", children: bubble.text });
			}
			return jsx("div", { className: "dsh-pet-bubble", "data-kind": "egg", children: bubble.text });
		}
		//#endregion

		//#region 右键菜单
		function MenuView({ menu, manualPose, size, onChoose, onSize, onReset }) {
			return jsxs("div", {
				className: "dsh-pet-menu",
				style: { left: menu.x, top: menu.y },
				"data-dsh-pet-ui": true,
				onContextMenu: (event) => event.stopPropagation(),
				children: [
					jsx("div", { className: "dsh-pet-menu-title", children: "DeepSeek 娘" }),
					jsx("div", {
						className: "dsh-pet-menu-group",
						children: POSES.map((pose) => jsx("button", {
							type: "button",
							"data-active": manualPose === pose.id || void 0,
							onClick: () => onChoose(pose.id),
							children: `${pose.label}${manualPose === pose.id ? "  ✓" : ""}`
						}, pose.id))
					}),
					jsxs("div", {
						className: "dsh-pet-menu-group dsh-pet-menu-row",
						children: [
							jsx("button", { type: "button", "aria-label": "缩小", onClick: () => onSize(-10), children: "−" }),
							jsx("span", { children: `${size}px` }),
							jsx("button", { type: "button", "aria-label": "放大", onClick: () => onSize(10), children: "+" })
						]
					}),
					jsx("button", { type: "button", className: "dsh-pet-menu-reset", onClick: onReset, children: "重置位置" })
				]
			});
		}
		//#endregion

		//#region 桌宠主组件
		function PetOverlay({ useSessions, scope }) {
			const cfg = useScopeConfig(scope);
			const manifest = usePetManifest();
			usePreloadFrames(manifest);

			// —— 状态与镜像 ref ——
			const [anyRunning, setAnyRunning] = react.useState(false);
			const [manualPose, setManualPose] = react.useState(() => readLS(LS.pose, POSE_STAND));
			const [bubble, setBubbleState] = react.useState(null);
			const [pos, setPos] = react.useState(() => readLS(LS.pos, null));
			const [sizeState, setSizeState] = react.useState(() => readLS(LS.size, null));
			const [dragging, setDragging] = react.useState(false);
			const [menu, setMenu] = react.useState(null);
			const [hovering, setHovering] = react.useState(false);
			const [welcome, setWelcome] = react.useState(() => readLS(LS.welcome, false) !== true);
			const [status, setStatus] = react.useState(null);
			const [transientPose, setTransientPose] = react.useState(null);
			const [idleClip, setIdleClip] = react.useState(null);

			const size = sizeState ?? cfg.size;
			const bubbleRef = react.useRef(null);
			const manualPoseRef = react.useRef(manualPose);
			const sizeRef = react.useRef(size);
			const posRef = react.useRef(pos);
			const draggingRef = react.useRef(false);
			const timers = react.useRef({ idle: void 0, bubble: void 0, egg: void 0, transient: void 0, click: void 0 });
			const stageRef = react.useRef(null);
			const dragRef = react.useRef(null);
			const pulseSeen = react.useRef(0);
			const prevRunning = react.useRef(null);

			react.useEffect(() => {
				bubbleRef.current = bubble;
				manualPoseRef.current = manualPose;
				sizeRef.current = size;
				posRef.current = pos;
				draggingRef.current = dragging;
			});

			const setBubble = react.useCallback((next) => setBubbleState(next), []);

			// —— status 轮询（含 enabled） ——
			react.useEffect(() => {
				let alive = true;
				let timer;
				const poll = async () => {
					try {
						const data = await fetchJson(STATUS_URL);
						if (alive) setStatus(data !== null && typeof data === "object" && data.ok === true ? data : null);
					} catch {
						if (alive) setStatus(null);
					}
				};
				poll();
				timer = setInterval(poll, 1200);
				const onVis = () => {
					if (document.visibilityState === "visible") void poll();
				};
				document.addEventListener("visibilitychange", onVis);
				return () => {
					alive = false;
					clearInterval(timer);
					document.removeEventListener("visibilitychange", onVis);
				};
			}, []);

			const statusMode = status !== null && status.enabled !== false;
			const statusSnapshot = statusMode ? status.status : null;

			// —— 回退模式：status 不可用时用 sessions running 位 ——
			const selectedRunning = useSessions === void 0 ? false : useSessions((snapshot) => {
				const byId = snapshot === null || snapshot === void 0 ? void 0 : snapshot.byId;
				if (byId === void 0) return false;
				for (const key of Object.keys(byId)) {
					if (byId[key] !== null && byId[key] !== void 0 && byId[key].running === true) return true;
				}
				return false;
			});
			react.useEffect(() => {
				setAnyRunning(selectedRunning);
			}, [selectedRunning]);

			react.useEffect(() => {
				if (statusMode) {
					prevRunning.current = selectedRunning;
					return;
				}
				const prev = prevRunning.current;
				prevRunning.current = selectedRunning;
				if (prev === null) return;
				if (selectedRunning && !prev) {
					setBubble({ kind: "state", state: "THINKING", text: "思考中… 🤔", transient: false });
				} else if (!selectedRunning && prev) {
					setBubble({ kind: "done", transient: true });
					if (cfg.showBalance) {
						fetchBalance().then((balance) => {
							setBubble((cur) => (cur !== null && cur.kind === "done" ? { ...cur, balance } : cur));
						});
					}
					clearTimeout(timers.current.bubble);
					timers.current.bubble = setTimeout(() => setBubble(null), cfg.bubbleDuration);
				}
			}, [selectedRunning, statusMode, cfg.showBalance, cfg.bubbleDuration, setBubble]);

			// —— 瞬态脉冲（SUCCESS/ERROR） ——
			react.useEffect(() => {
				const pulse = statusSnapshot === null || statusSnapshot === void 0 ? null : statusSnapshot.pulse;
				if (pulse === null || pulse === void 0) return;
				if (pulse.id === pulseSeen.current) return;
				pulseSeen.current = pulse.id;
				if (pulse.state === "SUCCESS") {
					setTransientPose(POSE_CELEBRATE);
					setBubble({ kind: "done", transient: true });
					if (cfg.showBalance) {
						fetchBalance().then((balance) => {
							setBubble((cur) => (cur !== null && cur.kind === "done" ? { ...cur, balance } : cur));
						});
					}
					clearTimeout(timers.current.transient);
					timers.current.transient = setTimeout(() => {
						setTransientPose(null);
						setBubble(null);
					}, cfg.bubbleDuration);
				} else if (pulse.state === "ERROR") {
					setTransientPose("fail");
					setBubble({ kind: "state", state: "ERROR", text: pulse.message ?? "出错了 😢", transient: true });
					clearTimeout(timers.current.transient);
					timers.current.transient = setTimeout(() => {
						setTransientPose(null);
						setBubble(null);
					}, cfg.bubbleDuration);
				}
			}, [statusSnapshot, cfg.showBalance, cfg.bubbleDuration, setBubble]);

			// —— 状态气泡（无瞬态气泡时显示） ——
			react.useEffect(() => {
				if (!statusMode) return;
				const snap = statusSnapshot;
				if (snap === null || snap === void 0) return;
				const active = snap.state === "THINKING" || snap.state === "WORKING" || snap.state === "WAITING" || snap.state === "ERROR";
				const cur = bubbleRef.current;
				if (!active) {
					if (cur !== null && cur.kind === "state" && cur.transient !== true) setBubble(null);
					return;
				}
				if (cur !== null && (cur.transient === true || cur.kind !== "state")) return;
				setBubble({ kind: "state", state: snap.state, text: snap.message ?? "……", transient: false });
			}, [statusSnapshot, statusMode, setBubble]);

			// —— 有效姿态推导 ——
			const derivedPose = react.useMemo(() => {
				if (dragging) return "drag";
				if (transientPose !== null) return transientPose;
				if (statusMode) {
					const snap = statusSnapshot;
					const state = snap === null || snap === void 0 ? void 0 : snap.state;
					if (state === "THINKING") return POSE_THINK;
					if (state === "WORKING") {
						const activity = snap === null || snap === void 0 ? void 0 : snap.activity;
						return activity === "searching" ? "search" : activity === "commanding" ? "command" : POSE_THINK;
					}
					if (state === "WAITING") return POSE_SQUAT;
					if (state === "ERROR") return "fail";
					return manualPose;
				}
				return anyRunning ? POSE_THINK : manualPose;
			}, [dragging, transientPose, statusMode, statusSnapshot, anyRunning, manualPose]);

			// —— 空闲微动画（待机随机眨眼/环视；悬停环视） ——
			react.useEffect(() => {
				if (derivedPose !== POSE_STAND) {
					setIdleClip(null);
					return;
				}
				let alive = true;
				let timer;
				if (hovering && cfg.hoverLook) {
					setIdleClip("glance");
					return () => {
						alive = false;
						clearTimeout(timer);
					};
				}
				const schedule = () => {
					timer = setTimeout(() => {
						if (!alive) return;
						const micros = manifest === null || manifest === void 0 ? [] : (manifest.idleMicroClips ?? []);
						if (micros.length > 0) {
							const micro = pick(micros);
							setIdleClip(micro);
							const clip = manifest?.clips?.[micro];
							const duration = (clip?.frames?.length ?? 1) * (clip?.frameMs ?? 160) + 140;
							setTimeout(() => {
								if (alive) setIdleClip(null);
							}, duration);
						}
						schedule();
					}, 3500 + Math.random() * 5500);
				};
				schedule();
				return () => {
					alive = false;
					clearTimeout(timer);
				};
			}, [derivedPose, hovering, cfg.hoverLook, manifest]);

			// —— 闲置定时器（超时进入休息姿态） ——
			const scheduleIdle = react.useCallback(() => {
				clearTimeout(timers.current.idle);
				timers.current.idle = setTimeout(() => {
					if (statusMode) {
						const state = statusSnapshot === null || statusSnapshot === void 0 ? void 0 : statusSnapshot.state;
						if (state !== void 0 && state !== "IDLE" && state !== "SUCCESS") {
							scheduleIdle();
							return;
						}
					} else if (anyRunning) {
						scheduleIdle();
						return;
					}
					if (bubbleRef.current !== null) {
						scheduleIdle();
						return;
					}
					const rest = REST_POSES[(Math.random() * REST_POSES.length) | 0];
					setManualPose(rest);
				}, cfg.idleTimeout * 1000);
			}, [cfg.idleTimeout, statusMode, statusSnapshot, anyRunning]);

			const onActivity = react.useCallback(() => scheduleIdle(), [scheduleIdle]);
			react.useEffect(() => {
				scheduleIdle();
				return () => clearTimeout(timers.current.idle);
			}, [scheduleIdle]);

			// —— 交互：单击=戳戳，双击=摸头 ——
			const interact = react.useCallback((kind) => {
				const text = kind === "headpat" ? pick(HEADPAT_COPY) : pick(POKE_COPY);
				setTransientPose(kind === "headpat" ? "headpat" : "poke");
				setBubble({ kind: "state", state: kind === "headpat" ? "HEADPAT" : "POKE", text, transient: true });
				clearTimeout(timers.current.transient);
				timers.current.transient = setTimeout(() => {
					setTransientPose(null);
					setBubble(null);
				}, kind === "headpat" ? 1700 : 1200);
				onActivity();
			}, [onActivity, setBubble]);

			// 拖拽结束后产生的 click 不触发「戳戳」
			const lastDragMoved = react.useRef(false);
			const onClick = react.useCallback(() => {
				if (lastDragMoved.current) {
					lastDragMoved.current = false;
					return;
				}
				clearTimeout(timers.current.click);
				timers.current.click = setTimeout(() => interact("poke"), 260);
			}, [interact]);
			const onDoubleClick = react.useCallback((event) => {
				event.preventDefault();
				clearTimeout(timers.current.click);
				interact("headpat");
			}, [interact]);

			// —— 拖拽 ——
			const onStagePointerDown = react.useCallback((event) => {
				if (event.button !== 0) return;
				if (event.target.closest("[data-dsh-pet-ui]") !== null) return;
				event.preventDefault();
				setMenu(null);
				onActivity();
				const rect = stageRef.current === null ? null : stageRef.current.getBoundingClientRect();
				dragRef.current = {
					startX: event.clientX,
					startY: event.clientY,
					originX: rect === null ? (posRef.current === null ? 0 : posRef.current.x) : rect.left,
					originY: rect === null ? (posRef.current === null ? 0 : posRef.current.y) : rect.top,
					moved: false
				};
				setDragging(true);
			}, [onActivity]);

			react.useEffect(() => {
				if (!dragging) return;
				const onMove = (event) => {
					const drag = dragRef.current;
					if (drag === null) return;
					const dx = event.clientX - drag.startX;
					const dy = event.clientY - drag.startY;
					if (!drag.moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
					drag.moved = true;
					const s = sizeRef.current;
					setPos({
						x: clamp(drag.originX + dx, 0, Math.max(0, window.innerWidth - s)),
						y: clamp(drag.originY + dy, 0, Math.max(0, window.innerHeight - s))
					});
				};
				const onUp = () => {
					const drag = dragRef.current;
					dragRef.current = null;
					setDragging(false);
					if (drag !== null && drag.moved) lastDragMoved.current = true;
					const current = posRef.current;
					if (current !== null) writeLS(LS.pos, current);
				};
				window.addEventListener("pointermove", onMove);
				window.addEventListener("pointerup", onUp);
				window.addEventListener("pointercancel", onUp);
				return () => {
					window.removeEventListener("pointermove", onMove);
					window.removeEventListener("pointerup", onUp);
					window.removeEventListener("pointercancel", onUp);
				};
			}, [dragging]);

			react.useEffect(() => {
				const onResize = () => {
					const current = posRef.current;
					if (current === null) return;
					const s = sizeRef.current;
					const x = clamp(current.x, 0, Math.max(0, window.innerWidth - s));
					const y = clamp(current.y, 0, Math.max(0, window.innerHeight - s));
					if (x !== current.x || y !== current.y) setPos({ x, y });
				};
				window.addEventListener("resize", onResize);
				return () => window.removeEventListener("resize", onResize);
			}, []);

			// —— 右键菜单 ——
			const onContextMenu = react.useCallback((event) => {
				event.preventDefault();
				onActivity();
				const w = 172;
				const h = 248;
				setMenu({
					x: clamp(event.clientX, 8, Math.max(8, window.innerWidth - w - 8)),
					y: clamp(event.clientY, 8, Math.max(8, window.innerHeight - h - 8))
				});
			}, [onActivity]);

			react.useEffect(() => {
				if (menu === null) return;
				const onKey = (event) => {
					if (event.key === "Escape") setMenu(null);
				};
				window.addEventListener("keydown", onKey);
				return () => window.removeEventListener("keydown", onKey);
			}, [menu]);

			const choosePose = react.useCallback((id) => {
				setManualPose(id);
				writeLS(LS.pose, id);
				setBubble(null);
				setMenu(null);
				onActivity();
			}, [setBubble, onActivity]);

			const changeSize = react.useCallback((delta) => {
				const next = clamp(sizeRef.current + delta, 80, 400);
				setSizeState(next);
				writeLS(LS.size, next);
				onActivity();
			}, [onActivity]);

			const resetPos = react.useCallback(() => {
				setPos(null);
				writeLS(LS.pos, null);
				setMenu(null);
				onActivity();
			}, [onActivity]);

			// —— 欢迎气泡 ——
			react.useEffect(() => {
				if (!welcome) return;
				const text = "我是 DeepSeek 娘！右键切换姿态～";
				setBubble({ kind: "state", state: "WELCOME", text, transient: true });
				const t = setTimeout(() => {
					setBubble((cur) => (cur !== null && cur.kind === "state" && cur.text === text ? null : cur));
					writeLS(LS.welcome, true);
				}, 4200);
				return () => clearTimeout(t);
			}, [welcome, setBubble]);

			// —— 彩蛋 ——
			react.useEffect(() => {
				if (statusMode ? (statusSnapshot !== null && statusSnapshot !== void 0 && statusSnapshot.state !== "IDLE" && statusSnapshot.state !== "SUCCESS") : anyRunning) return;
				let alive = true;
				let timer;
				const level = cfg.activityLevel ?? "normal";
				const factor = level === "quiet" ? 3 : level === "lively" ? 0.5 : 1;
				const min = cfg.easterEggMinMs * factor;
				const max = Math.max(min, cfg.easterEggMaxMs * factor);
				const loop = () => {
					timer = setTimeout(() => {
						if (!alive) return;
						if (bubbleRef.current === null) {
							const text = pick(EASTER_EGGS);
							setBubble({ kind: "state", state: "EGG", text, transient: true });
							timers.current.egg = setTimeout(() => {
								if (alive) setBubble(null);
							}, cfg.easterEggDurationMs);
						}
						loop();
					}, min + Math.random() * (max - min));
				};
				loop();
				return () => {
					alive = false;
					clearTimeout(timer);
					clearTimeout(timers.current.egg);
				};
			}, [statusMode, statusSnapshot, anyRunning, cfg.activityLevel, cfg.easterEggMinMs, cfg.easterEggMaxMs, cfg.easterEggDurationMs, setBubble]);

			// —— 布局 ——
			const defaultPos = {
				x: Math.max(0, window.innerWidth - size - 24),
				y: Math.max(0, window.innerHeight - size - 44)
			};
			const resolvedPos = pos === null ? defaultPos : pos;

			// 待机姿态的微动画 clip（悬停→环视）
			const standClip = hovering ? "glance" : (idleClip ?? "idle");
			const poseForRender = derivedPose === POSE_STAND ? standClip : derivedPose;

			// 禁用时隐藏
			if (status !== null && status.enabled === false) return null;

			return jsxs("div", {
				ref: stageRef,
				className: "dsh-pet-stage",
				style: {
					left: resolvedPos.x,
					top: resolvedPos.y,
					width: size,
					height: size
				},
				"data-pose": derivedPose,
				"data-dragging": dragging || void 0,
				role: "img",
				"aria-label": "DeepSeek 娘桌宠",
				onPointerDown: onStagePointerDown,
				onClick: onClick,
				onDoubleClick: onDoubleClick,
				onContextMenu: onContextMenu,
				onPointerEnter: () => setHovering(true),
				onPointerLeave: () => setHovering(false),
				onDragStart: (event) => event.preventDefault(),
				children: [
					jsx(BubbleView, { bubble }),
					jsx("div", {
						className: "dsh-pet-anim",
						children: jsx(Sprite, {
							pose: poseForRender,
							manifest,
							images: cfg.images,
							reducedMotion: false
						})
					}),
					menu !== null && jsxs(Fragment, {
						children: [
							jsx("div", {
								className: "dsh-pet-menu-backdrop",
								"data-dsh-pet-ui": true,
								onClick: () => setMenu(null),
								onContextMenu: (event) => {
									event.preventDefault();
									event.stopPropagation();
									setMenu(null);
								}
							}),
							jsx(MenuView, { menu, manualPose, size, onChoose: choosePose, onSize: changeSize, onReset: resetPos })
						]
					})
				]
			});
		}
		//#endregion

		//#region 设置卡（settings.plugin.item，keyed = dsh-pet）
		const CARD_STYLE = { listStyle: "none", border: "1px solid rgba(77,107,254,.3)", borderRadius: 12, padding: 16, background: "transparent", display: "grid", gap: 14 };
		const ROW_STYLE = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 20 };
		const SELECT_STYLE = { minWidth: 120, padding: "6px 10px", borderRadius: 8 };

		function PetSettingsCard() {
			const [status, setStatus] = react.useState("loading");
			const [value, setValue] = react.useState({});
			const [busy, setBusy] = react.useState(false);
			const patchSeq = react.useRef(0);
			const sliderTimers = react.useRef(new Map());
			const writable = status === "ready" && !busy;
			react.useEffect(() => {
				let active = true;
				fetchJson(CONFIG_URL)
					.then((next) => {
						if (active && next !== null && typeof next === "object") {
							setValue(next);
							setStatus("ready");
						}
					})
					.catch(() => {
						if (active) setStatus("unavailable");
					});
				return () => {
					active = false;
					for (const timer of sliderTimers.current.values()) clearTimeout(timer);
					sliderTimers.current.clear();
				};
			}, []);
			const write = async (field, next) => {
				const seq = ++patchSeq.current;
				setBusy(true);
				try {
					const updated = await fetchJson(CONFIG_URL, {
						method: "PATCH",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ [field]: next })
					});
					if (seq === patchSeq.current && updated !== null && typeof updated === "object") {
						setValue(updated);
						setStatus("ready");
					}
				} catch {
					if (seq === patchSeq.current) setStatus("unavailable");
				} finally {
					if (seq === patchSeq.current) setBusy(false);
				}
			};
			const writeSlider = (field, next) => {
				setValue((prev) => ({ ...prev, [field]: next }));
				patchSeq.current += 1;
				const pending = sliderTimers.current.get(field);
				if (pending) clearTimeout(pending);
				const timer = setTimeout(() => {
					sliderTimers.current.delete(field);
					void write(field, next);
				}, 250);
				sliderTimers.current.set(field, timer);
			};
			const field = (label, hint, control) => jsx("label", {
				style: ROW_STYLE,
				children: [
					jsx("span", { children: [jsx("span", { style: { display: "block", fontWeight: 600 }, children: label }), jsx("small", { style: { display: "block", opacity: 0.65, marginTop: 3 }, children: hint })] }),
					control
				]
			});
			if (status === "unavailable") {
				return jsx("li", { style: CARD_STYLE, "data-testid": "dsh-pet-settings", children: jsx("span", { children: "桌宠设置尚未连接到 DSH Host。" }) });
			}
			if (status === "loading") {
				return jsx("li", { style: CARD_STYLE, children: jsx("span", { children: "正在读取设置…" }) });
			}
			return jsxs("li", {
				style: CARD_STYLE,
				"data-testid": "dsh-pet-settings",
				children: [
					jsx("div", { children: [jsx("strong", { style: { fontSize: 16 }, children: "DeepSeek 娘桌宠" }), jsx("p", { style: { margin: "5px 0 0", opacity: 0.72 }, children: "会话事件驱动的状态桌宠：思考/工作/等待/出错都有对应动画与气泡。" })] }),
					field("启用桌宠", "关闭后立即隐藏。", jsx("input", { type: "checkbox", checked: value.enabled !== false, disabled: !writable, onChange: (event) => void write("enabled", event.target.checked) })),
					field("角色大小", `${value.size ?? 150}px`, jsx("input", { type: "range", min: 100, max: 320, step: 5, value: value.size ?? 150, disabled: status !== "ready", onChange: (event) => void writeSlider("size", Number(event.target.value)) })),
					field("完成气泡时长", `${Math.round((value.bubbleDuration ?? 4000) / 1000)} 秒`, jsx("input", { type: "range", min: 1500, max: 8000, step: 250, value: value.bubbleDuration ?? 4000, disabled: status !== "ready", onChange: (event) => void writeSlider("bubbleDuration", Number(event.target.value)) })),
					field("活跃程度", "控制空闲彩蛋的出现频率。", jsx("select", {
						style: SELECT_STYLE,
						value: value.activityLevel ?? "normal",
						disabled: !writable,
						onChange: (event) => void write("activityLevel", event.target.value),
						children: [
							jsx("option", { value: "quiet", children: "安静" }),
							jsx("option", { value: "normal", children: "标准" }),
							jsx("option", { value: "lively", children: "活泼" })
						]
					})),
					field("响应子 Agent", "默认只跟随顶层任务。", jsx("input", { type: "checkbox", checked: value.includeSubagents === true, disabled: !writable, onChange: (event) => void write("includeSubagents", event.target.checked) })),
					field("悬停注视", "悬停时播放环视动画。", jsx("input", { type: "checkbox", checked: value.hoverLook !== false, disabled: !writable, onChange: (event) => void write("hoverLook", event.target.checked) })),
					field("显示余额", "任务完成时展示账户余额。", jsx("input", { type: "checkbox", checked: value.showBalance !== false, disabled: !writable, onChange: (event) => void write("showBalance", event.target.checked) })),
					busy ? jsx("small", { role: "status", children: "正在保存…" }) : null
				]
			});
		}
		//#endregion

		//#region 插件主体
		const inject = ["slots"];
		function apply(ctx) {
			// 桌宠覆盖层（shell.overlay 为 list 插槽，必须带唯一 id）
			ctx.effect(() => {
				let scope;
				try {
					const scopeService = ctx.get("settingsScope");
					if (scopeService !== void 0 && typeof scopeService.bind === "function") {
						scope = scopeService.bind({ namespace: "dsh-pet" });
					}
				} catch {
					scope = void 0;
				}
				const disposeRegistration = ctx.slots.register({ name: "shell.overlay", id: PLUGIN_ID }, (standard) => jsx(PetOverlay, { ...standard, scope }));
				return () => {
					disposeRegistration();
				};
			}, "dsh-pet: overlay registration");

			// 设置卡（keyed 插槽）：失败只静默这张卡，绝不拖垮 WebUI 加载
			const registerCard = () => {
				try {
					ctx.slots.register({
						name: "settings.plugin.item",
						key: "dsh-pet",
						id: "dsh-pet",
						order: 20,
						inject: () => ({})
					}, PetSettingsCard);
				} catch (error) {
					if (typeof console !== "undefined" && console.error) {
						console.error("[dsh-pet] failed to register settings card:", error);
					}
				}
			};
			try {
				ctx.slots.inject("settings.plugin.item", registerCard);
			} catch (error) {
				if (typeof console !== "undefined" && console.error) {
					console.error("[dsh-pet] failed to inject settings slot:", error);
				}
			}
		}
		//#endregion

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
