/**
 * Servidor de produção do Pepito — SSO Google restrito a @cora.com.br
 *
 * Variáveis de ambiente (.env na raiz pepito-frontend):
 *   PORT                Porta HTTP (default 4173)
 *   APP_URL             URL pública, ex: https://pepito.cora.team
 *   GOOGLE_CLIENT_ID    Client ID do OAuth App no Google Cloud Console
 *   GOOGLE_CLIENT_SECRET Client Secret do OAuth App
 *   JWT_SECRET          String aleatória longa para assinar os tokens de sessão
 */

require("dotenv").config();
const express     = require("express");
const cookieParser = require("cookie-parser");
const crypto      = require("crypto");
const fs          = require("fs");
const path        = require("path");
const https       = require("https");
const http        = require("http");
const { spawn }   = require("child_process");

// ── GCS (quando GCS_BUCKET_NAME está definido) ───────────────────────────────
const GCS_BUCKET_NAME = process.env.GCS_BUCKET_NAME || "";
let gcsBucket = null;
if (GCS_BUCKET_NAME) {
  try {
    const { Storage } = require("@google-cloud/storage");
    gcsBucket = new Storage().bucket(GCS_BUCKET_NAME);
  } catch (e) {
    console.warn("[gcs] @google-cloud/storage não disponível — usando filesystem:", e.message);
  }
}

