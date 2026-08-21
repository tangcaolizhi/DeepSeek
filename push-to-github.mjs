// 通过 GitHub REST Git Data API 推送仓库内容（无需本地 git）
// 用法：GITHUB_TOKEN=ghp_xxx node push-to-github.mjs [owner/repo] [branch]
//       （令牌优先取环境变量 GITHUB_TOKEN，避免出现在进程参数里）
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const [, , repo = "tangcaolizhi/DeepSeek", branch = "main"] = process.argv;
const token = process.env.GITHUB_TOKEN;
if (!token) {
	console.error("用法: GITHUB_TOKEN=ghp_xxx node push-to-github.mjs [owner/repo] [branch]");
	process.exit(1);
}

const ROOT = "C:/my deepseek horness/deepseek娘";
const API = `https://api.github.com/repos/${repo}`;
const ua = { "User-Agent": "dsh-pet-push", Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" };

async function api(path, method = "GET", body) {
	for (let attempt = 1; attempt <= 6; attempt++) {
		try {
			const response = await fetch(`${API}${path}`, {
				method,
				headers: ua,
				body: body === void 0 ? void 0 : JSON.stringify(body)
			});
			const text = await response.text();
			let data = null;
			try { data = text ? JSON.parse(text) : null; } catch { data = text; }
			if (response.ok) return data;
			if (response.status >= 500 && attempt < 6) {
				console.log(`... ${method} ${path} -> ${response.status}（第 ${attempt} 次重试）`);
				await new Promise((resolve) => setTimeout(resolve, 2500 * attempt));
				continue;
			}
			throw new Error(`${method} ${path} -> ${response.status}: ${text.slice(0, 300)}`);
		} catch (error) {
			if (attempt < 6 && !(error instanceof Error && error.message.includes("->"))) {
				console.log(`... ${method} ${path} 网络错误（第 ${attempt} 次重试）`);
				await new Promise((resolve) => setTimeout(resolve, 2500 * attempt));
				continue;
			}
			throw error;
		}
	}
}

// —— 收集文件（.gitignore 精简版） ——
const IGNORED_DIRS = new Set(["node_modules", "tools", ".render", ".npm-cache", ".dafeiyu-inspect", ".staging", ".git", "fixture-home"]);
const IGNORED_FILES = new Set([".download-git.mjs", "package-lock.json"]);
function walk(dir, out = []) {
	for (const entry of readdirSync(dir)) {
		if (entry === ".git" || IGNORED_DIRS.has(entry)) continue;
		const full = join(dir, entry);
		const stat = statSync(full);
		if (stat.isDirectory()) walk(full, out);
		else if (!IGNORED_FILES.has(entry) && !entry.endsWith(".tgz")) out.push(full);
	}
	return out;
}
const files = walk(ROOT).sort();
console.log(`共 ${files.length} 个文件待推送`);

// —— 空仓库需先初始化首提交（Git Data API 要求仓库非空） ——
async function ensureRepoInitialized() {
	const probe = await fetch(`${API}/contents/`, { headers: ua });
	if (probe.status === 404) {
		console.log("空仓库：先创建初始化提交");
		const init = await fetch(`${API}/contents/README.md`, {
			method: "PUT",
			headers: ua,
			body: JSON.stringify({
				message: "init",
				content: Buffer.from("# DeepSeek\n\nDeepSeek 娘桌宠插件（详见 dsh-pet-deepseek-girl/README.md）\n").toString("base64")
			})
		});
		if (!init.ok) throw new Error(`init commit failed: ${init.status} ${(await init.text()).slice(0, 200)}`);
		console.log("初始化提交完成");
	} else if (!probe.ok) {
		throw new Error(`contents probe failed: ${probe.status}`);
	}
}
await ensureRepoInitialized();

// —— 建 blob ——
const entries = [];
for (const file of files) {
	const rel = relative(ROOT, file).replaceAll(sep, "/");
	const content = readFileSync(file).toString("base64");
	const blob = await api("/git/blobs", "POST", { content, encoding: "base64" });
	entries.push({ path: rel, mode: "100644", type: "blob", sha: blob.sha });
	if (entries.length % 25 === 0) console.log(`blobs: ${entries.length}/${files.length}`);
}
console.log(`blobs 完成 (${entries.length})`);

// —— 建 tree ——
const tree = await api("/git/trees", "POST", { tree: entries });
console.log("tree:", tree.sha);

// —— 建 commit（父提交 = 当前分支 HEAD；首次推送则无父提交） ——
let parents = [];
try {
	const ref = await api(`/git/ref/heads/${branch}`);
	parents = [ref.object.sha];
	console.log("parent:", ref.object.sha);
} catch {
	console.log("无父提交（首次推送）");
}
const commit = await api("/git/commits", "POST", {
	message: `dsh-pet-deepseek-girl — DeepSeek 娘桌宠插件

会话事件驱动状态机（思考/工作/等待/出错/完成）、大肥鱼帧动画、
余额显示、拖拽/戳戳/摸头交互、设置卡。详见 README.md。`,
	tree: tree.sha,
	parents
});
console.log("commit:", commit.sha);

// —— 更新 ref ——
try {
	await api(`/git/refs`, "POST", { ref: `refs/heads/${branch}`, sha: commit.sha });
	console.log(`已创建 refs/heads/${branch}`);
} catch (error) {
	if (String(error).includes("already exists")) {
		await api(`/git/refs/heads/${branch}`, "PATCH", { sha: commit.sha });
		console.log(`已更新 refs/heads/${branch}`);
	} else {
		throw error;
	}
}
console.log("\n推送完成: https://github.com/" + repo);
