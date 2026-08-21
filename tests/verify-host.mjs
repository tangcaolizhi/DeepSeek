// dsh-pet-deepseek-girl host 半功能测试（无外部依赖，仅需 node）
//
// 运行前提：tests/fixture-home 中已按「手动安装」方式放置插件包副本
// （含最新 lib/），且已执行过一次 `dsh --profile web --dump-config` 建立
// flat module fallback。
//
// 运行：node tests/verify-host.mjs
import { createServer } from "node:http";
import { apply, ASSETS_PREFIX, BALANCE_PATH, CONFIG_PATH, STATUS_PATH } from "file:///C:/my%20deepseek%20horness/deepseek%E5%A8%98/tests/fixture-home/profiles/web/node_modules/dsh-pet-deepseek-girl/lib/index.js";

let failures = 0;
function assert(name, cond, extra) {
	if (cond) console.log(`  ok   ${name}`);
	else { failures += 1; console.error(`  FAIL ${name}${extra === void 0 ? "" : ` — ${extra}`}`); }
}
function call(handler, req) {
	const stub = req;
	if (typeof stub.body === "string") {
		const chunks = [Buffer.from(stub.body, "utf8")];
		stub[Symbol.asyncIterator] = async function* () {
			for (const chunk of chunks) yield chunk;
		};
	}
	return new Promise((resolve) => {
		const res = {
			status: 0,
			headers: {},
			body: "",
			writeHead(status, headers) { this.status = status; if (headers !== void 0) this.headers = headers; },
			end(body) { this.body = stub.method === "HEAD" ? "" : (body ?? ""); resolve(this); }
		};
		handler(stub, res);
	});
}

// 模拟 DeepSeek 余额接口
const deepseek = createServer((req, res) => {
	if (req.url !== "/user/balance") { res.writeHead(404); res.end(); return; }
	if (req.headers.authorization !== "Bearer sk-test") { res.writeHead(401); res.end(); return; }
	res.writeHead(200, { "content-type": "application/json" });
	res.end(JSON.stringify({
		is_available: true,
		balance_infos: [{ currency: "CNY", total_balance: "18.50", granted_balance: "0.00", topped_up_balance: "18.50" }]
	}));
});
await new Promise((resolve) => deepseek.listen(0, "127.0.0.1", resolve));
const dsPort = deepseek.address().port;

// 挂起服务器：验证超时降级
const hanging = createServer(() => { /* 永不响应 */ });
await new Promise((resolve) => hanging.listen(0, "127.0.0.1", resolve));
const hangPort = hanging.address().port;

const BASE_CONFIG = {
	enabled: true, idleTimeout: 300, bubbleDuration: 4000,
	easterEggMinMs: 30000, easterEggMaxMs: 90000, easterEggDurationMs: 2500,
	size: 150, hoverLook: true, showBalance: true, includeSubagents: false, activityLevel: "normal",
	apiKeyEnv: "DEEPSEEK_API_KEY",
	baseURL: `http://127.0.0.1:${dsPort}`,
	balancePath: "/user/balance",
	requestTimeoutMs: 2000
};

function makeCtx(credentials, settingsValue = {}) {
	const routes = [];
	const settingsDoc = { base: {}, user: { ...settingsValue }, revision: 0 };
	const settingsScope = {
		get: () => ({ ...settingsDoc.base, ...settingsDoc.user }),
		update: async (patch) => {
			settingsDoc.user = { ...settingsDoc.user, ...patch };
			settingsDoc.revision += 1;
			return settingsScope.get();
		},
		register: (ns, schema, options) => {
			settingsDoc.base = options?.base ?? {};
			return settingsScope;
		}
	};
	const handlers = {};
	const fakeCtx = {
		get(name) { return name === "credentials" ? credentials : void 0; },
		logger: { error: () => {} },
		on(name, fn) { handlers[name] = fn; return () => {}; },
		effect(fn) { const d = fn(); return d; },
		webServer: { register(route) { routes.push(route); return () => {}; } },
		inject(names, cb) {
			if (names.includes("settings")) {
				const sctx = {
					settings: settingsScope,
					effect: (fn) => fn(),
					inject: (n2, cb2) => {
						if (n2.includes("webServer")) cb2({ webServer: fakeCtx.webServer, effect: (fn) => fn() });
					}
				};
				cb(sctx);
			}
		}
	};
	return { ctx: fakeCtx, routes, settingsScope, handlers };
}