async function readDataFile(localPath, gcsObject, fallback) {
  if (gcsBucket) {
    try {
      const [contents] = await gcsBucket.file(gcsObject).download();
      return JSON.parse(contents.toString("utf8"));
    } catch (e) {
      if (e.code === 404) return fallback;
      throw e;
    }
  }
  try {
    const raw = fs.existsSync(localPath) ? fs.readFileSync(localPath, "utf8") : null;
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

async function writeDataFile(localPath, gcsObject, data) {
  const json = JSON.stringify(data, null, 2);
  if (gcsBucket) {
    await gcsBucket.file(gcsObject).save(json, { contentType: "application/json" });
    return;
  }
  fs.writeFileSync(localPath, json);
}

const PORT           = parseInt(process.env.PORT || "4173", 10);
const APP_URL        = (process.env.APP_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
const CLIENT_ID      = process.env.GOOGLE_CLIENT_ID || "";
const CLIENT_SECRET  = process.env.GOOGLE_CLIENT_SECRET || "";
const JWT_SECRET     = process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex");
const ALLOWED_DOMAIN = "cora.com.br";
// LOCAL_MODE=true → sem SSO, acesso direto pela VPN/rede interna
const LOCAL_MODE     = process.env.LOCAL_MODE === "true";

const DIST          = path.join(__dirname, "dist");
const ANALISES_FILE = path.join(__dirname, "src", "data", "analises-salvas.json");
const QUEUE_FILE    = path.join(__dirname, "src", "data", "registration-queue-real.json");
const REFRESH_LOG   = path.join(__dirname, ".tools", "refresh-daily.log");
const REFRESH_SH    = path.join(__dirname, ".tools", "refresh-daily.sh");
const QUEUE_SYNC_SH = path.join(__dirname, ".tools", "queue-sync.sh");
const COOKIE_NAME   = "pepito_session";

// ── JWT mínimo (HS256) — sem dependências externas ──────────────────────────
function signJwt(payload) {
  const header = Buffer.from('{"alg":"HS256","typ":"JWT"}').toString("base64url");
  const body   = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig    = crypto.createHmac("sha256", JWT_SECRET)
                       .update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${sig}`;
}

function verifyJwt(token) {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expected = crypto.createHmac("sha256", JWT_SECRET)
                         .update(`${header}.${body}`).digest("base64url");
  if (sig !== expected) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    if (payload.exp && Date.now() / 1000 > payload.exp) return null;
    return payload;
  } catch { return null; }
}

// ── Middleware de autenticação ───────────────────────────────────────────────
function requireAuth(req, res, next) {
  // LOCAL_MODE: rede interna / VPN — sem SSO, qualquer acesso é permitido
  if (LOCAL_MODE) {
    req.user = { email: "local@cora.com.br", name: "Acesso Local", picture: "" };
    return next();
  }
  const token = req.cookies?.[COOKIE_NAME];
  const user  = verifyJwt(token);
  if (!user) {
    if (req.path.startsWith("/api/")) {
      return res.status(401).json({ error: "Não autenticado" });
    }
    return res.redirect("/login");
  }
  req.user = user;
  next();
}

// ── App Express ──────────────────────────────────────────────────────────────
const app = express();
app.use(cookieParser());
app.use(express.json());

// ── Rotas de auth (públicas) ─────────────────────────────────────────────────

// Inicia o fluxo OAuth Google
app.get("/auth/google", (req, res) => {
  if (!CLIENT_ID) {
    return res.status(500).send("GOOGLE_CLIENT_ID não configurado no .env");
  }
  const params = new URLSearchParams({
    client_id:     CLIENT_ID,
    redirect_uri:  `${APP_URL}/auth/google/callback`,
    response_type: "code",
    scope:         "openid email profile",
    hd:            ALLOWED_DOMAIN,        // restringe ao domínio Google Workspace
    access_type:   "offline",
    prompt:        "select_account",
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

// Callback do Google após consentimento
app.get("/auth/google/callback", async (req, res) => {
  const code = req.query.code;
  if (!code) return res.redirect("/login?error=sem_codigo");

  try {
    // 1. Troca code por access_token
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
        redirect_uri: `${APP_URL}/auth/google/callback`,
        grant_type: "authorization_code",
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) throw new Error("token_exchange_failed");

    // 2. Busca dados do usuário
    const userRes  = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const userInfo = await userRes.json();

    // 3. Verifica domínio @cora.com.br
    const email = (userInfo.email || "").toLowerCase();
    if (!email.endsWith(`@${ALLOWED_DOMAIN}`)) {
      console.warn(`[auth] Acesso negado: ${email}`);
      return res.redirect("/login?error=dominio_invalido");
    }

    // 4. Emite JWT de sessão (8h)
    const jwt = signJwt({
      email,
      name:    userInfo.name || email.split("@")[0],
      picture: userInfo.picture || "",
      exp:     Math.floor(Date.now() / 1000) + 8 * 3600,
    });

    console.log(`[auth] Login: ${email}`);
    res.cookie(COOKIE_NAME, jwt, {
      httpOnly: true,
      secure:   APP_URL.startsWith("https"),
      sameSite: "lax",
      maxAge:   8 * 3600 * 1000,
    });
    res.redirect("/");
  } catch (e) {
    console.error("[auth] Erro no callback:", e);
    res.redirect("/login?error=falha_oauth");
  }
});

// Dados do usuário atual (usado pelo frontend)
// Em LOCAL_MODE retorna usuário genérico para o frontend não exibir tela de login
app.get("/auth/me", (req, res) => {
  if (LOCAL_MODE) {
    return res.json({ email: "local@cora.com.br", name: "Acesso Local (VPN)", picture: "" });
  }
  requireAuth(req, res, () => {
    res.json({ email: req.user.email, name: req.user.name, picture: req.user.picture });
  });
});

// Logout
app.get("/auth/logout", (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.redirect("/login");
});

// Health check (pública — usada por readiness/liveness probes)
app.get("/health", (req, res) => res.json({ ok: true }));

// Página de login (pública — servida pelo SPA, sem auth guard)
app.get("/login", (req, res) => {
  res.sendFile(path.join(DIST, "index.html"));
});

// ── APIs protegidas ──────────────────────────────────────────────────────────

let refreshRunning = false;

app.get("/api/analises", requireAuth, async (req, res) => {
  try {
    const data = await readDataFile(ANALISES_FILE, "analises-salvas.json", { analises: [], exclusoes: [] });
    res.json({ analises: data.analises ?? [], exclusoes: data.exclusoes ?? [] });
  } catch { res.json({ analises: [], exclusoes: [] }); }
});

app.post("/api/analises", requireAuth, async (req, res) => {
  try {
    const existing = await readDataFile(ANALISES_FILE, "analises-salvas.json", { analises: [], exclusoes: [] });
    existing.analises  = req.body.analises  ?? existing.analises;
    existing.exclusoes = req.body.exclusoes ?? existing.exclusoes;
    existing._meta     = { ultima_atualizacao: new Date().toISOString(), by: req.user.email };
    await writeDataFile(ANALISES_FILE, "analises-salvas.json", existing);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ── Fila PLD — serve JSON em tempo real (sem rebuild) ───────────────────────
app.get("/api/queue", requireAuth, async (req, res) => {
  try {
    const data = await readDataFile(QUEUE_FILE, "registration-queue-real.json", { _meta: {}, items: [] });
    res.json(data);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

let queueSyncRunning = false;
const QUEUE_SYNC_LOG = path.join(__dirname, ".tools", "queue-sync.log");

// Sincronização rápida com Athena (só build-real-queue.py, sem AI e sem rebuild)
app.get("/api/queue/sync", requireAuth, (req, res) => {
  let lastLine = "";
  try {
    const log = fs.existsSync(QUEUE_SYNC_LOG)
      ? fs.readFileSync(QUEUE_SYNC_LOG, "utf8").trim().split("\n")
      : [];
    lastLine = log.filter((l) => l.trim()).slice(-1)[0] ?? "";
  } catch { /* ignore */ }
  res.json({ running: queueSyncRunning, lastLine });
});

app.post("/api/queue/sync", requireAuth, (req, res) => {
  if (queueSyncRunning) return res.status(409).json({ error: "Sincronização já em andamento." });
  queueSyncRunning = true;
  console.log(`[queue/sync] Iniciado por ${req.user?.email}`);
  const proc = spawn("/bin/bash", [QUEUE_SYNC_SH], {
    detached: true, stdio: "ignore",
    env: { ...process.env, PATH: `/bin:/usr/bin:/usr/local/bin:${process.env.PATH ?? ""}` },
  });
  proc.unref();
  proc.on("close", () => { queueSyncRunning = false; });
  res.status(202).json({ ok: true });
});

app.get("/api/refresh", requireAuth, (req, res) => {
  let lastLine = "";
  try {
    const log = fs.existsSync(REFRESH_LOG)
      ? fs.readFileSync(REFRESH_LOG, "utf8").trim().split("\n")
      : [];
    lastLine = log.filter((l) => l.trim()).slice(-1)[0] ?? "";
  } catch { /* ignore */ }
  res.json({ running: refreshRunning, lastLine });
});

app.post("/api/refresh", requireAuth, (req, res) => {
  if (refreshRunning) return res.status(409).json({ error: "Refresh já em andamento." });
  refreshRunning = true;
  console.log(`[refresh] Iniciado por ${req.user.email}`);
  const proc = spawn("/bin/bash", ["-c",
    `${REFRESH_SH} && cd "${__dirname}" && npm run build >> "${REFRESH_LOG}" 2>&1`
  ], { detached: true, stdio: "ignore" });
  proc.unref();
  proc.on("close", () => { refreshRunning = false; });
  res.status(202).json({ ok: true, message: "Refresh + rebuild iniciados." });
});

// ── Arquivos estáticos ───────────────────────────────────────────────────────
// Assets (JS/CSS/imagens) são públicos — necessários para renderizar /login
app.use("/assets", express.static(path.join(DIST, "assets")));
// Demais arquivos estáticos exigem auth
app.use(requireAuth, express.static(DIST));

// SPA fallback (React Router)
app.get("*", requireAuth, (req, res) => {
  res.sendFile(path.join(DIST, "index.html"));
});

// ── Start ────────────────────────────────────────────────────────────────────
// ── Detecta certificados TLS para HTTPS ─────────────────────────────────────
const CERT_FILE = path.join(__dirname, "certs", "cert.pem");
const KEY_FILE  = path.join(__dirname, "certs", "key.pem");
const tlsAvailable = fs.existsSync(CERT_FILE) && fs.existsSync(KEY_FILE);

function startServer() {
  const allIps = (() => {
    try {
      const os = require("os");
      const ifaces = os.networkInterfaces();
      const ips = [];
      for (const [name, addrs] of Object.entries(ifaces)) {
        for (const iface of addrs) {
          if (iface.family === "IPv4" && !iface.internal) ips.push({ name, address: iface.address });
        }
      }
      return ips;
    } catch { return []; }
  })();

  const proto = tlsAvailable ? "https" : "http";

  if (tlsAvailable) {
    const tlsOptions = { key: fs.readFileSync(KEY_FILE), cert: fs.readFileSync(CERT_FILE) };
    https.createServer(tlsOptions, app).listen(PORT, "0.0.0.0", onListen);
    // Redireciona HTTP → HTTPS na porta PORT+1
    const httpPort = PORT + 1;
    http.createServer((req, res) => {
      const host = (req.headers.host || "").replace(`:${httpPort}`, `:${PORT}`);
      res.writeHead(301, { Location: `https://${host}${req.url}` });
      res.end();
    }).listen(httpPort, "0.0.0.0");
  } else {
    http.createServer(app).listen(PORT, "0.0.0.0", onListen);
  }

  function onListen() {
    console.log(`\n🚀 Pepito rodando`);
    if (LOCAL_MODE) {
      console.log(`   MODO:          Local / VPN (sem SSO)`);
      console.log(`   TLS:           ${tlsAvailable ? "✓ HTTPS ativo (certs/cert.pem)" : "✗ HTTP — rode mkcert para ativar HTTPS"}`);
      console.log(`   Acesso local:  ${proto}://localhost:${PORT}`);
      for (const { name, address } of allIps) {
        const label = name.startsWith("utun") || name.startsWith("tun") || name.startsWith("ppp")
          ? "← IP da VPN (use este!)"
          : "← rede local Wi-Fi";
        console.log(`   ${name.padEnd(14)} ${proto}://${address}:${PORT}  ${label}`);
      }
      if (tlsAvailable) {
        console.log(`\n   ⚠️  Analistas precisam instalar o certificado CA uma única vez.`);
        console.log(`      Arquivo: certs/rootCA.pem  (copie de: ${path.join(path.dirname(CERT_FILE), "../..")})`);
      }
    } else {
      console.log(`   MODO:          Produção (SSO Google @${ALLOWED_DOMAIN})`);
      console.log(`   APP_URL:       ${APP_URL}`);
      console.log(`   Google OAuth:  ${CLIENT_ID ? "✓ configurado" : "✗ GOOGLE_CLIENT_ID ausente"}`);
    }
    console.log();
  }
}

startServer();
