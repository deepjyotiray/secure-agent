"use strict"

const fs   = require("fs")
const path = require("path")

const PACKS_DIR = path.resolve(__dirname, "..", "domain-packs")

// cache: packName → loaded module
const _cache = new Map()

const REQUIRED_EXPORTS = ["name", "domain", "toolTypes"]

function _validatePack(pack, packName) {
    const missing = REQUIRED_EXPORTS.filter(k => pack[k] === undefined)
    if (missing.length) {
        throw new Error(`domain-pack "${packName}" missing required exports: ${missing.join(", ")}`)
    }
    if (typeof pack.toolTypes !== "object" || pack.toolTypes === null) {
        throw new Error(`domain-pack "${packName}": toolTypes must be an object`)
    }
}

function listPacks() {
    if (!fs.existsSync(PACKS_DIR)) return []
    return fs.readdirSync(PACKS_DIR)
        .filter(entry => {
            const full = path.join(PACKS_DIR, entry)
            return fs.statSync(full).isDirectory()
                && fs.existsSync(path.join(full, "index.js"))
        })
        .sort()
}

function loadPack(packName) {
    if (_cache.has(packName)) return _cache.get(packName)

    const packDir = path.join(PACKS_DIR, packName)
    const entry   = path.join(packDir, "index.js")

    if (!fs.existsSync(entry)) {
        throw new Error(`domain-pack "${packName}" not found at ${entry}`)
    }

    const pack = require(entry)
    _validatePack(pack, packName)

    _cache.set(packName, pack)
    return pack
}

function getPack(packName) {
    return _cache.get(packName) || null
}

function getPackForWorkspace(workspaceProfile) {
    const packName = workspaceProfile.domainPack
    if (!packName) return null
    return _cache.has(packName) ? _cache.get(packName) : loadPack(packName)
}

function clearCache() {
    _cache.clear()
}

module.exports = { listPacks, loadPack, getPack, getPackForWorkspace, clearCache }
