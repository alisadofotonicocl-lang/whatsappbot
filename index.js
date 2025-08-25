import makeWASocket, { useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason } from "@whiskeysockets/baileys";
}


async function startBot() {
const { useMultiFileAuthState, fetchLatestBaileysVersion } = await import("@whiskeysockets/baileys");
const { state, saveCreds } = await useMultiFileAuthState(path.join(process.cwd(), "session"));
const { version } = await fetchLatestBaileysVersion();


const sock = (await import("@whiskeysockets/baileys")).default({
version,
printQRInTerminal: true,
auth: state,
browser: ["UNO-Bot", "Chrome", "1.0"],
logger: { info: () => {}, warn: console.warn, error: console.error },
});


sock.ev.on("creds.update", saveCreds);


sock.ev.on("connection.update", (update) => {
const { connection, lastDisconnect, qr } = update;
if (qr) {
currentQR = qr; // guardar QR para la página
waReady = false;
// también mostrar en la terminal
console.clear();
console.log("\nEscanea este QR con tu WhatsApp (Dispositivos vinculados):\n");
qrcodeTerm.generate(qr, { small: true });
}
if (connection === "close") {
const code = lastDisconnect?.error?.output?.statusCode;
waReady = false;
if (code !== DisconnectReason.loggedOut) startBot();
else console.error("Sesión cerrada. Borra ./session para volver a vincular.");
} else if (connection === "open") {
waReady = true;
currentQR = null; // ya no necesitamos QR
console.log("✅ Bot conectado a WhatsApp.");
}
});


sock.ev.on("messages.upsert", async ({ messages, type }) => {
if (type !== "notify") return;
for (const m of messages) {
try {
const from = m.key.remoteJid;
const msg = m.message;
const text = msg?.conversation || msg?.extendedTextMessage?.text || msg?.imageMessage?.caption || msg?.videoMessage?.caption || "";
const phone = "+" + jidToPhone(from);
if (m.key.fromMe || !text) continue;


if (allowedNumbers.length && !allowedNumbers.includes(phone)) { await sock.readMessages([m.key]).catch(()=>{}); continue; }


if (text.startsWith("!prompt ")) { behaviorPrompt = text.slice(8).trim(); await sock.sendMessage(from, { text: "🔧 Prompt actualizado." }, { quoted: m }); continue; }
if (text === "!prompt") { await sock.sendMessage(from, { text: `🧠 Prompt actual:\n\n${behaviorPrompt}` }, { quoted: m }); continue; }
if (text === "!ayuda") { await sock.sendMessage(from, { text: "Comandos: !prompt, !prompt <nuevo>, !ayuda" }, { quoted: m }); continue; }


const system = { role: "system", content: behaviorPrompt };
const user = { role: "user", content: text };


await sock.sendPresenceUpdate("composing", from);
const reply = await askOpenAI([system, user]);
await sock.sendMessage(from, { text: reply }, { quoted: m });
} catch (e) { console.error("Error al procesar:", e); }
}
});
}


startBot().catch((e) => console.error("Fatal:", e));


app.listen(PORT, () => {
console.log(`🌐 Web escuchando en http://localhost:${PORT}`);
});
