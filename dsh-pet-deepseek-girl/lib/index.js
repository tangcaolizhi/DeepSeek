// ─────────────────────────────────────────────────────────────────────────────
// dsh-pet-deepseek-girl —— node（host）半
//
// 职责：
//   1. 注册 `dsh-pet` 设置命名空间（行内 config 为 base 层，设置可实时调整）。
//   2. 订阅 session/event 全局事件，用 PetStatusReducer 维护「当前最重要任务」
//      状态，通过 GET /api/pet/status 暴露给浏览器（轮询）。
//   3. 注册 webserver 路由：
//        GET  /api/pet/status                          → 状态快照 + 配置
//        GET  /api/pet/balance                         → 余额（凭证进程内读取）
//        GET  /plugins/dsh-pet-deepseek-girl/config    → 读配置
//        PATCH /plugins/dsh-pet-deepseek-girl/config   → 写配置（设置卡用）
//        GET  /plugins/dsh-pet-deepseek-girl/assets/*  → 静态素材（帧集等）
//   4. 安全：apiKey 只在进程内；所有本地端点做 Host/Origin/Sec-Fetch-Site
//      同源信任检查；事件处理异常绝不外抛（不影响其它订阅者）。
// ─────────────────────────────────────────────────────────────────────────────
import z from "@deepseek-ai/schemastery";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { settingsNamespace } from "@deepseek-ai/dsh-settings";
import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { PetStatusReducer } from "./reducer.js";

const name = "pet-deepseek-girl";
const inject = ["webServer"];

/** 设置命名空间名。 */
const NS = settingsNamespace("dsh-pet");

const DEFAULT_API_KEY_ENV = "DEEPSEEK_API_KEY";
const DEFAULT_BASE_URL = "https://api.deepseek.com";

const BALANCE_PATH = "/api/pet/balance";
const STATUS_PATH = "/api/pet/status";
const CONFIG_PATH = "/plugins/dsh-pet-deepseek-girl/config";
const ASSETS_PREFIX = "/plugins/dsh-pet-deepseek-girl/assets";
const ASSETS_DIR = fileURLToPath(new URL("../assets/", import.meta.url));
const ASSETS_ROOT = resolve(ASSETS_DIR);

const CONTENT_TYPES = {
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".json": "application/json"
};

const Config = z.object({
	enabled: z.boolean().default(true),
	idleTimeout: z.number().step(1).min(10).max(86400).default(300),
	bubbleDuration: z.number().step(1).min(500).max(60000).default(4000),
	easterEggMinMs: z.number().step(1).min(5000).max(3600000).default(30000),
	easterEggMaxMs: z.number().step(1).min(5000).max(3600000).default(90000),
	easterEggDurationMs: z.number().step(1).min(500).max(30000).default(2500),
	size: z.number().step(1).min(80).max(400).default(150),
	hoverLook: z.boolean().default(true),
	showBalance: z.boolean().default(true),
	includeSubagents: z.boolean().default(false),
	activityLevel: z.union([
		z.const("quiet").description("安静"),
		z.const("normal").description("标准"),
		z.const("lively").description("活泼")
	]).default("normal"),
	apiKeyEnv: z.string().role("credential-ref").default(DEFAULT_API_KEY_ENV),
	baseURL: z.string().default(DEFAULT_BASE_URL),
	balancePath: z.string().default("/user/balance"),
	requestTimeoutMs: z.number().step(1).min(100).max(30000).default(3000),
	// 姿态图片覆盖：{ poseId: "/plugins/.../assets/xxx.png" }；未提供的姿态沿用默认帧动画
	images: z.dict(z.string())
});

/** 配置端点允许 PATCH 的键（与 Config 对齐）。 */
const CONFIG_KEYS = [
	"enabled", "idleTimeout", "bubbleDuration", "easterEggMinMs", "easterEggMaxMs",
	"easterEggDurationMs", "size", "hoverLook", "showBalance", "includeSubagents",
	"activityLevel", "apiKeyEnv", "baseURL", "balancePath", "requestTimeoutMs", "images"
];

function header(headers, key) {
	const value = headers[key];
	return typeof value === "string" ? value : void 0;
}

