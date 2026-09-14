import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import ts from "typescript";
import vm from "node:vm";

function loadModule() {
  const filename = new URL("../../src/lib/media-finding-match.ts", import.meta.url);
  const source = fs.readFileSync(filename, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(transpiled, { module, exports: module.exports }, { filename: filename.pathname });
  return module.exports;
}

test("explicit positive flag is authoritative for the similarity badge", () => {
  const { findingSimilarity } = loadModule();

  assert.equal(findingSimilarity({ achado_positivo: true }), "100%");
  assert.equal(findingSimilarity({ achado_positivo: false, risk_indicator: "alto" }), undefined);
  assert.equal(findingSimilarity({ achado_positivo: true, homonimo_alerta: "validar" }), "verificar identidade");
});

test("M7 and technical placeholders never receive similarity", () => {
  const { findingSimilarity } = loadModule();

  assert.equal(findingSimilarity({ achado_positivo: true, title: "M7 — contexto regional" }), undefined);
  assert.equal(findingSimilarity({ achado_positivo: true, source: "Sistema Pepito — Erro de Consulta" }), undefined);
});

test("legacy findings without the field keep the previous heuristic", () => {
  const { findingSimilarity } = loadModule();

  assert.equal(findingSimilarity({ source: "JusBrasil", risk_indicator: "baixo" }), "100%");
  assert.equal(findingSimilarity({ source: "JusBrasil", homonimo_alerta: "nome comum" }), "verificar identidade");
});
