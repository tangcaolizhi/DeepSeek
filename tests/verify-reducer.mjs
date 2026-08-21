// dsh-pet-deepseek-girl —— PetStatusReducer 单元测试
// 运行前提：tests/fixture-home 已同步最新 lib（含 reducer.js/copy.js）。
// 运行：node tests/verify-reducer.mjs
import { PetStatusReducer, PetState } from "file:///C:/my%20deepseek%20horness/deepseek%E5%A8%98/tests/fixture-home/profiles/web/node_modules/dsh-pet-deepseek-girl/lib/reducer.js";

let failures = 0;
function assert(name, cond, extra) {
	if (cond) console.log(`  ok   ${name}`);
	else { failures += 1; console.error(`  FAIL ${name}${extra === void 0 ? "" : ` — ${extra}`}`); }
}

const session = (id = "s1") => ({ header: { id } });
const ev = (type, seq, data = {}) => ({ type, seq, data });

const r = new PetStatusReducer({ includeSubagents: false });

// 初始：无会话 → IDLE
assert("初始 IDLE", r.snapshot().state === PetState.IDLE);

// turn/start → THINKING
r.handle(session(), ev("turn/start", 1));
assert("turn/start → THINKING", r.snapshot().state === PetState.THINKING);

// tool/call grep → WORKING searching
r.handle(session(), ev("tool/call", 2, { name: "grep", callId: "c1", message: { source: { callId: "c1" } } }));
let snap = r.snapshot();
assert("tool/call grep → WORKING", snap.state === PetState.WORKING);
assert("grep → searching", snap.activity === "searching", snap.activity);

// tool/call ask_user_question → WAITING
r.handle(session(), ev("tool/call", 3, { name: "ask_user_question", callId: "c2", message: { source: { callId: "c2" } } }));
snap = r.snapshot();
assert("ask_user_question → WAITING", snap.state === PetState.WAITING);

// tool/result c2（等待确认的工具）→ 还有 c1(grep) 未返回 → WORKING
r.handle(session(), ev("tool/result", 4, { callId: "c2", message: { source: { callId: "c2" } } }));
assert("tool/result(等待工具) → WORKING(c1 仍开)", r.snapshot().state === PetState.WORKING);
// tool/result c1 → 全部结束 → THINKING
r.handle(session(), ev("tool/result", 5, { callId: "c1", message: { source: { callId: "c1" } } }));
assert("tool/result(最后一个) → THINKING", r.snapshot().state === PetState.THINKING);

// turn/end completed → SUCCESS 脉冲 + IDLE
r.handle(session(), ev("turn/end", 6, { reason: { kind: "completed" } }));
snap = r.snapshot();
assert("turn/end 完成 → IDLE", snap.state === PetState.IDLE);
assert("SUCCESS 脉冲存在", snap.pulse !== null && snap.pulse.state === "SUCCESS", JSON.stringify(snap.pulse));
const pulseId = snap.pulse?.id;
assert("脉冲 id 稳定（同一脉冲不重复计数）", pulseId !== void 0 && pulseId > 0);

// 错误结束 → ERROR
const r2 = new PetStatusReducer({});
r2.handle(session("s2"), ev("turn/start", 1));
r2.handle(session("s2"), ev("turn/end", 2, { reason: { kind: "max-tokens" } }));
assert("max-tokens → ERROR", r2.snapshot().state === PetState.ERROR);

// 优先级：WAITING 会话压倒 WORKING 会话
const r3 = new PetStatusReducer({});
r3.handle(session("a"), ev("turn/start", 1));
r3.handle(session("a"), ev("tool/call", 2, { name: "grep", callId: "ca", message: { source: { callId: "ca" } } })); // WORKING
r3.handle(session("b"), ev("turn/start", 3));
r3.handle(session("b"), ev("tool/call", 4, { name: "ask_user_question", callId: "cb", message: { source: { callId: "cb" } } })); // WAITING
assert("多会话：WAITING 优先于 WORKING", r3.snapshot().state === PetState.WAITING);

// includeSubagents=false：子代理会话被忽略
const r4 = new PetStatusReducer({ includeSubagents: false });
const subSession = { header: { id: "child", origin: "subagent" } };
r4.handle(subSession, ev("turn/start", 1));
r4.handle(subSession, ev("tool/call", 2, { name: "grep", callId: "cc", message: { source: { callId: "cc" } } }));
assert("子代理被忽略（includeSubagents=false）", r4.snapshot().state === PetState.IDLE);
r4.setIncludeSubagents(true);
r4.handle(subSession, ev("tool/call", 3, { name: "grep", callId: "cd", message: { source: { callId: "cd" } } }));
assert("子代理生效（includeSubagents=true）", r4.snapshot().state === PetState.WORKING);

// todo/write 记录任务与进度
const r5 = new PetStatusReducer({});
r5.handle(session("t"), ev("turn/start", 1));
r5.handle(session("t"), ev("todo/write", 2, { todos: [
	{ status: "completed", content: "A" },
	{ status: "in_progress", content: "B" },
	{ status: "pending", content: "C" }
] }));
snap = r5.snapshot();
assert("todo 记录当前任务", snap.task === "B", snap.task);
assert("todo 进度 1/3", snap.progress !== void 0 && snap.progress.completed === 1 && snap.progress.total === 3, JSON.stringify(snap.progress));

// 异常输入不抛错
try {
	r5.handle(session("x"), null);
	r5.handle(null, ev("turn/start", 1));
	r5.handle(session("y"), { type: 42 });
	assert("异常输入静默", true);
} catch (error) {
	assert("异常输入静默", false, error.message);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