/** 轻量同源信任检查（Host 可解析、非 cross-site、Origin 与 Host 同源）。 */
function isTrustedLocalRequest(req) {
	const host = header(req.headers, "host");
	if (host === void 0) return false;
	let hostUrl;
	try {
		hostUrl = new URL(`http://${host}`);
	} catch {
		return false;
	}
	const hostname = hostUrl.hostname.toLowerCase();
	const loopback = hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]" || hostname === "::1" || hostname.endsWith(".localhost");
	if (!loopback && hostname !== hostUrl.hostname) return false;
	if (header(req.headers, "sec-fetch-site") === "cross-site") return false;
	const origin = header(req.headers, "origin");
	if (origin === void 0) return true;
	try {
		return new URL(origin).host === hostUrl.host;
	} catch {
		return false;
	}
}

function jsonResponse(res, status, body) {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store",
		"content-length": Buffer.byteLength(payload)
	});
	res.end(payload);
}

/** 读取并校验 JSON PATCH 体（≤8KB，仅允许已知键）。 */
async function readPatch(req) {
	const chunks = [];
	let bytes = 0;
	for await (const chunk of req) {
		bytes += chunk.length;
		if (bytes > 8192) throw new Error("request body is too large");
		chunks.push(chunk);
	}
	const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("patch must be an object");
	if (Object.keys(value).some((key) => !CONFIG_KEYS.includes(key))) throw new Error("patch contains an unknown setting");
	return value;
}

async function resolveApiKey(ctx, ref) {
	const credentials = ctx.get("credentials");
	if (credentials !== void 0) {
		try {
			const hit = await credentials.resolve(ref);
			if (hit !== void 0 && typeof hit.value === "string" && hit.value.length > 0) return hit.value;
		} catch {
			// 凭证服务异常时退回环境变量。
		}
	}
	const ambient = launchEnvironmentOf(ctx).get(ref);
	if (ambient !== void 0 && ambient.value.length > 0) return ambient.value;
	return void 0;
}

async function fetchBalance(baseURL, balancePath, apiKey, timeoutMs) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetch(`${baseURL}${balancePath}`, {
			method: "GET",
			headers: {
				authorization: `Bearer ${apiKey}`,
				accept: "application/json"
			},
			signal: controller.signal
		});
		if (!response.ok) return { ok: false, reason: `http-${response.status}` };
		const data = await response.json();
		const infos = Array.isArray(data?.balance_infos) ? data.balance_infos : [];
		const primary = infos[0];
		return {
			ok: true,
			available: data?.is_available === true,
			primary: primary === void 0 ? void 0 : {
				currency: primary.currency,
				total: Number(primary.total_balance)
			},
			infos
		};
	} catch {
		return { ok: false, reason: controller.signal.aborted ? "timeout" : "request-failed" };
	} finally {
		clearTimeout(timer);
	}
}

function balanceHandler(ctx, current) {
	return async (req, res) => {
		if (req.method !== "GET" && req.method !== "HEAD") {
			res.writeHead(405, { allow: "GET, HEAD" });
			res.end();
			return;
		}
		if (!isTrustedLocalRequest(req)) {
			jsonResponse(res, 403, { ok: false, reason: "untrusted" });
			return;
		}
		const cfg = current();
		let payload;
		try {
			const apiKey = await resolveApiKey(ctx, credentialRef(cfg.apiKeyEnv));
			if (apiKey === void 0) payload = { ok: false, reason: "no-key" };
			else payload = await fetchBalance(cfg.baseURL, cfg.balancePath, apiKey, cfg.requestTimeoutMs);
		} catch {
			payload = { ok: false, reason: "internal" };
		}
		jsonResponse(res, 200, payload);
	};
}

/** 状态快照路由：reducer 快照 + 当前配置（含 enabled）。 */
function statusHandler(reducer, current) {
	return (req, res) => {
		if (req.method !== "GET" && req.method !== "HEAD") {
			res.writeHead(405, { allow: "GET, HEAD" });
			res.end();
			return;
		}
		if (!isTrustedLocalRequest(req)) {
			jsonResponse(res, 403, { ok: false, reason: "untrusted" });
			return;
		}
		const cfg = current();
		// 惰性同步 includeSubagents 到 reducer（设置卡实时切换）。
		if (reducer.includeSubagents !== (cfg.includeSubagents === true)) {
			reducer.setIncludeSubagents(cfg.includeSubagents === true);
		}
		const body = {
			ok: true,
			enabled: cfg.enabled !== false,
			config: {
				enabled: cfg.enabled !== false,
				activityLevel: cfg.activityLevel ?? "normal",
				includeSubagents: cfg.includeSubagents === true
			},
			status: cfg.enabled === false ? null : reducer.snapshot()
		};
		jsonResponse(res, 200, body);
	};
}

