"use strict"

const { complete, getFlowConfig } = require("../providers/llm")

function extractJson(text = "") {
    const match = String(text || "").match(/\{[\s\S]*\}/)
    if (!match) return null
    try { return JSON.parse(match[0]) } catch { return null }
}

function summarizeConversationState(conversationState = {}) {
    return {
        topic: conversationState.topic || null,
        selection: conversationState.selection || null,
        pending: conversationState.pending || null,
        customerProfile: conversationState.customerProfile || null,
        lastIntent: conversationState.lastIntent || null,
        lastMessage: conversationState.lastMessage || null,
        lastResponse: conversationState.lastResponse || null,
    }
}

async function planCustomerTurn({ message, conversationState, manifest, blockedReason } = {}) {
    const safeMessage = String(message || "").trim()
    if (!safeMessage) return { mode: "refuse", reason: "empty_message" }

    const prompt = `You are a planner for a customer support and ordering assistant.

Your job is to decide whether a blocked customer message can still be answered naturally from saved customer state and the active conversation, without calling any business tool.

Available outcomes:
- "respond": answer directly only if the answer is fully grounded in CUSTOMER STATE below
- "refuse": do not answer if the message is not grounded in customer state or active conversation

Rules:
- Do not invent customer facts.
- Do not use business tools here.
- Do not answer broad off-topic questions.
- You may answer naturally if the message is about the customer's own saved profile, their current active conversation, their current selection/cart context, or a clarification about what the bot already knows.
- Keep the response short and human.
- Return JSON only.

Blocked reason:
${blockedReason || "unknown"}

Allowed manifest intents for reference:
${Object.keys(manifest?.intents || {}).join(", ") || "none"}

CUSTOMER STATE:
${JSON.stringify(summarizeConversationState(conversationState), null, 2)}

Customer message:
${safeMessage}

Return exactly:
{"mode":"respond|refuse","response":"string","confidence":0,"groundedIn":"customer_profile|conversation_state|selection_state|none","reason":"short_reason"}`

    try {
        const raw = await complete(prompt, { flow: "customer", llmConfig: getFlowConfig("customer") })
        const parsed = extractJson(raw)
        if (!parsed || typeof parsed.mode !== "string") return { mode: "refuse", reason: "invalid_planner_output" }
        if (parsed.mode !== "respond") return { mode: "refuse", reason: parsed.reason || "planner_refused" }
        const response = String(parsed.response || "").trim()
        if (!response) return { mode: "refuse", reason: "empty_planner_response" }
        return {
            mode: "respond",
            response,
            confidence: Number(parsed.confidence || 0),
            groundedIn: parsed.groundedIn || "conversation_state",
            reason: parsed.reason || "planner_responded",
        }
    } catch {
        return { mode: "refuse", reason: "planner_error" }
    }
}

module.exports = {
    planCustomerTurn,
}
