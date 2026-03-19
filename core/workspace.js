"use strict"

const fs = require("fs")
const path = require("path")

const ROOT_DIR = path.resolve(__dirname, "..")
const DATA_DIR = path.join(ROOT_DIR, "data")
const WORKSPACES_DIR = path.join(DATA_DIR, "workspaces")
const ACTIVE_WORKSPACE_PATH = path.join(DATA_DIR, "active-workspace.json")
const LEGACY_PROFILE_PATH = path.join(DATA_DIR, "business-profile.json")

function slugify(value = "") {
    const slug = String(value).toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "")
    return slug || "default"
}

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true })
}

function ensureWorkspaceRoot() {
    ensureDir(WORKSPACES_DIR)
}

function workspaceIdFromProfile(profile = {}) {
    return slugify(profile.workspaceId || profile.businessName || "default")
}

function workspaceRoot(workspaceId = "default") {
    ensureWorkspaceRoot()
    return path.join(WORKSPACES_DIR, slugify(workspaceId))
}

function workspacePath(workspaceId, ...parts) {
    return path.join(workspaceRoot(workspaceId), ...parts)
}

function listWorkspaceIds() {
    ensureWorkspaceRoot()
    return fs.readdirSync(WORKSPACES_DIR)
        .filter(entry => fs.statSync(path.join(WORKSPACES_DIR, entry)).isDirectory())
        .sort()
}

function getActiveWorkspace() {
    try {
        const parsed = JSON.parse(fs.readFileSync(ACTIVE_WORKSPACE_PATH, "utf8"))
        return slugify(parsed.workspaceId || "default")
    } catch {
        return "default"
    }
}

function setActiveWorkspace(workspaceId) {
    ensureDir(DATA_DIR)
    const normalized = slugify(workspaceId)
    fs.writeFileSync(ACTIVE_WORKSPACE_PATH, JSON.stringify({
        workspaceId: normalized,
        updatedAt: new Date().toISOString(),
    }, null, 2))
    return normalized
}

function ensureWorkspace(workspaceId, defaults = {}) {
    const id = slugify(workspaceId)
    ensureDir(workspaceRoot(id))
    if (defaults.profile && !fs.existsSync(workspacePath(id, "profile.json"))) {
        fs.writeFileSync(workspacePath(id, "profile.json"), JSON.stringify(defaults.profile, null, 2))
    }
    return id
}

function migrateLegacyProfile(defaultProfile = {}) {
    ensureWorkspaceRoot()
    if (!fs.existsSync(LEGACY_PROFILE_PATH)) {
        ensureWorkspace(getActiveWorkspace(), { profile: defaultProfile })
        return
    }

    const legacy = JSON.parse(fs.readFileSync(LEGACY_PROFILE_PATH, "utf8"))
    const workspaceId = workspaceIdFromProfile(legacy)
    ensureWorkspace(workspaceId, { profile: { ...defaultProfile, ...legacy, workspaceId } })
    if (!fs.existsSync(ACTIVE_WORKSPACE_PATH)) {
        setActiveWorkspace(workspaceId)
    }
}

module.exports = {
    ROOT_DIR,
    DATA_DIR,
    WORKSPACES_DIR,
    ACTIVE_WORKSPACE_PATH,
    slugify,
    workspaceIdFromProfile,
    workspaceRoot,
    workspacePath,
    listWorkspaceIds,
    getActiveWorkspace,
    setActiveWorkspace,
    ensureWorkspace,
    migrateLegacyProfile,
}
