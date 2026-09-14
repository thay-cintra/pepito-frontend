import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";


const sourcePath = new URL("../../src/lib/registration-search.ts", import.meta.url);

function loadModule() {
  const source = fs.readFileSync(sourcePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(`(function (exports, module) { ${transpiled}\n})(module.exports, module);`, { module });
  return module.exports;
}

test("registration case search includes PF and PJ Credilink tokens", () => {
  const { registrationCaseMatchesSearch } = loadModule();
  const caso = {
    rf_nome_oficial: "Empresa Teste",
    cnpj: "12.345.678/0001-90",
    cpf: "123.456.789-01",
    full_name_pf: "Pessoa Teste",
    email: "pessoa@example.com",
    draft_id: "draft-1",
    uf: "SP",
    cidade: "São Paulo",
    cnae: "1234-5/67",
    token_pf_cred: "AbCd-1234",
    token_pj_cred: "TOKEN.PJ.987",
  };

  assert.equal(registrationCaseMatchesSearch(caso, "abcd1234"), true);
  assert.equal(registrationCaseMatchesSearch(caso, "token-pj-987"), true);
  assert.equal(registrationCaseMatchesSearch(caso, "empresa teste"), true);
  assert.equal(registrationCaseMatchesSearch(caso, "não existe"), false);
});

test("generic search supports the token saved in completed analysis history", () => {
  const { matchesNormalizedSearch } = loadModule();

  assert.equal(
    matchesNormalizedSearch("TOK en-555", ["Empresa", "token555"]),
    true,
  );
});
