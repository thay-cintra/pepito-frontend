import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";


const sourcePath = new URL("../../src/lib/leadership-guard.ts", import.meta.url);

function loadModule() {
  const source = fs.readFileSync(sourcePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(`(function (exports, module) { ${transpiled}\n})(module.exports, module);`, { module });
  return module.exports;
}

test("real case without verifiable consultation status requires manual confirmation", () => {
  const { needsManualConsultationCheck } = loadModule();

  assert.equal(needsManualConsultationCheck(true, null, false), true);
  assert.equal(needsManualConsultationCheck(false, null, false), false);
});

test("completed JusBrasil and Credilink consultation removes the manual check", () => {
  const { needsManualConsultationCheck } = loadModule();
  const complete = { jusbrasilOk: true, credilinkPepOk: true };
  const pendingCredilink = { jusbrasilOk: true, credilinkPepOk: false };

  assert.equal(needsManualConsultationCheck(true, complete, false), false);
  assert.equal(needsManualConsultationCheck(true, pendingCredilink, false), true);
  assert.equal(needsManualConsultationCheck(true, pendingCredilink, true), false);
});

test("live consultation only covers one matching pending related PEP", () => {
  const { liveConsultationCoversAllPending } = loadModule();

  assert.equal(liveConsultationCoversAllPending(["111"], "111"), true);
  assert.equal(liveConsultationCoversAllPending(["111"], "222"), false);
  assert.equal(liveConsultationCoversAllPending(["111", "222"], "111"), false);
  assert.equal(liveConsultationCoversAllPending([], "111"), false);
});
