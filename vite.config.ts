import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import fs from "fs";
import { spawn } from "child_process";
import type { Plugin } from "vite";

const ANALISES_FILE = path.resolve(__dirname, "src/data/analises-salvas.json");

/** Plugin Vite que expõe /api/analises para persistência local em disco.
 *  GET  /api/analises → lê analises-salvas.json
 *  POST /api/analises → escreve analises-salvas.json
 *  Garante que nenhuma análise se perde mesmo que o localStorage seja limpo. */
function pepitoPersistencePlugin(): Plugin {
  return {
    name: "pepito-persistence",
    configureServer(server) {
      server.middlewares.use("/api/analises", (req, res, next) => {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Content-Type", "application/json");

        if (req.method === "GET") {
          try {
            const raw = fs.existsSync(ANALISES_FILE)
              ? fs.readFileSync(ANALISES_FILE, "utf8")
              : JSON.stringify({ analises: [], exclusoes: [] });
            const data = JSON.parse(raw);
            res.writeHead(200);
            res.end(JSON.stringify({ analises: data.analises ?? [], exclusoes: data.exclusoes ?? [] }));
          } catch {
            res.writeHead(200);
            res.end(JSON.stringify({ analises: [], exclusoes: [] }));
          }
          return;
        }

        if (req.method === "POST") {
          let body = "";
          req.on("data", (chunk) => { body += chunk; });
          req.on("end", () => {
            try {
              const payload = JSON.parse(body);
              const existing = fs.existsSync(ANALISES_FILE)
                ? JSON.parse(fs.readFileSync(ANALISES_FILE, "utf8"))
                : { _meta: {}, analises: [], exclusoes: [] };

              existing.analises = payload.analises ?? existing.analises;
              existing.exclusoes = payload.exclusoes ?? existing.exclusoes;
              existing._meta = {
                ...existing._meta,
                ultima_atualizacao: new Date().toISOString(),
                total_analises: (payload.analises ?? []).length,
                total_exclusoes: (payload.exclusoes ?? []).length,
              };

              fs.writeFileSync(ANALISES_FILE, JSON.stringify(existing, null, 2), "utf8");
              res.writeHead(200);
              res.end(JSON.stringify({ ok: true, total: (payload.analises ?? []).length }));
            } catch (e) {
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

const QUEUE_FILE = path.resolve(__dirname, "src/data/registration-queue-real.json");
const REFRESH_SCRIPT = path.resolve(__dirname, ".tools/refresh-daily.sh");
const REFRESH_LOG = path.resolve(__dirname, ".tools/refresh-daily.log");
let refreshRunning = false;

/** Plugin que expõe /api/refresh para atualização on-demand da fila PLD.
 *  POST /api/refresh        → inicia refresh-daily.sh em background
 *  GET  /api/refresh/status → running | idle + última linha do log */
function pepitoRefreshPlugin(): Plugin {
  return {
    name: "pepito-refresh",
    configureServer(server) {
      // Em dev, responde /auth/me com 401 JSON para não confundir o auth guard
      server.middlewares.use("/auth", (req, res, next) => {
        res.setHeader("Content-Type", "application/json");
        if (req.url === "/me") {
          res.writeHead(401);
          res.end(JSON.stringify({ error: "dev mode — SSO desativado" }));
          return;
        }
        next();
      });

      // Serve registration-queue-real.json dinamicamente (sem rebuild)
      server.middlewares.use("/api/queue", (req, res, next) => {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Content-Type", "application/json");
        if (req.method === "GET") {
          try {
            const raw = fs.existsSync(QUEUE_FILE) ? fs.readFileSync(QUEUE_FILE, "utf8") : '{"_meta":{},"items":[]}';
            res.writeHead(200); res.end(raw);
          } catch { res.writeHead(200); res.end('{"_meta":{},"items":[]}'); }
          return;
        }
        next();
      });

      server.middlewares.use("/api/refresh", (req, res) => {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Content-Type", "application/json");

        if (req.method === "GET") {
          let lastLine = "";
          try {
            const log = fs.existsSync(REFRESH_LOG)
              ? fs.readFileSync(REFRESH_LOG, "utf8").trim().split("\n")
              : [];
            lastLine = log.filter((l) => l.trim()).slice(-1)[0] ?? "";
          } catch { /* ignore */ }
          res.writeHead(200);
          res.end(JSON.stringify({ running: refreshRunning, lastLine }));
          return;
        }

        if (req.method === "POST") {
          if (refreshRunning) {
            res.writeHead(409);
            res.end(JSON.stringify({ error: "Refresh já em andamento." }));
            return;
          }
          refreshRunning = true;
          const proc = spawn("/bin/bash", [REFRESH_SCRIPT], {
            detached: true, stdio: "ignore",
            env: { ...process.env, PATH: `/bin:/usr/bin:/usr/local/bin:${process.env.PATH ?? ""}` },
          });
          proc.unref();
          proc.on("close", () => { refreshRunning = false; });
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
