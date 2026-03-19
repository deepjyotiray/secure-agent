async function api(url, method = "GET", body) {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (res.status === 401) {
    window.location.href = "/login"
    throw new Error("Unauthorized")
  }
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

let activeWorkspace = "default"
let generateProgressTimer = null

function withWorkspace(url) {
  const joiner = url.includes("?") ? "&" : "?"
  return `${url}${joiner}workspace=${encodeURIComponent(activeWorkspace)}`
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "default"
}

function formDataToObject(form) {
  const fd = new FormData(form)
  const data = Object.fromEntries(fd.entries())
  data.scrapeWebsite = form.elements.scrapeWebsite.checked
  return data
}

function applyProfile(form, profile) {
  for (const [key, value] of Object.entries(profile || {})) {
    const field = form.elements[key]
    if (!field) continue
    if (field.type === "checkbox") field.checked = !!value
    else field.value = value || ""
  }
}

function populateWorkspaceSelect(summary, currentWorkspace) {
  const select = document.getElementById("workspace-select")
  select.innerHTML = ""
  const workspaces = summary.workspaces && summary.workspaces.length
    ? summary.workspaces
    : [{ workspaceId: currentWorkspace || "default", businessName: currentWorkspace || "default" }]
  for (const workspace of workspaces) {
    const option = document.createElement("option")
    option.value = workspace.workspaceId
    option.textContent = workspace.businessName
      ? `${workspace.businessName} (${workspace.workspaceId})`
      : workspace.workspaceId
    if (workspace.workspaceId === currentWorkspace) option.selected = true
    select.appendChild(option)
  }
  document.getElementById("active-workspace-label").textContent = currentWorkspace || "default"
}

function fillList(id, items) {
  const el = document.getElementById(id)
  el.innerHTML = ""
  const list = items && items.length ? items : ["Nothing yet"]
  for (const item of list) {
    const li = document.createElement("li")
    li.textContent = item
    el.appendChild(li)
  }
}

function setStatus(message) {
  document.getElementById("status").textContent = message
}

function setText(id, text) {
  const el = document.getElementById(id)
  if (el) el.textContent = text
}

function setProgress(percent, label) {
  const shell = document.getElementById("generate-progress")
  shell.classList.remove("hidden")
  shell.setAttribute("aria-hidden", "false")
  document.getElementById("generate-progress-bar").style.width = `${percent}%`
  setText("generate-progress-value", `${Math.round(percent)}%`)
  if (label) setText("generate-progress-label", label)
}

function startGenerateProgress() {
  if (generateProgressTimer) clearInterval(generateProgressTimer)
  let progress = 8
  setProgress(progress, "Gathering business context…")
  generateProgressTimer = setInterval(() => {
    if (progress < 32) {
      progress += 8
      setProgress(progress, "Gathering business context…")
      return
    }
    if (progress < 62) {
      progress += 5
      setProgress(progress, "Generating manifests, FAQs, policy, and schema…")
      return
    }
    if (progress < 86) {
      progress += 2
      setProgress(progress, "Polishing the draft pack…")
    }
  }, 500)
}

function finishGenerateProgress(success = true) {
  if (generateProgressTimer) {
    clearInterval(generateProgressTimer)
    generateProgressTimer = null
  }
  setProgress(100, success ? "Draft generation complete." : "Draft generation failed.")
  window.setTimeout(() => {
    document.getElementById("generate-progress").classList.add("hidden")
    document.getElementById("generate-progress").setAttribute("aria-hidden", "true")
  }, success ? 1200 : 2200)
}

function appendChatMessage(role, text) {
  const log = document.getElementById("chat-log")
  const node = document.createElement("div")
  node.className = `chat-message ${role}`
  node.textContent = text
  log.appendChild(node)
  log.scrollTop = log.scrollHeight
}

function renderGovernance(data) {
  const roleDescription = data.rolePolicy?.description ? `\n${data.rolePolicy.description}` : ""
  const maxRisk = data.rolePolicy?.maxRisk ? `\nMax risk: ${data.rolePolicy.maxRisk}` : ""
  setText("governance-summary", `Role: ${data.role || "unknown"}${roleDescription}${maxRisk}`)

  const workerItems = Object.entries(data.workers || {}).map(([name, tools]) => `${name}: ${tools.join(", ")}`)
  fillList("governance-workers", workerItems)

  const toolItems = Object.entries(data.tools || {}).slice(0, 16).map(([name, cfg]) =>
    `${name} (${cfg.category}, ${cfg.risk}, approval: ${cfg.approval})`
  )
  fillList("governance-tools", toolItems)
}

function renderApprovals(approvals) {
  const empty = document.getElementById("approvals-empty")
  const list = document.getElementById("approvals-list")
  list.innerHTML = ""

  if (!approvals || !approvals.length) {
    empty.textContent = "No pending approvals."
    empty.style.display = "block"
    return
  }

  empty.style.display = "none"
  for (const approval of approvals) {
    const card = document.createElement("article")
    card.className = "approval-item"

    const heading = document.createElement("div")
    heading.className = "approval-head"
    heading.innerHTML = `<strong>${approval.tool}</strong><span>${approval.id}</span>`

    const body = document.createElement("div")
    body.className = "approval-body"
    body.innerHTML = `
      <p><strong>Status:</strong> ${approval.status}</p>
      <p><strong>Worker:</strong> ${approval.worker}</p>
      <p><strong>Created:</strong> ${approval.createdAt}</p>
      <p><strong>Reason:</strong> ${approval.reason || "Approval required"}</p>
      <p><strong>Task:</strong> ${approval.task}</p>
    `

    const actions = document.createElement("div")
    actions.className = "approval-actions"
    if (approval.status === "pending") {
      const approveBtn = document.createElement("button")
      approveBtn.type = "button"
      approveBtn.className = "primary small"
      approveBtn.dataset.approvalId = approval.id
      approveBtn.textContent = "Approve"
      actions.appendChild(approveBtn)
    } else {
      const approvedTag = document.createElement("span")
      approvedTag.className = "approval-tag"
      approvedTag.textContent = "Approved"
      actions.appendChild(approvedTag)
    }

    card.appendChild(heading)
    card.appendChild(body)
    card.appendChild(actions)
    list.appendChild(card)
  }
}

async function loadGovernance() {
  const data = await api(withWorkspace("/setup/governance"))
  renderGovernance(data)
}

async function loadApprovals() {
  const data = await api(withWorkspace("/setup/approvals"))
  renderApprovals(data.approvals || [])
}

async function load() {
  const form = document.getElementById("profile-form")
  const data = await api(withWorkspace("/setup/profile"))
  activeWorkspace = data.activeWorkspace || activeWorkspace
  applyProfile(form, data.profile)
  fillList("files", data.draftFiles)
  populateWorkspaceSelect(data, activeWorkspace)
  setStatus("Profile loaded. Update the fields, save, then generate your draft agent pack.")
  await loadGovernance()
  await loadApprovals()
  const log = document.getElementById("chat-log")
  log.innerHTML = ""
  appendChatMessage("agent", "Customer chat sandbox ready. Try a real customer-style question here.")
}

window.addEventListener("DOMContentLoaded", async () => {
  const form = document.getElementById("profile-form")
  document.getElementById("logout-btn").addEventListener("click", async () => {
    await api("/setup/logout", "POST", {})
    window.location.href = "/login"
  })
  await load()

  document.getElementById("workspace-apply-btn").addEventListener("click", async () => {
    const selected = document.getElementById("workspace-select").value
    const data = await api("/setup/workspace/select", "POST", { workspaceId: selected })
    activeWorkspace = data.activeWorkspace
    populateWorkspaceSelect(data, activeWorkspace)
    await load()
  })

  document.getElementById("workspace-create-btn").addEventListener("click", async () => {
    const input = document.getElementById("new-workspace-input")
    const proposed = slugify(input.value || form.elements.businessName.value || "default")
    const payload = formDataToObject(form)
    payload.workspaceId = proposed
    payload.businessName = payload.businessName || proposed
    await api("/setup/profile", "POST", payload)
    const data = await api("/setup/workspace/select", "POST", { workspaceId: proposed })
    activeWorkspace = data.activeWorkspace
    input.value = ""
    populateWorkspaceSelect(data, activeWorkspace)
    await load()
  })

  document.getElementById("refresh-governance-btn").addEventListener("click", async () => {
    await loadGovernance()
  })

  document.getElementById("refresh-approvals-btn").addEventListener("click", async () => {
    await loadApprovals()
  })

  document.getElementById("save-btn").addEventListener("click", async () => {
    setStatus("Saving profile…")
    const payload = formDataToObject(form)
    payload.workspaceId = activeWorkspace
    await api("/setup/profile", "POST", payload)
    setStatus("Profile saved locally.")
  })

  document.getElementById("generate-btn").addEventListener("click", async () => {
    setStatus("Generating draft agent pack… this can take a little while.")
    startGenerateProgress()
    const payload = formDataToObject(form)
    payload.workspaceId = activeWorkspace
    try {
      const data = await api("/setup/generate", "POST", payload)
      fillList("files", data.draftFiles)
      fillList("intents", data.intents)
      fillList("faqs", data.faqTopics)
      finishGenerateProgress(true)
      setStatus(`Draft generated for "${data.slug}".\nDomain keywords generated: ${data.keywordCount}\nReview the draft files below, then promote when ready.`)
    } catch (err) {
      finishGenerateProgress(false)
      setStatus(`Draft generation failed.\n${err.message}`)
    }
  })

  document.getElementById("promote-btn").addEventListener("click", async () => {
    setStatus("Promoting draft to live config…")
    const data = await api("/setup/promote", "POST", { workspaceId: activeWorkspace })
    fillList("files", data.files)
    setStatus(`Promoted ${data.promoted} files to live config.\nRestart the agent transport to use the new business profile.`)
  })

  document.getElementById("admin-task-form").addEventListener("submit", async event => {
    event.preventDefault()
    const task = document.getElementById("admin-task-input").value.trim()
    const mode = document.getElementById("admin-task-mode").value
    if (!task) return
    setText("admin-task-status", "Running admin task…")
    setText("admin-task-output", "Working…")
    try {
      const response = await api("/setup/admin/run", "POST", { task, mode, workspaceId: activeWorkspace })
      setText("admin-task-status", `Completed in ${response.mode} mode for workspace ${response.workspaceId}.`)
      setText("admin-task-output", response.response || "No response")
      await loadApprovals()
    } catch (err) {
      setText("admin-task-status", `Admin task failed: ${err.message}`)
      setText("admin-task-output", `Error: ${err.message}`)
    }
  })

  document.getElementById("chat-form").addEventListener("submit", async event => {
    event.preventDefault()
    const phone = document.getElementById("chat-phone").value.trim()
    const input = document.getElementById("chat-input")
    const message = input.value.trim()
    if (!phone || !message) return
    appendChatMessage("user", message)
    input.value = ""
    try {
      const data = await api("/setup/chat", "POST", { phone, message, workspaceId: activeWorkspace })
      appendChatMessage("agent", data.response || "No response")
    } catch (err) {
      appendChatMessage("agent", `Error: ${err.message}`)
    }
  })

  document.getElementById("approvals-list").addEventListener("click", async event => {
    const button = event.target.closest("button[data-approval-id]")
    if (!button) return
    const id = button.dataset.approvalId
    button.disabled = true
    button.textContent = "Approving…"
    try {
      await api("/setup/approvals/approve", "POST", { id, workspaceId: activeWorkspace })
      await loadApprovals()
      setText("admin-task-status", `Approved ${id}. Rerun the task with token ${id}.`)
    } catch (err) {
      button.disabled = false
      button.textContent = "Approve"
      setText("admin-task-status", `Approval failed: ${err.message}`)
    }
  })
})
