"use strict"

const { retrieveContext } = require("../knowledge/rag")
const { generateResponse } = require("../gateway/responder")

async function execute(params, context, _toolConfig) {
    const query = (params && params.query) || context.rawMessage || ""
    const ragData = await retrieveContext(query)
    return await generateResponse(query, ragData)
}

module.exports = { execute }
