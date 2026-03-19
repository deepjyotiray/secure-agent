"use strict"

const WORKERS = {
    planner: {
        name: "planner",
        description: "Breaks a task into safe, efficient steps and decides which worker should lead each step.",
        strengths: [
            "sequencing work",
            "choosing between tools",
            "keeping the task focused",
            "identifying verification needs",
        ],
        instructions: [
            "Think in phases instead of jumping straight into tool use.",
            "Prefer the smallest safe action that produces clarity.",
            "Keep execution grounded in evidence.",
        ],
    },
    researcher: {
        name: "researcher",
        description: "Gathers facts from the database, HTTP, files, and browser sessions before changes are made.",
        strengths: [
            "database inspection",
            "reading logs and files",
            "collecting browser evidence",
            "comparing sources before concluding",
        ],
        instructions: [
            "Prefer read-only tools first.",
            "Summarize evidence clearly before handing off.",
            "Do not mutate data unless the step explicitly requires it.",
        ],
    },
    operator: {
        name: "operator",
        description: "Executes operational actions such as shell commands, browser actions, WhatsApp sends, and controlled system changes.",
        strengths: [
            "running operational commands",
            "using browser automation",
            "sending messages",
            "performing verified changes",
        ],
        instructions: [
            "Act carefully and verify after each change.",
            "Use the simplest operational tool that can finish the step.",
            "Report side effects clearly.",
        ],
    },
    coder: {
        name: "coder",
        description: "Writes or edits scripts/files, installs packages, and runs code when the task truly needs implementation work.",
        strengths: [
            "writing scripts",
            "patching files",
            "installing dependencies",
            "debugging code execution",
        ],
        instructions: [
            "Reuse existing scripts before writing new ones.",
            "Keep edits small and targeted.",
            "Verify code changes by running the relevant command.",
        ],
    },
}

function getWorker(name) {
    return WORKERS[name] || WORKERS.operator
}

function listWorkers() {
    return Object.values(WORKERS)
}

module.exports = { WORKERS, getWorker, listWorkers }
