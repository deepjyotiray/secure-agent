"use strict"

const fs = require("fs")
const path = require("path")
const { workspacePath, getActiveWorkspace } = require("../core/workspace")

function taskDir(workspaceId = getActiveWorkspace()) {
    return workspacePath(workspaceId, "tmp", "admin-tasks")
}

function ensureTaskDir(workspaceId) {
    fs.mkdirSync(taskDir(workspaceId), { recursive: true })
}

function taskFile(taskId, workspaceId = getActiveWorkspace()) {
    ensureTaskDir(workspaceId)
    return path.join(taskDir(workspaceId), `${taskId}.json`)
}

function createTaskState(task, meta = {}, workspaceId = getActiveWorkspace()) {
    const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const state = {
        taskId,
        createdAt: new Date().toISOString(),
        task,
        meta,
        workspaceId,
        plan: [],
        toolCalls: [],
        notes: [],
        finalAnswer: null,
    }
    fs.writeFileSync(taskFile(taskId, workspaceId), JSON.stringify(state, null, 2))
    return state
}

function readTaskState(taskId, workspaceId = getActiveWorkspace()) {
    const file = taskFile(taskId, workspaceId)
    return JSON.parse(fs.readFileSync(file, "utf8"))
}

function writeTaskState(state, workspaceId = state.workspaceId || getActiveWorkspace()) {
    fs.writeFileSync(taskFile(state.taskId, workspaceId), JSON.stringify(state, null, 2))
}

function updateTaskState(taskId, updater, workspaceId = getActiveWorkspace()) {
    const state = readTaskState(taskId, workspaceId)
    const next = updater(state) || state
    writeTaskState(next, workspaceId)
    return next
}

function appendToolCall(taskId, entry, workspaceId = getActiveWorkspace()) {
    return updateTaskState(taskId, state => {
        state.toolCalls.push({
            at: new Date().toISOString(),
            ...entry,
        })
        return state
    }, workspaceId)
}

function setPlan(taskId, plan, workspaceId = getActiveWorkspace()) {
    return updateTaskState(taskId, state => {
        state.plan = Array.isArray(plan) ? plan : []
        return state
    }, workspaceId)
}

function addNote(taskId, note, workspaceId = getActiveWorkspace()) {
    return updateTaskState(taskId, state => {
        state.notes.push({
            at: new Date().toISOString(),
            note,
        })
        return state
    }, workspaceId)
}

function setFinalAnswer(taskId, finalAnswer, workspaceId = getActiveWorkspace()) {
    return updateTaskState(taskId, state => {
        state.finalAnswer = finalAnswer
        state.completedAt = new Date().toISOString()
        return state
    }, workspaceId)
}

module.exports = {
    createTaskState,
    readTaskState,
    writeTaskState,
    appendToolCall,
    setPlan,
    addNote,
    setFinalAnswer,
}
