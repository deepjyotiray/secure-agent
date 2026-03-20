"use strict"

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers, downloadMediaMessage } = require("@whiskeysockets/baileys")
const P      = require("pino")
const fs     = require("fs")
const path   = require("path")
const os     = require("os")
const settings = require("../config/settings.json")
const qrcode   = require("qrcode-terminal")
const agentChain = require("../runtime/agentChain")
const { setSock, setConnected } = require("../transport/api")
const debugInterceptor = require("../runtime/debugInterceptor")
const logger   = require("../gateway/logger")

function resolveJid(jid) {
    if (!jid || !jid.endsWith("@lid")) return jid
    const lid     = jid.replace(/@.*$/, "")
    const mapFile = path.resolve("auth", `lid-mapping-${lid}_reverse.json`)
    try {
        const phone = JSON.parse(fs.readFileSync(mapFile, "utf8"))
        return phone + "@s.whatsapp.net"
    } catch { return jid }
}

async function start() {
    const { state, saveCreds } = await useMultiFileAuthState("auth")
    const { version }          = await fetchLatestBaileysVersion()

    const sock = makeWASocket({
        version,
        auth: state,
        logger: P({ level: "silent" }),
        browser: Browsers.macOS("Desktop"),
        markOnlineOnConnect: true
    })

    setSock(sock)

    sock.ev.on("creds.update", saveCreds)

    sock.ev.on("connection.update", ({ connection, qr, lastDisconnect }) => {
        if (qr) {
            console.log("\nScan this QR with WhatsApp\n")
            qrcode.generate(qr, { small: true })
        }
        if (connection === "open") {
            setConnected(true)
            logger.info("WhatsApp connected")
        }
        if (connection === "close") {
            setConnected(false)
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut
            logger.info({ shouldReconnect }, "Connection closed")
            if (shouldReconnect) start()
        }
    })

    sock.ev.on("messages.upsert", async ({ messages }) => {
        const msg = messages[0]
        if (!msg.message || msg.key.fromMe) return

        const rawJid = msg.key.remoteJid
        const phone  = resolveJid(rawJid)

        // Image handling
        if (msg.message.imageMessage) {
            const { isAdmin: senderIsAdmin, parseAdminMessage: _p, handleAdmin: _h, handleAdminImage } = require("../gateway/admin")
            if (senderIsAdmin(phone)) {
                logger.info({ phone }, "admin image — routing to admin image handler")
                try {
                    const stream  = await downloadMediaMessage(msg, "buffer", {})
                    const b64     = stream.toString("base64")
                    const caption = msg.message.imageMessage.caption || ""
                    const reply   = await handleAdminImage(b64, caption)
                    if (reply) await sock.sendMessage(rawJid, { text: reply })
                } catch (err) {
                    logger.error({ err }, "admin image handling failed")
                    await sock.sendMessage(rawJid, { text: `❌ Image processing failed: ${err.message}` })
                }
                return
            }
            // Non-admin image — forward to payment-watcher
            logger.info({ phone }, "inbound image — forwarding to payment-watcher")
            try {
                const stream  = await downloadMediaMessage(msg, "buffer", {})
                const tmpPath = path.join(os.tmpdir(), `payment-${Date.now()}.jpg`)
                fs.writeFileSync(tmpPath, stream)
                await fetch("http://127.0.0.1:3002/payment", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "x-secret": settings.api.secret },
                    body: JSON.stringify({ phone: phone.replace(/@.*$/, ""), imagePath: tmpPath })
                })
            } catch (err) {
                logger.error({ err }, "payment forward failed")
            }
            return
        }

        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || null
        if (!text) return

        logger.info({ phone, rawJid, text }, "inbound message")

        // debug interceptor — hold message if enabled
        const held = await debugInterceptor.intercept(text, phone, rawJid, sock)
        if (held) return // message is held for UI approval

        const response = await agentChain.execute(text, phone)
        if (response) await sock.sendMessage(rawJid, { text: response })
    })
}

module.exports = { start }
