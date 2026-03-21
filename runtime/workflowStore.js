"use strict"

const fs = require("fs")
const path = require("path")
const crypto = require("crypto")
const { validatePlan } = require("./plannerEngine")
const logger = require("../gateway/logger")

const STORE_PATH = path.resolve(__dirname, "../data/workflows.json")

function _read() {
    try {
        if (fs.existsSync(STORE_PATH)) return JSON.parse(fs.readFileSync(STORE_PATH, "utf8"))
    } catch { /* corrupt file */ }
    return { workflows: [] }
}

function _write(data) {
    fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true })
    fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), "utf8")
}

function list() {
    return _read().workflows.map(w => ({ id: w.id, name: w.name, description: w.description, steps: w.plan.length, createdAt: w.createdAt, updatedAt: w.updatedAt }))
}

function get(id) {
    return _read().workflows.find(w => w.id === id) || null
}

function save(name, description, plan, manifest) {
    if (!name) throw new Error("name required")
    if (!plan || !plan.length) throw new Error("plan required")

    const validation = validatePlan(plan, manifest)
    if (!validation.valid) throw new Error(`Invalid plan: ${validation.reason}`)

    // strip toolConfig (contains db paths etc) — will be re-resolved at runtime
    const cleanPlan = plan.map((s, i) => ({
        step: i + 1,
        intent: s.intent || null,
        tool: s.tool,
        toolType: s.toolType,
        input: s.input || {},
        reason: s.reason || "",
        risk: s.risk || null,
        dependsOn: s.dependsOn || null,
    }))

    const store = _read()
    const now = new Date().toISOString()
    const workflow = {
        id: `wf-${crypto.randomBytes(6).toString("hex")}`,
        name,
        description: description || "",
        plan: cleanPlan,
        createdAt: now,
        updatedAt: now,
    }
    store.workflows.push(workflow)
    _write(store)
    logger.info({ id: workflow.id, name, steps: cleanPlan.length }, "workflow: saved")
    return workflow
}

function remove(id) {
    const store = _read()
    const idx = store.workflows.findIndex(w => w.id === id)
    if (idx === -1) return null
    const [removed] = store.workflows.splice(idx, 1)
    _write(store)
    logger.info({ id }, "workflow: deleted")
    return removed
}

// ── Parameter injection ──────────────────────────────────────────────────────
// Replaces {{key}} placeholders in step inputs with runtime values

function injectParams(plan, params) {
    if (!params || !Object.keys(params).length) return plan
    return plan.map(step => ({
        ...step,
        input: _replaceInObj(step.input, params),
    }))
}

function _replaceInObj(obj, params) {
    if (!obj || typeof obj !== "object") return obj
    const result = {}
    for (const [k, v] of Object.entries(obj)) {
        if (typeof v === "string") {
            result[k] = v.replace(/\{\{(\w+)\}\}/g, (_, key) => params[key] !== undefined ? params[key] : `{{${key}}}`)
        } else if (typeof v === "object" && v !== null) {
            result[k] = _replaceInObj(v, params)
        } else {
            result[k] = v
        }
    }
    return result
}

module.exports = { list, get, save, remove, injectParams }
