// ─────────────────────────────────────────────────────────────────────────────
// dsh-pet-deepseek-girl —— 会话事件状态机（PetStatusReducer）
//
// 把 Harness 的 session/event 流折叠成一个「当前最重要任务」的状态快照：
//   等待确认(WAITING) > 出错(ERROR) > 工作中(WORKING) > 思考中(THINKING) > 空闲(IDLE)
// 事件 → 状态：
//   turn/start            → THINKING（准备）
//   step/start、assistant → THINKING（分析）
//   tool/call             → WORKING（按工具名分类：搜索/编辑/测试/执行）
//                           ；ask_user_question 类工具 → WAITING（等待用户）
//   approval/asked        → WAITING（等待审批）
//   tool/result、user/message、approval/decided → 恢复 THINKING / WORKING
//   todo/write            → 记录当前任务与进度
//   turn/end              → 完成 → SUCCESS 脉冲；blocked → WAITING；
//                           aborted → IDLE；异常结束 → ERROR
//
// 状态机逻辑参考/改编自 dsh-dafeiyu（https://github.com/QCYTSN/dsh-dafeiyu，
// MIT 许可）的 CompanionReducer；输出形态（JSON 快照 + 瞬态脉冲）为本插件
// 自定义。气泡文案见 lib/copy.js（原创 persona）。
// ─────────────────────────────────────────────────────────────────────────────
import { activityCopy, activityStage, statusCopy, taskCopy } from "./copy.js";

/** 宠物可见状态（与 assets/pet-manifest.json 的 stateMap 对齐）。 */
export const PetState = Object.freeze({
	IDLE: "IDLE",
	THINKING: "THINKING",
	WORKING: "WORKING",
	WAITING: "WAITING",
	ERROR: "ERROR",
	SUCCESS: "SUCCESS",
	DISCONNECTED: "DISCONNECTED"
});

/** 多会话选择优先级：越需要人注意的越靠前。 */
const statePriority = Object.freeze({
	[PetState.WAITING]: 60,
	[PetState.ERROR]: 50,
	[PetState.WORKING]: 30,
	[PetState.THINKING]: 20,
	[PetState.IDLE]: 0,
	[PetState.DISCONNECTED]: -1
});

/** 工具名 → 活动分类（气泡文案与动画变体据此选择）。 */
function toolActivity(name) {
	const value = String(name || "").toLowerCase();
	if (/search|grep|find|glob|web|read|fetch|open/.test(value)) return "searching";
	if (/write|edit|patch|replace|create|move|delete/.test(value)) return "editing";
	if (/test|check|lint|build|verify/.test(value)) return "testing";
	if (/shell|bash|exec|command|terminal|powershell/.test(value)) return "commanding";
	return "using-tool";
}

/** 从 tool/result 等事件里取工具调用 id。 */
function toolCallIdOf(event, fallback = "") {
	const content = event?.data?.message?.content;
	const contentCallId = Array.isArray(content)
		? content.find((item) => item?.toolCallId)?.toolCallId
		: void 0;
	return String(event?.data?.message?.source?.callId
		?? contentCallId
		?? event?.data?.message?.toolCallId
		?? event?.data?.message?.callId
		?? event?.data?.callId
		?? fallback);
}

/**
* 判断工具是否在等待用户输入（ask_user_question / 审批类）。
* 按整词判定，避免 review/allow/permission 等误判为「等待用户」。
*/
function isUserQuestionTool(name) {
	const value = String(name || "").toLowerCase();
	const tokens = value.split(/[^a-z0-9]+/u).filter(Boolean);
	const asks = new Set(["ask", "asking", "request", "requests", "requesting", "require", "requires", "prompt", "needs", "need", "seek", "seeks", "get", "gets"]);
	const filler = new Set(["for", "from", "the", "a", "an"]);
	const userWords = new Set(["user", "human", "me"]);
	const nouns = new Set(["question", "questions", "input", "answer", "answers", "decision", "decisions", "confirmation", "approval", "permission", "authorization", "authorisation", "consent", "clarify", "clarification", "help"]);
	const hasUserNoun = tokens.some((token, index) => userWords.has(token) && nouns.has(tokens[index + 1] ?? ""));
	const hasNounFromUser = tokens.some((token, index) => nouns.has(token) && tokens[index + 1] === "from" && userWords.has(tokens[index + 2] ?? ""));
	const hasAsk = tokens.some((token, index) => {
		if (!asks.has(token)) return false;
		let cursor = index + 1;
		while (cursor < tokens.length && (filler.has(tokens[cursor]) || userWords.has(tokens[cursor]))) {
			if (userWords.has(tokens[cursor])) {
				const next = tokens[cursor + 1];
				return !next || nouns.has(next);
			}
			cursor += 1;
		}
		return cursor < tokens.length && nouns.has(tokens[cursor]);
	});
	const strong = tokens.some((token) => token === "authorize" || token === "authorise" || token === "consent");
	return hasUserNoun || hasNounFromUser || hasAsk || strong;
}

