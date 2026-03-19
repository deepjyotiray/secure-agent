async function login(username, password) {
  const res = await fetch("/setup/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

function setStatus(message) {
  document.getElementById("login-status").textContent = message
}

window.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("login-form")
  form.addEventListener("submit", async event => {
    event.preventDefault()
    const username = form.elements.username.value.trim()
    const password = form.elements.password.value
    setStatus("Signing in…")
    try {
      await login(username, password)
      window.location.href = "/"
    } catch (err) {
      setStatus(err.message === "invalid_credentials" ? "Incorrect username or password." : `Sign-in failed: ${err.message}`)
    }
  })
})
