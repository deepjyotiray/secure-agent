"use strict"

const { retrieveContext: retrieveLanceContext } = require("../../../rag")
const { generateResponse } = require("../../../gateway/responder")

async function execute(params, context, toolConfig) {
    const query = context.rawMessage || ""
    const data = await retrieveLanceContext(query, { type: "policy" })

    const systemPrompt = `You are a helpful assistant for Healthy Meal Spot.
Use the following policy information to answer the customer's question.
Be concise and clear. If the answer is not in the policy, say so and refer them to the contact details.
Strictly answer based ONLY on the provided policy data.`

    return await generateResponse(query, data, systemPrompt)
}

module.exports = { execute }
