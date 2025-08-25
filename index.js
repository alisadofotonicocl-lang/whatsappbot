import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason
} from "@whiskeysockets/baileys";
import qrcodeTerm from "qrcode-terminal";
import QRCode from "qrcode";
import express from "express";
import * as path from "path";
import dotenv from "dotenv";

dotenv.config();

const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || ""; // si está vacío, /admin queda deshabilitado

let behaviorPrompt =
  process.env.BOT_PROMPT ||
  "Eres un asistente cordial, claro y conciso. Responde en español.";
const allowedNumbers = (process.env.ALLOWED_NUMBERS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

let currentQR = null;   // último QR para la web
let waReady = false;    // estado conexión
let botStarting = false; // evita doble arranque

const hasAPIKey = () => OPENAI_API_KEY && OPENAI_API_KEY.trim().length > 0;

app.get("/", async (req, res) => {
  const banner = hasAPIKey()
    ? ""
    : `<div style="background:#fff3cd;color:#664d03;padding:12px;border-radius:8px;border:1px solid #ffe69c;margin-bottom:16px">
         <b>Falta OPENAI_API_KEY</b>: agrégala en tu plataforma (Environment) y redeploy. El QR igualmente puede mostrarse.
       </div>`;

  const status = waReady
    ? "✅ Conectado"
    : currentQR
    ? "⌛ Escanea el QR"
    : "⏳ Iniciando...";

  const qrImg = currentQR
    ? `<img alt="QR" src="/qr.svg" style="max-width:320px;width:100%;height:auto;"/>`
    : "<p>No hay QR disponible todavía.</p>";

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(`<!doctype html>
  <html><head><meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>WhatsApp Bot</title>
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu;max-width:720px;margin:40px auto;padding:0 16px}
    .card{border:1px solid #eee;border-radius:16px;padding:24px;box-shadow:0 4px 20px rgba(0,0,0,.04)}
    h1{font-size:22px;margin:0 0 12px}
    input,textarea{width:100%;padding:10px;border:1px solid #ddd;border-radius:8px}
    button{padding:10px 14px;border:0;border-radius:8px;background:#6d28d9;color:#fff;cursor:pointer}
    button:disabled{opacity:.6;cursor:not-allowed}
  </style>
  </head><body>
    <div class="card">
      ${banner}
      <h1>WhatsApp Bot + ChatGPT</h1>
      <p><b>Estado:</b> ${status}</p>
      ${qrImg}
      <p><a href="/status">/status</a></p>
      ${ADMIN_TOKEN ? `
      <hr/>
      <h3>Admin</h3>
      <form method="POST" action="/admin/prompt">
        <input type="hidden" name="token" value="${ADMIN_TOKEN}"/>
        <label>Prompt actual</label>
        <textarea name="prompt" rows="4">${behaviorPrompt}</textarea>
        <br/><br/>
        <button type="submit">Guardar prompt</button>
      </form>` : ""}
      <p style="opacity:.7">La <b>OPENAI_API_KEY</b> solo se agrega en Environment (nunca en el repo).</p>
    </div>
  </body></html>`);
});

app.get("/qr.svg", async (req, res) => {
  if (!currentQR) return res.status(404).send("QR no disponible");
  res.setHeader("Content-Type", "image/svg+xml");
  const svg = await QRCode.toString(currentQR, { type: "svg", margin: 1, width: 256 });
  res.end(svg);
});

app.get("/status", (req, res) => {
  res.json({ ready: waReady, hasQR: !!currentQR, hasAPIKey: hasAPIKey() });
});

// Admin opcional: cambiar prompt desde la web sin tocar la key
app.post("/admin/prompt", (req, res) => {
  if (!ADMIN_TOKEN) return res.status(403).json({ ok: false, error: "Admin deshabilitado" });
  const { token, prompt } = req.body || {};
  if (token !== ADMIN_TOKEN) return res.status(401).json({ ok: false, error: "Token inválido" });
  if (!prompt || !prompt.trim()) return res.status(400).json({ ok: false, error: "Prompt vacío" });
  behaviorPrompt = String(prompt).trim();
  res.json({ ok: true, prompt: behaviorPrompt });
});

const jidToPhone = (jid) => jid?.split("@")[0]?.replace(/[^0-9+]/g, "") || "";

// Fallback seguro: el bot arranca aunque no haya key; responderá un aviso cordial
async function askOpenAI(messages) {
  if (!hasAPIKey()) {
    return "⚠️ Falta configurar la OPENAI_API_KEY en Environment. Cuando la agregues y redeployes, podré responder con IA.";
  }
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({ model: OPENAI_MODEL, temperature: 0.6, messages })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI error ${res.status}: ${text}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || "";
}

async function startBot() {
  if (botStarting) return;
  botStarting = true;

  const { state, saveCreds } = await useMultiFileAuthState(
    path.join(process.cwd(), "session")
  );
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    printQRInTerminal: true,
    auth: state,
    browser: ["UNO-Bot", "Chrome", "1.2"],
    logger: { info: () => {}, warn: console.warn, error: console.error }
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      currentQR = qr;   // mostrar QR en la web
      waReady = false;
      console.clear();
      console.log("Escanea este QR en WhatsApp (Dispositivos vinculados).");
      qrcodeTerm.generate(qr, { small: true });
    }
    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      waReady = false;
      currentQR = null;
      botStarting = false;
      if (code !== DisconnectReason.loggedOut) {
        console.log("Reconectando...");
        startBot();
      } else {
        console.error("Sesión cerrada. Borra ./session para re-vincular.");
      }
    } else if (connection === "open") {
      waReady = true;
      currentQR = null;
      console.log("✅ Bot conectado a WhatsApp.");
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const m of messages) {
      try {
        const from = m.key.remoteJid;
        const msg = m.message;
        const text =
          msg?.conversation ||
          msg?.extendedTextMessage?.text ||
          msg?.imageMessage?.caption ||
          msg?.videoMessage?.caption ||
          "";
        const phone = "+" + jidToPhone(from);
        if (m.key.fromMe || !text) continue;

        if (allowedNumbers.length && !allowedNumbers.includes(phone)) {
          await sock.readMessages([m.key]).catch(() => {});
          continue;
        }

        if (text.startsWith("!prompt ")) {
          behaviorPrompt = text.slice(8).trim();
          await sock.sendMessage(from, { text: "🔧 Prompt actualizado." }, { quoted: m });
          continue;
        }
        if (text === "!prompt") {
          await sock.sendMessage(from, { text: `🧠 Prompt actual:\n${behaviorPrompt}` }, { quoted: m });
          continue;
        }
        if (text === "!ayuda") {
          await sock.sendMessage(from, { text: "Comandos: !prompt, !prompt <nuevo>, !ayuda" }, { quoted: m });
          continue;
        }

        const system = { role: "system", content: behaviorPrompt };
        const user = { role: "user", content: text };

        await sock.sendPresenceUpdate("composing", from);
        const reply = await askOpenAI([system, user]);
        await sock.sendMessage(from, { text: reply }, { quoted: m });
      } catch (e) {
        console.error("Error al procesar:", e);
      }
    }
  });
}

// Arranque
startBot().catch((e) => console.error("Fatal:", e));

app.listen(PORT, () => {
  console.log(`🌐 Web escuchando en http://localhost:${PORT}`);
});
