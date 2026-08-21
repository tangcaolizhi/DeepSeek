// dsh-pet-deepseek-girl client 半工厂校验（无浏览器，仅验证工厂可执行与导出）
//
// 运行：node tests/verify-client.mjs
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

const require = createRequire("D:/APP/DSH Desktop/resources/app/package.json");

let registration = null;
globalThis.window = { __ModuleLoader__: { load(reg) { registration = reg; } } };
globalThis.document = {
	querySelector: () => null,
	createElement: () => ({ dataset: {}, textContent: "" }),
	head: { appendChild: () => {} }
};

const code = readFileSync("C:/my deepseek horness/deepseek娘/dsh-pet-deepseek-girl/lib/client.js", "utf8");
const sandbox = {
	window: globalThis.window,
	document: globalThis.document,
	require,
	module: { exports: {} },
	exports: {},
	Object, Array, JSON, Math, Number, String, Boolean, Symbol, RegExp, Error, TypeError, Promise,
	setTimeout, clearTimeout, fetch, AbortSignal, URL, console, structuredClone
};
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: "client.js" });

if (registration === null) throw new Error("未调用 window.__ModuleLoader__.load");
const ex = registration.factory((spec) => {
	if (spec === "react" || spec === "react/jsx-runtime") return require(spec);
	throw new Error(`unexpected require: ${spec}`);
});

console.log("client factory executed OK");
console.log("  id:", registration.id);
console.log("  inject:", JSON.stringify(ex.inject));
console.log("  apply is function:", typeof ex.apply === "function");
if (registration.id !== "dsh-pet-deepseek-girl") throw new Error("id mismatch");
if (JSON.stringify(ex.inject) !== '["slots"]') throw new Error("inject mismatch");
if (typeof ex.apply !== "function") throw new Error("apply missing");
console.log("\nCLIENT FACTORY CHECK PASS");
