var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import fs from "fs";
import { spawn } from "child_process";
var ANALISES_FILE = path.resolve(__dirname, "src/data/analises-salvas.json");
/** Plugin Vite que expõe /api/analises para persistência local em disco.
 *  GET  /api/analises → lê analises-salvas.json
 *  POST /api/analises → escreve analises-salvas.json
 *  Garante que nenhuma análise se perde mesmo que o localStorage seja limpo. */
function pepitoPersistencePlugin() {
    return {
        name: "pepito-persistence",
        configureServer: function (server) {
            server.middlewares.use("/api/analises", function (req, res, next) {
                var _a, _b;
                res.setHeader("Access-Control-Allow-Origin", "*");
                res.setHeader("Content-Type", "application/json");
                if (req.method === "GET") {
                    try {
                        var raw = fs.existsSync(ANALISES_FILE)
                            ? fs.readFileSync(ANALISES_FILE, "utf8")
                            : JSON.stringify({ analises: [], exclusoes: [] });
                        var data = JSON.parse(raw);
                        res.writeHead(200);
                        res.end(JSON.stringify({ analises: (_a = data.analises) !== null && _a !== void 0 ? _a : [], exclusoes: (_b = data.exclusoes) !== null && _b !== void 0 ? _b : [] }));
                    }
                    catch (_c) {
                        res.writeHead(200);
                        res.end(JSON.stringify({ analises: [], exclusoes: [] }));
                    }
                    return;
                }
                if (req.method === "POST") {
                    var body_1 = "";
                    req.on("data", function (chunk) { body_1 += chunk; });
                    req.on("end", function () {
                        var _a, _b, _c, _d, _e;
                        try {
                            var payload = JSON.parse(body_1);
                            var existing = fs.existsSync(ANALISES_FILE)
                                ? JSON.parse(fs.readFileSync(ANALISES_FILE, "utf8"))
                                : { _meta: {}, analises: [], exclusoes: [] };
                            existing.analises = (_a = payload.analises) !== null && _a !== void 0 ? _a : existing.analises;
                            existing.exclusoes = (_b = payload.exclusoes) !== null && _b !== void 0 ? _b : existing.exclusoes;
                            existing._meta = __assign(__assign({}, existing._meta), { ultima_atualizacao: new Date().toISOString(), total_analises: ((_c = payload.analises) !== null && _c !== void 0 ? _c : []).length, total_exclusoes: ((_d = payload.exclusoes) !== null && _d !== void 0 ? _d : []).length });
                            fs.writeFileSync(ANALISES_FILE, JSON.stringify(existing, null, 2), "utf8");
                            res.writeHead(200);
                            res.end(JSON.stringify({ ok: true, total: ((_e = payload.analises) !== null && _e !== void 0 ? _e : []).length }));
                        }
                        catch (e) {
                            res.writeHead(500);
                            res.end(JSON.stringify({ error: String(e) }));
                        }
                    });
                    return;
                }
                next();
            });
        },
    };
}
var QUEUE_FILE = path.resolve(__dirname, "src/data/registration-queue-real.json");
var REFRESH_SCRIPT = path.resolve(__dirname, ".tools/refresh-daily.sh");
var REFRESH_LOG = path.resolve(__dirname, ".tools/refresh-daily.log");
var refreshRunning = false;
/** Plugin que expõe /api/refresh para atualização on-demand da fila PLD.
 *  POST /api/refresh        → inicia refresh-daily.sh em background
 *  GET  /api/refresh/status → running | idle + última linha do log */
function pepitoRefreshPlugin() {
    return {
        name: "pepito-refresh",
        configureServer: function (server) {
            // Em dev, responde /auth/me com 401 JSON para não confundir o auth guard
            server.middlewares.use("/auth", function (req, res, next) {
                res.setHeader("Content-Type", "application/json");
                if (req.url === "/me") {
                    res.writeHead(401);
                    res.end(JSON.stringify({ error: "dev mode — SSO desativado" }));
                    return;
                }
                next();
            });
            // Serve registration-queue-real.json dinamicamente (sem rebuild)
            server.middlewares.use("/api/queue", function (req, res, next) {
                res.setHeader("Access-Control-Allow-Origin", "*");
                res.setHeader("Content-Type", "application/json");
                if (req.method === "GET") {
                    try {
                        var raw = fs.existsSync(QUEUE_FILE) ? fs.readFileSync(QUEUE_FILE, "utf8") : '{"_meta":{},"items":[]}';
                        res.writeHead(200);
                        res.end(raw);
                    }
                    catch (_a) {
                        res.writeHead(200);
                        res.end('{"_meta":{},"items":[]}');
                    }
                    return;
                }
                next();
            });
            server.middlewares.use("/api/refresh", function (req, res) {
                var _a, _b;
                res.setHeader("Access-Control-Allow-Origin", "*");
                res.setHeader("Content-Type", "application/json");
                if (req.method === "GET") {
                    var lastLine = "";
                    try {
                        var log = fs.existsSync(REFRESH_LOG)
                            ? fs.readFileSync(REFRESH_LOG, "utf8").trim().split("\n")
                            : [];
                        lastLine = (_a = log.filter(function (l) { return l.trim(); }).slice(-1)[0]) !== null && _a !== void 0 ? _a : "";
                    }
                    catch ( /* ignore */_c) { /* ignore */ }
                    res.writeHead(200);
                    res.end(JSON.stringify({ running: refreshRunning, lastLine: lastLine }));
                    return;
                }
                if (req.method === "POST") {
                    if (refreshRunning) {
                        res.writeHead(409);
                        res.end(JSON.stringify({ error: "Refresh já em andamento." }));
                        return;
                    }
                    refreshRunning = true;
                    var proc = spawn("/bin/bash", [REFRESH_SCRIPT], {
                        detached: true, stdio: "ignore",
                        env: __assign(__assign({}, process.env), { PATH: "/bin:/usr/bin:/usr/local/bin:".concat((_b = process.env.PATH) !== null && _b !== void 0 ? _b : "") }),
                    });
                    proc.unref();
                    proc.on("close", function () { refreshRunning = false; });
                    res.writeHead(202);
                    res.end(JSON.stringify({ ok: true, message: "Refresh iniciado." }));
                    return;
                }
                res.writeHead(405);
                res.end(JSON.stringify({ error: "Method not allowed" }));
            });
        },
    };
}
export default defineConfig({
    plugins: [react(), pepitoPersistencePlugin(), pepitoRefreshPlugin()],
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
    },
    server: {
        port: 5173,
        host: true,
    },
});
