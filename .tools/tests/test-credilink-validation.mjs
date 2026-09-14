import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";


const sourcePath = new URL("../../src/lib/credilink-validation.ts", import.meta.url);

function loadModule() {
  const source = fs.readFileSync(sourcePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(`(function (exports, module) { ${transpiled}\n})(module.exports, module);`, { module });
  return module.exports;
}

test("Credilink ledger entry requires a real token and completed compliance", () => {
  const { isCredilinkEntryOk } = loadModule();
  const completed = {
    token_compliance: "token-real-123",
    compliance: { code: 200, message: "Sucesso" },
  };

  assert.equal(isCredilinkEntryOk(completed), true);
  assert.equal(isCredilinkEntryOk({ ...completed, token_compliance: "" }), false);
  assert.equal(isCredilinkEntryOk({ ...completed, token_compliance: "   " }), false);
  assert.equal(isCredilinkEntryOk({ ...completed, compliance: { code: 200, message: "Processando" } }), false);
  assert.equal(isCredilinkEntryOk({ ...completed, compliance: { code: 500, message: "Erro" } }), false);
  assert.equal(isCredilinkEntryOk({ ...completed, erro_compliance: "timeout" }), false);
});

test("upstream titular token must be a non-blank string", () => {
  const { hasCredilinkToken } = loadModule();

  assert.equal(hasCredilinkToken("token-real-123"), true);
  assert.equal(hasCredilinkToken(""), false);
  assert.equal(hasCredilinkToken("   "), false);
  assert.equal(hasCredilinkToken(null), false);
});
