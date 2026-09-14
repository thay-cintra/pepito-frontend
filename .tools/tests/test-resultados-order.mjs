import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import ts from "typescript";
import vm from "node:vm";

function loadModule() {
  const filename = new URL("../../src/lib/resultados-order.ts", import.meta.url);
  const source = fs.readFileSync(filename, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(transpiled, { module, exports: module.exports }, { filename: filename.pathname });
  return module.exports;
}

test("orders results by descending risk, stably, without mutating the input", () => {
  const { orderResultadosByRisk } = loadModule();
  const input = [
    { id: "low", risco: "baixo" },
    { id: "high-1", risco: "alto" },
    { id: "medium", risco: "medio" },
    { id: "high-2", risco: "alto" },
  ];
  const originalOrder = input.map((item) => item.id);

  const ordered = orderResultadosByRisk(input);

  assert.deepEqual(Array.from(ordered, (item) => item.id), ["high-1", "high-2", "medium", "low"]);
  assert.deepEqual(input.map((item) => item.id), originalOrder);
  assert.notEqual(ordered, input);
});
