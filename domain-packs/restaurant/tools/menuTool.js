"use strict"

const { retrieveContext } = require("./menuRag")
const { generateResponse } = require("../../../gateway/responder")

async function execute(params, context) {
    const query = (params && params.query) || context.rawMessage || ""
    const ragData = await retrieveContext(query)
    return await generateResponse(query, ragData)
}

module.exports = { execute }