/** 配置端点：GET 读、PATCH 写（设置卡用）。 */
function configHandler(settings) {
	return async (req, res) => {
		if (!isTrustedLocalRequest(req)) {
			jsonResponse(res, 403, { error: "local access only" });
			return;
		}
		if (req.method === "GET") {
			jsonResponse(res, 200, settings.get());
			return;
		}
		if (req.method !== "PATCH") {
			res.writeHead(405, { allow: "GET, PATCH" });
			res.end();
			return;
		}
		try {
			await settings.update(await readPatch(req));
			jsonResponse(res, 200, settings.get());
		} catch (error) {
			jsonResponse(res, 400, { error: error instanceof Error ? error.message : String(error) });
		}
	};
}

function assetsHandler() {
	return async (req, res) => {
		if (req.method !== "GET" && req.method !== "HEAD") {
			res.writeHead(405, { allow: "GET, HEAD" });
			res.end();
			return;
		}
		let pathname;
		try {
			pathname = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
		} catch {
			res.writeHead(400);
			res.end();
			return;
		}
		const rel = pathname.slice(ASSETS_PREFIX.length).replace(/^[/\\]+/, "");
		const target = resolve(ASSETS_DIR, rel);
		if (target !== ASSETS_ROOT && !target.startsWith(ASSETS_ROOT + sep)) {
			res.writeHead(404);
			res.end();
			return;
		}
		try {
			const data = await readFile(target);
			const type = CONTENT_TYPES[extname(target).toLowerCase()] ?? "application/octet-stream";
			res.writeHead(200, {
				"content-type": type,
				"cache-control": "public, max-age=3600"
			});
			res.end(req.method === "HEAD" ? void 0 : data);
		} catch {
			res.writeHead(404);
			res.end();
		}
	};
}

function apply(ctx, config) {
	/** 当前生效配置：设置命名空间解析值优先，回退到行内 config。 */
	let current = () => config;
	ctx.inject(["settings"], (sctx) => {
		const scope = sctx.settings.register(NS, Config, { base: config });
		current = () => scope.get();
		sctx.effect(() => () => {
			current = () => config;
		});
		// 配置端点（设置卡用）：webServer 走嵌套注入（settings 上下文不带该服务）。
		sctx.inject(["webServer"], (httpCtx) => {
			httpCtx.effect(() => httpCtx.webServer.register({
				kind: "exact",
				path: CONFIG_PATH,
				handler: configHandler(scope)
			}), "pet: config endpoint");
		});
	});

	/** 会话事件状态机（按当前配置惰性同步 includeSubagents）。 */
	const reducer = new PetStatusReducer({ includeSubagents: config.includeSubagents === true });

	// 全局监听所有会话事件；异常必须被兜住——不得打断共享事件总线的其它订阅者。
	const offEvent = ctx.on("session/event", (session, event) => {
		try {
			reducer.handle(session, event);
		} catch (error) {
			ctx.logger?.error?.("dsh-pet: failed to handle session event", error);
		}
	}, { global: true });
	const offDisposed = ctx.on("session/disposed", (session) => {
		try {
			reducer.disposeSession(session);
		} catch (error) {
			ctx.logger?.error?.("dsh-pet: failed to dispose session", error);
		}
	}, { global: true });

	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: BALANCE_PATH,
		handler: balanceHandler(ctx, () => current())
	}), "pet: balance route");
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: STATUS_PATH,
		handler: statusHandler(reducer, () => current())
	}), "pet: status route");
	ctx.effect(() => ctx.webServer.register({
		kind: "prefix",
		path: ASSETS_PREFIX,
		handler: assetsHandler()
	}), "pet: assets route");

	ctx.effect(() => () => {
		offEvent?.();
		offDisposed?.();
	}, "pet: event subscription cleanup");
}

export {
	ASSETS_DIR, ASSETS_PREFIX, BALANCE_PATH, CONFIG_KEYS, CONFIG_PATH, Config,
	NS, STATUS_PATH, apply, inject, name
};
