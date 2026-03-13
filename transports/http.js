"use strict"

const http     = require("http")
const agentChain = require("../runtime/agentChain")
const settings = require("../config/settings.json")
const logger   = require("../gateway/logger")

const PORT   = settings.transports?.http?.port || 3010
const SECRET = settings.api.secret

function readBody(req) {
    return new Promise((resolve, reject) => {
        let body = ""
        req.on("data", chunk => { body += chunk })
        req.on("end", () => {
            try { resolve(JSON.parse(body)) } catch { reject(new Error("invalid_json")) }
        })
    })
}

const server = http.createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json")

    // GET /health
    if (req.method === "GET" && req.url === "/health") {
        res.writeHead(200).end(JSON.stringify(agentChain.healthCheck()))
        return
    }

    // GET /capabilities
    if (req.method === "GET" && req.url === "/capabilities") {
        res.writeHead(200).end(JSON.stringify(agentChain.getCapabilities()))
        return
    }

    // POST /message  { phone, message }
    if (req.method === "POST" && req.url === "/message") {
        if (req.headers["x-secret"] !== SECRET) {
            res.writeHead(401).end(JSON.stringify({ error: "unauthorized" }))
            return
        }
        try {
            const { phone, message } = await readBody(req)
            if (!phone || !message) {
                res.writeHead(400).end(JSON.stringify({ error: "phone and message required" }))
                return
            }
            const response = await agentChain.execute(message, phone)
            res.writeHead(200).end(JSON.stringify({ response }))
        } catch (err) {
            logger.error({ err }, "http transport: error")
            res.writeHead(500).end(JSON.stringify({ error: err.message }))
        }
        return
    }

    res.writeHead(404).end(JSON.stringify({ error: "not_found" }))
})

function start() {
    server.listen(PORT, "127.0.0.1", () => {
        logger.info({ port: PORT }, "http transport listening")
    })
}

module.exports = { start }
