"use strict"

const fs = require("fs")
const path = require("path")
const { workspacePath, getActiveWorkspace } = require("../core/workspace")

function storePath(workspaceId = getActiveWorkspace()) {
    return workspacePath(workspaceId, "tmp", "admin-approvals.json")
}

function ensureStore(workspaceId) {
    const target = storePath(workspaceId)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    if (!fs.existsSync(target)) {
        fs.writeFileSync(target, JSON.stringify({ approvals: [] }, null, 2))
    }
}

function readStore(workspaceId = getActiveWorkspace()) {
    ensureStore(workspaceId)
    try {
        return JSON.parse(fs.readFileSync(storePath(workspaceId), "utf8"))
    } catch {
        return { approvals: [] }
    }
}

function writeStore(store, workspaceId = getActiveWorkspace()) {
    ensureStore(workspaceId)
    fs.writeFileSync(storePath(workspaceId), JSON.stringify(store, null, 2))
}

function normalizeText(text = "") {
    return String(text).toLowerCase().replace(/\s+/g, " ").trim()
}

function matchApproval(approval, tool, task) {
    return approval.tool === tool && normalizeText(approval.task) === normalizeText(task)
}

function createApprovalRequest({ taskId, tool, task, worker, role, reason, workspaceId = getActiveWorkspace() }) {
    const store = readStore(workspaceId)
    const existing = store.approvals.find(a => a.status === "pending" && matchApproval(a, tool, task))
    if (existing) return existing
    const approval = {
        id: `apr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        createdAt: new Date().toISOString(),
        status: "pending",
        taskId,
        tool,
        task,
        worker,
        role,
        workspaceId,
        reason,
        approvedAt: null,
    }
    store.approvals.push(approval)
    writeStore(store, workspaceId)
    return approval
}

function approveRequest(id, workspaceId = getActiveWorkspace()) {
    const store = readStore(workspaceId)
    const approval = store.approvals.find(a => a.id === id)
    if (!approval) return null
    approval.status = "approved"
    approval.approvedAt = new Date().toISOString()
    writeStore(store, workspaceId)
    return approval
}

function listApprovals(status = "pending", workspaceId = getActiveWorkspace()) {
    const store = readStore(workspaceId)
    return store.approvals.filter(a => !status || a.status === status)
}

function hasGrantedApproval(id, tool, task, workspaceId = getActiveWorkspace()) {
    if (!id) return false
    const store = readStore(workspaceId)
    return store.approvals.some(a => a.id === id && a.status === "approved" && matchApproval(a, tool, task))
}

module.exports = {
    createApprovalRequest,
    approveRequest,
    listApprovals,
    hasGrantedApproval,
}
