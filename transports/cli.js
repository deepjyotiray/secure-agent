"use strict"

const readline = require("readline")
const agentChain = require("../runtime/agentChain")

async function start() {
    const caps = agentChain.getCapabilities()
    console.log(`🤖 Agent Chain — CLI Transport`)
    if (Array.isArray(caps)) {
        console.log(`   Agents: ${caps.map(a => a.agent).join(" → ")}`)
    } else {
        console.log(`   Agent: ${caps.agent || "unknown"}`)
    }
    console.log(`   Type a message, or 'exit' to quit.\n`)

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    const phone = "cli-user"

    const ask = () => {
        rl.question("You: ", async input => {
            const text = input.trim()
            if (!text || text === "exit") { rl.close(); return }
            
            // Build preview first (to populate intent cache)
            try {
                const previewEngine = require("../runtime/previewEngine")
                await previewEngine.buildPreview(text, phone)
            } catch (e) {
                // ignore preview errors in CLI
            }

            const response = await agentChain.execute(text, phone)
            console.log(`\nAgent: ${response || "(no response)"}\n`)
            ask()
        })
    }

    ask()
}

module.exports = { start }