function sessionIdOf(session) {
	return String(session?.header?.id ?? session?.id ?? "unknown-session");
}

function isSubagent(session) {
	return session?.header?.origin === "subagent"
		|| Number(session?.header?.delegationDepth ?? 0) > 0;
}

function cleanProjectName(value) {
	const text = String(value ?? "").trim();
	if (!text) return void 0;
	const pathParts = text.split(/[\\/]/u).filter(Boolean);
	const candidate = pathParts.length > 1 ? pathParts.at(-1) : text;
	return candidate.replace(/\s+/gu, " ").slice(0, 40) || void 0;
}

function projectNameOf(session, event) {
	const candidates = [
		session?.header?.title,
		session?.header?.name,
		session?.title,
		session?.name,
		session?.header?.cwd,
		session?.cwd,
		session?.context?.cwd,
		event?.data?.projectName,
		event?.data?.cwd
	];
	return candidates.map(cleanProjectName).find(Boolean);
}

function progressOf(todos) {
	if (!Array.isArray(todos) || todos.length === 0) return void 0;
	const completed = todos.filter((todo) => ["completed", "complete", "done"].includes(todo?.status)).length;
	const currentIndex = todos.findIndex((todo) => todo?.status === "in_progress");
	return {
		completed,
		total: todos.length,
		current: currentIndex >= 0 ? currentIndex + 1 : void 0
	};
}

function detailFor(record, stage = record.payload.stage) {
	const parts = [];
	if (record.project) parts.push(record.project);
	if (record.progress?.total) parts.push(`已完成 ${record.progress.completed}/${record.progress.total} 步`);
	if (record.task) parts.push(record.task);
	else if (stage) parts.push(stage);
	return parts.join(" · ") || stage || "DSH 任务";
}

export class PetStatusReducer {
	constructor({ includeSubagents = false, maxSessions = 64 } = {}) {
		this.includeSubagents = includeSubagents === true;
		this.sessions = new Map();
		this.maxSessions = maxSessions;
		this.clock = 0;
		this.selectedSessionId = void 0;
		this.outputSignature = void 0;
		this.tasksSignature = void 0;
		this.lastPulse = null;
	}

	setIncludeSubagents(value) {
		const includeSubagents = value === true;
		if (includeSubagents === this.includeSubagents) return;
		this.includeSubagents = includeSubagents;
		if (!includeSubagents) {
			for (const [sessionId, record] of this.sessions) {
				if (record.subagent) this.sessions.delete(sessionId);
			}
		}
	}

	/** 处理一个 session/event；任何异常由调用方兜底（不得打断共享事件总线）。 */
	handle(session, event) {
		if (!event || typeof event.type !== "string") return;
		const subagent = isSubagent(session);
		if (!this.includeSubagents && subagent) return;

		const sessionId = sessionIdOf(session);
		const record = this.#record(sessionId);
		record.subagent = subagent;
		record.lastSeq = Number(event.seq ?? record.lastSeq);
		record.project = projectNameOf(session, event) ?? record.project;

		switch (event.type) {
			case "turn/start":
				record.turnActive = true;
				record.openTools.clear();
				record.waitingCallId = void 0;
				record.waitingApprovalId = void 0;
				record.task = void 0;
				record.progress = void 0;
				this.#update(record, PetState.THINKING, {
					phase: "turn-start",
					stage: "准备阶段",
					message: statusCopy("preparing", event.seq)
				});
				return;