function routeOf(routes, kind, path) {
	return routes.find((r) => r.kind === kind && r.path === path);
}

// ── 主场景：余额 + 素材 + 状态 + 配置 ──
{
	const { ctx, routes, settingsScope, handlers } = makeCtx({ resolve: async (ref) => (ref === "DEEPSEEK_API_KEY" ? { value: "sk-test" } : void 0) });
	apply(ctx, BASE_CONFIG);
	const balanceRoute = routeOf(routes, "exact", BALANCE_PATH);
	const assetsRoute = routeOf(routes, "prefix", ASSETS_PREFIX);
	const statusRoute = routeOf(routes, "exact", STATUS_PATH);
	const configRoute = routeOf(routes, "exact", CONFIG_PATH);
	assert("余额 exact 路由已注册", balanceRoute !== void 0);
	assert("素材 prefix 路由已注册", assetsRoute !== void 0);
	assert("状态 exact 路由已注册", statusRoute !== void 0);
	assert("配置 exact 路由已注册", configRoute !== void 0);

	// 余额
	const res = await call(balanceRoute.handler, { method: "GET", url: BALANCE_PATH, headers: { host: `127.0.0.1:${dsPort}`, accept: "application/json" } });
	const data = JSON.parse(res.body);
	assert("余额正常：200 + ok", res.status === 200 && data.ok === true, JSON.stringify(data));
	assert("余额正常：CNY/18.5", data.primary?.currency === "CNY" && data.primary?.total === 18.5, JSON.stringify(data.primary));

	const cross = await call(balanceRoute.handler, { method: "GET", url: BALANCE_PATH, headers: { host: `127.0.0.1:${dsPort}`, origin: "http://evil.example", "sec-fetch-site": "cross-site" } });
	const crossData = JSON.parse(cross.body);
	assert("跨站 Origin：403", cross.status === 403 && crossData.ok === false && crossData.reason === "untrusted");

	const head = await call(balanceRoute.handler, { method: "HEAD", url: BALANCE_PATH, headers: { host: `127.0.0.1:${dsPort}` } });
	assert("HEAD 请求：200 且无 body", head.status === 200 && head.body === "");

	// 素材
	const png = await call(assetsRoute.handler, { method: "GET", url: `${ASSETS_PREFIX}/pet.svg`, headers: { host: "x" } });
	assert("素材 pet.svg：200 + svg", png.status === 200 && png.headers["content-type"] === "image/svg+xml" && png.body.includes("<svg"));
	const frame = await call(assetsRoute.handler, { method: "GET", url: `${ASSETS_PREFIX}/pet/idle_front/idle_front_238.png`, headers: { host: "x" } });
	assert("素材 帧 PNG：200 + image/png", frame.status === 200 && frame.headers["content-type"] === "image/png" && frame.body.toString("latin1").slice(1, 4) === "PNG");
	const manifest = await call(assetsRoute.handler, { method: "GET", url: `${ASSETS_PREFIX}/pet-manifest.json`, headers: { host: "x" } });
	const manifestData = JSON.parse(manifest.body);
	assert("素材 manifest：200 + clips", manifest.status === 200 && Array.isArray(manifestData.clips?.idle?.frames));
	const trav = await call(assetsRoute.handler, { method: "GET", url: `${ASSETS_PREFIX}/..%2f..%2fpackage.json`, headers: { host: "x" } });
	assert("素材穿越：404", trav.status === 404);

	// 状态（初始 IDLE）
	const st0 = await call(statusRoute.handler, { method: "GET", url: STATUS_PATH, headers: { host: `127.0.0.1:${dsPort}` } });
	const st0d = JSON.parse(st0.body);
	assert("状态：200 + enabled", st0.status === 200 && st0d.ok === true && st0d.enabled === true);
	assert("状态：初始 IDLE", st0d.status !== null && st0d.status.state === "IDLE", JSON.stringify(st0d.status));

	// 喂事件 → 状态变化
	handlers["session/event"]({ header: { id: "s1" } }, { type: "turn/start", seq: 1 });
	handlers["session/event"]({ header: { id: "s1" } }, { type: "tool/call", seq: 2, data: { name: "grep", callId: "c1", message: { source: { callId: "c1" } } } });
	const st1 = JSON.parse((await call(statusRoute.handler, { method: "GET", url: STATUS_PATH, headers: { host: `127.0.0.1:${dsPort}` } })).body);
	assert("状态：tool/call → WORKING", st1.status.state === "WORKING" && st1.status.activity === "searching", JSON.stringify(st1.status));

	// 配置 GET/PATCH
	const cfg0 = JSON.parse((await call(configRoute.handler, { method: "GET", url: CONFIG_PATH, headers: { host: `127.0.0.1:${dsPort}` } })).body);
	assert("配置 GET：200 + size", cfg0.size === 150, JSON.stringify(cfg0));
	const cfg1 = JSON.parse((await call(configRoute.handler, {
		method: "PATCH", url: CONFIG_PATH, headers: { host: `127.0.0.1:${dsPort}`, "content-type": "application/json" },
		body: JSON.stringify({ size: 200 })
	})).body);
	assert("配置 PATCH：200 + size 200", cfg1.size === 200, JSON.stringify(cfg1));
	const bad = await call(configRoute.handler, {
		method: "PATCH", url: CONFIG_PATH, headers: { host: `127.0.0.1:${dsPort}`, "content-type": "application/json" },
		body: JSON.stringify({ nope: 1 })
	});
	assert("配置 PATCH：未知键 400", bad.status === 400);
	const cfgUntrusted = await call(configRoute.handler, {
		method: "PATCH", url: CONFIG_PATH, headers: { host: `127.0.0.1:${dsPort}`, origin: "http://evil.example", "sec-fetch-site": "cross-site", "content-type": "application/json" },
		body: JSON.stringify({ size: 210 })
	});
	assert("配置 PATCH：跨站 403", cfgUntrusted.status === 403);

	// 禁用 → 状态隐藏
	await call(configRoute.handler, {
		method: "PATCH", url: CONFIG_PATH, headers: { host: `127.0.0.1:${dsPort}`, "content-type": "application/json" },
		body: JSON.stringify({ enabled: false })
	});
	const stOff = JSON.parse((await call(statusRoute.handler, { method: "GET", url: STATUS_PATH, headers: { host: `127.0.0.1:${dsPort}` } })).body);
	assert("禁用后：enabled=false + status=null", stOff.enabled === false && stOff.status === null, JSON.stringify(stOff));
}

