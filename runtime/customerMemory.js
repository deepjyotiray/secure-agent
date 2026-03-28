"use strict"

const fs = require("fs")
const path = require("path")

const workspace = require("../core/workspace")

const STORE_FILE = path.join("config", "customer-memory.json")

function normalizePhone(phone) {
    const digits = String(phone || "").replace(/@.*$/, "").replace(/\D/g, "")
    if (digits.length > 10) return digits.slice(-10)
    return digits
}

function memoryPath(workspaceId) {
    if (typeof workspace.workspacePath === "function") return workspace.workspacePath(workspaceId, STORE_FILE)
    return path.resolve(__dirname, "..", "data", "workspaces", String(workspaceId || "default"), STORE_FILE)
}

function loadStore(workspaceId) {
    const target = memoryPath(workspaceId)
    try {
        const parsed = JSON.parse(fs.readFileSync(target, "utf8"))
        return parsed && typeof parsed === "object" ? parsed : {}
    } catch {
        return {}
    }
}

function saveStore(workspaceId, store) {
    const target = memoryPath(workspaceId)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, JSON.stringify(store, null, 2), "utf8")
}

function createDefaultProfile(phone) {
    return {
        phone: normalizePhone(phone),
        name: null,
        preferredName: null,
        address: null,
        dietaryPreferences: [],
        notes: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    }
}

function sanitizeText(value = "", maxLength = 120) {
    return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength)
}

function mergeUnique(existing, incoming) {
    const values = [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(incoming) ? incoming : [])]
        .map(value => sanitizeText(value, 60))
        .filter(Boolean)
    return [...new Set(values)]
}

function getCustomerProfile(workspaceId, phone) {
    const key = normalizePhone(phone)
    if (!key) return createDefaultProfile(phone)
    const store = loadStore(workspaceId)
    const existing = store[key]
    if (!existing || typeof existing !== "object") return createDefaultProfile(phone)
    return { ...createDefaultProfile(phone), ...existing, phone: key }
}

function saveCustomerProfile(workspaceId, phone, patch = {}) {
    const key = normalizePhone(phone)
    if (!key) return createDefaultProfile(phone)
    const store = loadStore(workspaceId)
    const current = getCustomerProfile(workspaceId, key)
    const next = {
        ...current,
        ...patch,
        phone: key,
        dietaryPreferences: mergeUnique(current.dietaryPreferences, patch.dietaryPreferences),
        notes: mergeUnique(current.notes, patch.notes),
        updatedAt: new Date().toISOString(),
    }
    store[key] = next
    saveStore(workspaceId, store)
    return next
}

function looksLikeName(value = "") {
    const text = sanitizeText(value, 60)
    if (!text) return false
    if (text.split(/\s+/).length > 5) return false
    return /^[a-z][a-z .'-]{1,59}$/i.test(text)
}

function extractCustomerProfilePatch(message = "") {
    const text = sanitizeText(message, 220)
    const lower = text.toLowerCase()
    const patch = {}

    const preferredMatch = text.match(/\b(?:call me|you can call me)\s+([a-z][a-z .'-]{1,40})$/i)
    if (preferredMatch && looksLikeName(preferredMatch[1])) {
        patch.preferredName = sanitizeText(preferredMatch[1], 40)
    }

    const nameMatch = text.match(/\b(?:my name is|i am|i'm|im)\s+([a-z][a-z .'-]{1,50})$/i)
    if (!patch.preferredName && nameMatch && looksLikeName(nameMatch[1])) {
        patch.name = sanitizeText(nameMatch[1], 50)
    }

    const addressMatch = text.match(/\b(?:my address is|deliver to|ship to|send it to)\s+(.{8,180})$/i)
    if (addressMatch) {
        patch.address = sanitizeText(addressMatch[1], 180)
    }

    const dietaryPreferences = []
    if (/\b(i am|i'm|im|i prefer|i usually eat|my diet is|i follow)\s+(a\s+)?vegetarian\b/.test(lower) || /\b(i am|i'm|im|i prefer|my diet is)\s+veg\b/.test(lower)) dietaryPreferences.push("vegetarian")
    if (/\b(i am|i'm|im|i prefer|my diet is|i follow)\s+(a\s+)?vegan\b/.test(lower)) dietaryPreferences.push("vegan")
    if (/\b(i am|i'm|im|i prefer|my diet is|i need)\s+gluten[- ]?free\b/.test(lower)) dietaryPreferences.push("gluten-free")
    if (/\b(i am|i'm|im|i prefer|my diet is|i follow)\s+jain\b/.test(lower)) dietaryPreferences.push("jain")
    if (/\b(i prefer|please keep|i need|without)\s+no onion\b/.test(lower) || /\bwithout onion\b/.test(lower)) dietaryPreferences.push("no onion")
    if (/\b(i prefer|please keep|i need|without)\s+no garlic\b/.test(lower) || /\bwithout garlic\b/.test(lower)) dietaryPreferences.push("no garlic")
    if (dietaryPreferences.length) patch.dietaryPreferences = dietaryPreferences

    return Object.keys(patch).length ? patch : null
}

module.exports = {
    memoryPath,
    normalizePhone,
    getCustomerProfile,
    saveCustomerProfile,
    extractCustomerProfilePatch,
}