			case "step/start":
			case "assistant/chunk":
			case "assistant/message":
				if (!record.turnActive || record.openTools.size > 0) return;
				if (record.state === PetState.THINKING && record.payload.phase === "thinking") return;
				this.#update(record, PetState.THINKING, {
					phase: "thinking",
					stage: "分析阶段",
					message: statusCopy("thinking", event.seq)
				});
				return;

			case "tool/call": {
				const callId = toolCallIdOf(event, `seq-${String(event.seq ?? "unknown")}`);
				const name = String(event.data?.name ?? event.data?.message?.name ?? "tool");
				record.openTools.set(callId, name);
				if (isUserQuestionTool(name)) {
					record.waitingCallId = callId;
					this.#update(record, PetState.WAITING, {
						phase: "user-question",
						stage: "等待确认",
						toolName: name,
						message: statusCopy("waiting", event.seq)
					});
					return;
				}
				const activity = toolActivity(name);
				this.#update(record, PetState.WORKING, {
					phase: "tool-call",
					activity,
					stage: activityStage(activity),
					toolName: name,
					message: activityCopy(activity, event.seq)
				});
				return;
			}

			case "tool/result":
				this.#toolResult(record, event);
				return;

			case "user/message":
				this.#userMessage(record, event);
				return;

			case "todo/write":
				this.#todo(record, event);
				return;

			case "turn/end":
				this.#turnEnd(record, event);
				return;

			case "approval/asked": {
				const id = String(event.data?.id ?? "");
				const toolName = String(event.data?.toolName ?? "approval");
				record.waitingApprovalId = id;
				this.#update(record, PetState.WAITING, {
					phase: "approval",
					stage: "等待审批",
					toolName,
					message: statusCopy("approval", event.seq)
				});
				return;
			}

			case "approval/decided":
				this.#approvalDecided(record, event);
				return;

			default:
				return;
		}
	}

	disposeSession(session) {
		const sessionId = sessionIdOf(session);
		if (this.sessions.delete(sessionId)) {
			this.tasksSignature = void 0;
		}
	}

	/** 当前快照：所选会话的状态 + 最近一次瞬态脉冲（成功/工具错误）。 */
	snapshot() {
		const selection = this.#select();
		const record = selection.record;
		const signature = this.#signature(record);
		const changed = signature !== this.outputSignature;
		this.outputSignature = signature;
		return {
			state: record.state,
			phase: record.payload.phase,
			stage: record.payload.stage,
			activity: record.payload.activity,
			toolName: record.payload.toolName,
			message: record.payload.message,
			detail: detailFor(record),
			task: record.task,
			progress: record.progress,
			project: record.project,
			sessionId: record.id,
			changed,
			pulse: this.lastPulse,
			clock: this.clock,
			tasks: this.#activeTaskList()
		};
	}

	#toolResult(record, event) {
		const callId = toolCallIdOf(event);
		if (callId) record.openTools.delete(callId);
		if (callId && callId === record.waitingCallId) record.waitingCallId = void 0;
		this.#resumeAfterTool(record, event);
	}

	#userMessage(record, event) {
		if (!record.waitingCallId) return;
		record.openTools.delete(record.waitingCallId);
		record.waitingCallId = void 0;
		this.#resumeAfterTool(record, event);
	}

	#approvalDecided(record, event) {
		const id = String(event.data?.id ?? "");
		if (!record.waitingApprovalId || id !== record.waitingApprovalId) return;
		record.waitingApprovalId = void 0;
		this.#resumeAfterTool(record, event);
	}

	#resumeAfterTool(record, event) {
		if (record.waitingCallId && record.openTools.has(record.waitingCallId)) return;
		const next = record.openTools.size > 0 ? PetState.WORKING : PetState.THINKING;
		const activity = next === PetState.WORKING ? toolActivity(record.openTools.values().next().value) : void 0;
		this.#update(record, next, {
			phase: "tool-result",
			activity,
			stage: next === PetState.WORKING ? activityStage(activity) : "整理阶段",
			message: next === PetState.WORKING ? activityCopy(activity, event.seq) : statusCopy("result", event.seq)
		});
		if (!event.data?.error) return;
		const selection = this.#select();
		if (selection.record.state === PetState.WAITING || selection.record.state === PetState.ERROR) return;
		this.#pulse(PetState.ERROR, {
			phase: "tool-result",
			message: statusCopy("toolError", event.seq),
			detail: detailFor(record),
			errorCode: event.data.error.code
		});
	}

	#todo(record, event) {
		const todos = Array.isArray(event.data?.todos) ? event.data.todos : [];
		const current = todos.find((todo) => todo?.status === "in_progress")
			?? todos.find((todo) => todo?.status === "pending");
		const progress = progressOf(todos);
		if (!current?.content && !progress) return;
		const nextTask = current?.content ? String(current.content) : record.task;
		const unchanged = nextTask === record.task
			&& progress?.completed === record.progress?.completed
			&& progress?.total === record.progress?.total;
		if (unchanged) return;
		record.task = nextTask;
		record.progress = progress;
		record.updatedAt = ++this.clock;
		this.tasksSignature = void 0;
	}

	#turnEnd(record, event) {
		record.turnActive = false;
		record.openTools.clear();
		record.waitingCallId = void 0;
		record.waitingApprovalId = void 0;
		const kind = String(event.data?.reason?.kind ?? "completed");

		if (kind === "blocked") {
			this.#update(record, PetState.WAITING, {
				phase: "turn-end",
				stage: "等待确认",
				message: statusCopy("waiting", event.seq)
			});
			return;
		}
		if (kind === "aborted") {
			this.#update(record, PetState.IDLE, {
				phase: "turn-end",
				stage: "已停止",
				message: statusCopy("stopped", event.seq)
			});
			return;
		}
		if (kind !== "completed") {
			this.#update(record, PetState.ERROR, {
				phase: "turn-end",
				stage: "需要处理",
				reasonKind: kind,
				message: kind === "max-tokens" ? statusCopy("limit", event.seq) : statusCopy("error", event.seq)
			});
			return;
		}

		this.#update(record, PetState.IDLE, {
			phase: "turn-end",
			stage: "已完成",
			message: statusCopy("idle", event.seq)
		});
		const selection = this.#select();
		if (selection.record.state === PetState.WAITING || selection.record.state === PetState.ERROR) return;
		this.#pulse(PetState.SUCCESS, {
			phase: "turn-end",
			message: statusCopy("success", event.seq),
			detail: detailFor(record, "本轮已完成")
		});
	}

	#pulse(state, payload) {
		this.lastPulse = {
			id: ++this.clock,
			state,
			...payload
		};
	}

	#record(sessionId) {
		let record = this.sessions.get(sessionId);
		if (record) return record;
		record = {
			id: sessionId,
			state: PetState.IDLE,
			payload: { phase: "session-created", message: "DSH 空闲中" },
			turnActive: false,
			openTools: new Map(),
			waitingCallId: void 0,
			waitingApprovalId: void 0,
			task: void 0,
			progress: void 0,
			project: void 0,
			subagent: false,
			lastSeq: -1,
			updatedAt: ++this.clock
		};
		this.sessions.set(sessionId, record);
		if (this.sessions.size > this.maxSessions && this.maxSessions > 0) this.#evictSessions(record);
		return record;
	}

	#evictSessions(keep) {
		const records = [...this.sessions.values()].filter((record) => record !== keep);
		const idle = records
			.filter((record) => record.state === PetState.IDLE)
			.sort((left, right) => left.updatedAt - right.updatedAt);
		const victim = idle[0] ?? records.sort((left, right) => left.updatedAt - right.updatedAt)[0];
		if (victim) {
			this.sessions.delete(victim.id);
			this.tasksSignature = void 0;
		}
	}

	#update(record, state, payload) {
		record.state = state;
		record.payload = payload;
		record.updatedAt = ++this.clock;
	}

	#select() {
		const records = [...this.sessions.values()];
		if (records.length === 0) {
			return {
				record: {
					id: "dsh-host",
					state: PetState.IDLE,
					payload: { phase: "no-session", message: "DSH 空闲中" },
					task: void 0,
					progress: void 0,
					project: void 0,
					updatedAt: ++this.clock
				}
			};
		}
		records.sort((left, right) => {
			const priority = (statePriority[right.state] ?? 0) - (statePriority[left.state] ?? 0);
			return priority || right.updatedAt - left.updatedAt || left.id.localeCompare(right.id);
		});
		return { record: records[0] };
	}

	#activeTaskList() {
		return [...this.sessions.values()]
			.filter((record) => record.state !== PetState.IDLE && record.state !== PetState.DISCONNECTED)
			.sort((left, right) => {
				const priority = (statePriority[right.state] ?? 0) - (statePriority[left.state] ?? 0);
				return priority || right.updatedAt - left.updatedAt || left.id.localeCompare(right.id);
			})
			.map((record) => ({
				sessionId: record.id,
				state: record.state,
				project: record.project,
				task: record.task,
				message: record.payload.message,
				detail: detailFor(record)
			}));
	}

	#signature(record) {
		return [
			record.id,
			record.state,
			record.payload.activity ?? "",
			record.payload.toolName ?? "",
			record.payload.message ?? "",
			record.project ?? "",
			record.task ?? "",
			record.progress?.completed ?? "",
			record.progress?.total ?? ""
		].join("|");
	}
}

export { isUserQuestionTool, statePriority, toolActivity, toolCallIdOf };