// ── 无 Key：余额优雅降级 ──
{
	const { ctx, routes } = makeCtx({ resolve: async () => void 0 });
	apply(ctx, BASE_CONFIG);
	const route = routeOf(routes, "exact", BALANCE_PATH);
	const res = await call(route.handler, { method: "GET", url: BALANCE_PATH, headers: { host: `127.0.0.1:${dsPort}` } });
	const data = JSON.parse(res.body);
	assert("无 Key：ok=false/no-key", res.status === 200 && data.ok === false && data.reason === "no-key", JSON.stringify(data));
}

// ── 超时：余额优雅降级 ──
{
	const { ctx, routes } = makeCtx({ resolve: async () => ({ value: "sk-test" }) });
	apply(ctx, { ...BASE_CONFIG, baseURL: `http://127.0.0.1:${hangPort}`, requestTimeoutMs: 300 });
	const route = routeOf(routes, "exact", BALANCE_PATH);
	const res = await call(route.handler, { method: "GET", url: BALANCE_PATH, headers: { host: `127.0.0.1:${hangPort}` } });
	const data = JSON.parse(res.body);
	assert("超时：ok=false/timeout", res.status === 200 && data.ok === false && data.reason === "timeout", JSON.stringify(data));
}

deepseek.closeAllConnections?.();
hanging.closeAllConnections?.();
deepseek.close();
hanging.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
