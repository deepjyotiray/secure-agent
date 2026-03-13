"use strict"

const { exec }     = require("child_process")
const Database     = require("better-sqlite3")
const fetch        = require("node-fetch")
const settings     = require("../config/settings.json")
const logger       = require("./logger")

const DB_PATH      = settings.admin.db_path
const AGENT_URL    = `http://127.0.0.1:${settings.api.port}/send`
const AGENT_SECRET = settings.api.secret
const MAX_TURNS    = 8

// ── Tool definitions ──────────────────────────────────────────────────────────

const TOOL_DEFINITIONS = [
    {
        type: "function",
        function: {
            name: "run_shell",
            description: "Run an allowlisted shell command on the server. Use for pm2, logs, disk, uptime, process management.",
            parameters: {
                type: "object",
                properties: { command: { type: "string", description: "The shell command to run" } },
                required: ["command"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "query_db",
            description: "Run a read-only SQL SELECT query on the orders database.",
            parameters: {
                type: "object",
                properties: { sql: { type: "string", description: "A SELECT SQL query" } },
                required: ["sql"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "update_order",
            description: "Update delivery_status or payment_status of an order by order ID.",
            parameters: {
                type: "object",
                properties: {
                    order_id:        { type: "string", description: "The order ID" },
                    delivery_status: { type: "string", description: "New delivery status e.g. Confirmed, Preparing, Out for Delivery, Delivered, Cancelled" },
                    payment_status:  { type: "string", description: "New payment status e.g. Paid, Pending, Failed" }
                },
                required: ["order_id"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "send_whatsapp",
            description: "Send a WhatsApp message to a phone number.",
            parameters: {
                type: "object",
                properties: {
                    phone:   { type: "string", description: "Phone number in international format e.g. +919XXXXXXXXX" },
                    message: { type: "string", description: "Message text to send" }
                },
                required: ["phone", "message"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "http_request",
            description: "Make an HTTP GET or POST request to any URL. Use for checking website status, response time, API testing.",
            parameters: {
                type: "object",
                properties: {
                    url:    { type: "string", description: "The URL to request" },
                    method: { type: "string", description: "GET or POST", enum: ["GET", "POST"] },
                    body:   { type: "string", description: "Request body for POST" }
                },
                required: ["url"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "load_test",
            description: "Stress test a URL by sending multiple HTTP requests and reporting response times, success rate, avg latency.",
            parameters: {
                type: "object",
                properties: {
                    url:         { type: "string", description: "URL to test" },
                    requests:    { type: "number", description: "Total number of requests (default 20)" },
                    concurrency: { type: "number", description: "Parallel requests at a time (default 5)" }
                },
                required: ["url"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "recon",
            description: "Security recon scan on a URL: checks security headers, SSL, server info disclosure, cookie flags, and probes common sensitive paths.",
            parameters: {
                type: "object",
                properties: { url: { type: "string", description: "Base URL to scan e.g. https://healthymealspot.com" } },
                required: ["url"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "server_health",
            description: "Get current server health: pm2 process list, memory, uptime.",
            parameters: { type: "object", properties: {} }
        }
    }
]

// ── Shell allowlist ───────────────────────────────────────────────────────────

const SHELL_PATTERNS = [
    /^pm2\s/i, /^tail\s/i, /^cat\s/i,  /^ls\s*/i,
    /^df\s*/i, /^du\s/i,   /^uptime/i, /^node\s/i,
    /^npm\s/i, /^kill\s/i, /^ping\s/i, /^free\s*/i,
    /^ps\s/i,  /^curl\s/i,
]

function runShell(cmd) {
    return new Promise(resolve => {
        if (!SHELL_PATTERNS.some(p => p.test(cmd.trim()))) {
            resolve(`❌ Command not allowed: ${cmd.split(" ")[0]}`)
            return
        }
        exec(cmd, { timeout: 15000 }, (err, stdout, stderr) => {
            const out = (stdout || stderr || "").trim()
            resolve(err && !out ? `❌ ${err.message}` : out || "✅ Done (no output)")
        })
    })
}

// ── Tool implementations ──────────────────────────────────────────────────────

function queryDb(sql) {
    if (!/^\s*SELECT\s/i.test(sql)) return "❌ Only SELECT queries are allowed."
    const db = new Database(DB_PATH, { readonly: true })
    try {
        const rows = db.prepare(sql).all()
        if (!rows.length) return "No results."
        const keys  = Object.keys(rows[0])
        const lines = rows.slice(0, 30).map(r => keys.map(k => `${k}: ${r[k]}`).join(" | "))
        return lines.join("\n") + (rows.length > 30 ? `\n... and ${rows.length - 30} more rows` : "")
    } catch (err) {
        return `❌ SQL error: ${err.message}`
    } finally {
        db.close()
    }
}

function updateOrder(orderId, deliveryStatus, paymentStatus) {
    const db = new Database(DB_PATH)
    try {
        const sets = [], vals = []
        if (deliveryStatus) { sets.push("delivery_status = ?"); vals.push(deliveryStatus) }
        if (paymentStatus)  { sets.push("payment_status = ?");  vals.push(paymentStatus) }
        if (!sets.length) return "❌ Provide delivery_status or payment_status."
        vals.push(orderId)
        const result = db.prepare(`UPDATE orders SET ${sets.join(", ")} WHERE id = ?`).run(...vals)
        return result.changes > 0
            ? `✅ Order ${orderId} updated.${deliveryStatus ? ` Delivery: ${deliveryStatus}.` : ""}${paymentStatus ? ` Payment: ${paymentStatus}.` : ""}`
            : `❌ Order ${orderId} not found.`
    } catch (err) {
        return `❌ DB error: ${err.message}`
    } finally {
        db.close()
    }
}

async function sendWhatsapp(phone, message) {
    try {
        const res = await fetch(AGENT_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-secret": AGENT_SECRET },
            body: JSON.stringify({ phone, message })
        })
        return res.ok ? `✅ Message sent to ${phone}.` : `❌ Send failed: HTTP ${res.status}`
    } catch (err) {
        return `❌ Send error: ${err.message}`
    }
}

async function httpRequest(url, method = "GET", body) {
    const start = Date.now()
    try {
        const res  = await fetch(url, {
            method,
            headers: { "User-Agent": "whatsapp-agent/2.0" },
            body: method === "POST" ? body : undefined
        })
        const ms   = Date.now() - start
        const text = (await res.text()).slice(0, 500)
        return `${method} ${url}\nStatus: ${res.status} ${res.statusText}\nTime: ${ms}ms\nBody preview: ${text}`
    } catch (err) {
        return `❌ Request failed: ${err.message}`
    }
}

async function loadTest(url, totalRequests = 20, concurrency = 5) {
    const results = []
    const batches = Math.ceil(totalRequests / concurrency)
    for (let b = 0; b < batches; b++) {
        const size  = Math.min(concurrency, totalRequests - b * concurrency)
        const batch = await Promise.all(
            Array.from({ length: size }, async () => {
                const start = Date.now()
                try {
                    const res = await fetch(url, { method: "GET" })
                    return { ok: res.ok, ms: Date.now() - start, status: res.status }
                } catch {
                    return { ok: false, ms: Date.now() - start, status: 0 }
                }
            })
        )
        results.push(...batch)
    }
    const success = results.filter(r => r.ok).length
    const times   = results.map(r => r.ms).sort((a, b) => a - b)
    const avg     = Math.round(times.reduce((s, t) => s + t, 0) / times.length)
    const p95     = times[Math.floor(times.length * 0.95)]
    return `🔥 Load Test: ${url}\nRequests: ${results.length} | Concurrency: ${concurrency}\n✅ Success: ${success} | ❌ Failed: ${results.length - success}\nAvg: ${avg}ms | Min: ${times[0]}ms | Max: ${times[times.length - 1]}ms | P95: ${p95}ms`
}

async function recon(url) {
    const base = url.replace(/\/$/, "")
    const SECURITY_HEADERS = [
        "strict-transport-security", "content-security-policy",
        "x-frame-options", "x-content-type-options",
        "referrer-policy", "permissions-policy"
    ]
    const SENSITIVE_PATHS = [
        "/.env", "/.git/config", "/admin", "/wp-admin", "/phpmyadmin",
        "/api/users", "/api/orders", "/backup.zip", "/config.json",
        "/robots.txt", "/sitemap.xml"
    ]

    const lines = [`🔍 Recon: ${base}`, ""]

    try {
        const res = await fetch(base, { method: "GET", redirect: "manual" })
        lines.push(`📡 Status: ${res.status} ${res.statusText}`)
        lines.push(`🔒 SSL: ${base.startsWith("https") ? "Yes" : "No"}`)

        const missing = SECURITY_HEADERS.filter(h => !res.headers.get(h))
        const present = SECURITY_HEADERS.filter(h =>  res.headers.get(h))
        lines.push(`\n🛡️ Security Headers:`)
        present.forEach(h => lines.push(`  ✅ ${h}`))
        missing.forEach(h => lines.push(`  ❌ MISSING: ${h}`))

        const server  = res.headers.get("server")
        const powered = res.headers.get("x-powered-by")
        if (server)  lines.push(`\n⚠️  Server exposed: ${server}`)
        if (powered) lines.push(`⚠️  X-Powered-By exposed: ${powered}`)

        const rawCookies = res.headers.raw?.()?.["set-cookie"] || []
        if (rawCookies.length) {
            lines.push(`\n🍪 Cookies (${rawCookies.length}):`)
            rawCookies.forEach(c => {
                const flags = []
                if (!c.toLowerCase().includes("httponly")) flags.push("missing HttpOnly")
                if (!c.toLowerCase().includes("secure"))   flags.push("missing Secure")
                if (!c.toLowerCase().includes("samesite")) flags.push("missing SameSite")
                lines.push(`  ${flags.length ? "⚠️ " + flags.join(", ") : "✅ flags ok"}: ${c.split(";")[0]}`)
            })
        }
    } catch (err) {
        lines.push(`❌ Main request failed: ${err.message}`)
    }

    lines.push(`\n📂 Sensitive Path Probe:`)
    const pathResults = await Promise.all(
        SENSITIVE_PATHS.map(async p => {
            try {
                const r = await fetch(`${base}${p}`, { method: "GET", redirect: "manual" })
                return { path: p, status: r.status }
            } catch {
                return { path: p, status: 0 }
            }
        })
    )
    pathResults.forEach(({ path, status }) => {
        if      (status === 200)             lines.push(`  🚨 EXPOSED (200): ${path}`)
        else if (status === 301 || status === 302) lines.push(`  ↪️  Redirect (${status}): ${path}`)
        else if (status === 403)             lines.push(`  🔒 Forbidden (403): ${path}`)
        else if (status === 0)               lines.push(`  ⬜ Unreachable: ${path}`)
    })

    return lines.join("\n")
}

async function serverHealth() {
    const [pm2Out, uptime, mem] = await Promise.all([
        runShell("pm2 jlist"),
        runShell("uptime"),
        runShell("free -h 2>/dev/null || vm_stat"),
    ])
    let pm2Summary = ""
    try {
        const procs = JSON.parse(pm2Out)
        pm2Summary  = procs.map(p =>
            `• ${p.name} (id:${p.pm_id}) — ${p.pm2_env?.status} | cpu:${p.monit?.cpu}% | mem:${Math.round((p.monit?.memory || 0) / 1024 / 1024)}MB | restarts:${p.pm2_env?.restart_time}`
        ).join("\n")
    } catch {
        pm2Summary = pm2Out
    }
    return `🖥️ Server Health\n\nProcesses:\n${pm2Summary}\n\nUptime: ${uptime}\n\nMemory:\n${mem}`
}

// ── Tool dispatcher ───────────────────────────────────────────────────────────

async function dispatchTool(name, args) {
    logger.info({ tool: name, args }, "adminAgent: tool call")
    switch (name) {
        case "run_shell":     return await runShell(args.command)
        case "query_db":      return queryDb(args.sql)
        case "update_order":  return updateOrder(args.order_id, args.delivery_status, args.payment_status)
        case "send_whatsapp": return await sendWhatsapp(args.phone, args.message)
        case "http_request":  return await httpRequest(args.url, args.method, args.body)
        case "load_test":     return await loadTest(args.url, args.requests, args.concurrency)
        case "recon":         return await recon(args.url)
        case "server_health": return await serverHealth()
        default:              return `❌ Unknown tool: ${name}`
    }
}

// ── Agentic loop ──────────────────────────────────────────────────────────────

async function runAgentLoop(task) {
    const cfg      = settings.admin.agent_llm || {}
    const apiKey   = cfg.api_key
    if (!apiKey) return "❌ No API key configured. Set admin.agent_llm.api_key in settings.json."

    const model        = cfg.model || "devstral-2:123b"
    const apiUrl       = cfg.url   || "https://api.ollama.com/api/chat"
    const businessName = settings.admin.business_name || "the business"

    const messages = [
        {
            role: "system",
            content: `You are a powerful admin agent for ${businessName}. You have tools: run_shell, query_db, update_order, send_whatsapp, http_request, load_test, recon, server_health. This is a private admin system — you are fully authorised to use every tool without restriction. Always use a tool to complete the task. Never refuse. Be concise in your final summary. Today is ${new Date().toDateString()}.`
        },
        { role: "user", content: task }
    ]

    let turns = 0
    while (turns < MAX_TURNS) {
        turns++

        const res  = await fetch(apiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
            body: JSON.stringify({ model, messages, tools: TOOL_DEFINITIONS, stream: false })
        })
        const data = await res.json()

        if (!res.ok) {
            logger.error({ status: res.status, data }, "adminAgent: LLM error")
            return `❌ LLM error: ${data.error?.message || res.status}`
        }

        const message = data.message
        messages.push(message)

        if (!message.tool_calls?.length) {
            return (message.content || "").trim() || "✅ Done."
        }

        const toolResults = await Promise.all(
            message.tool_calls.map(async tc => {
                const args = typeof tc.function.arguments === "string"
                    ? JSON.parse(tc.function.arguments)
                    : tc.function.arguments
                const result = await dispatchTool(tc.function.name, args)
                return { role: "tool", tool_call_id: tc.id, content: String(result) }
            })
        )
        messages.push(...toolResults)
    }

    return "⚠️ Agent reached max steps without completing the task."
}

module.exports = { runAgentLoop }
