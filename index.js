import makeWASocket, {
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
