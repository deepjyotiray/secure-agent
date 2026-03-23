"use strict"

const { retrieveContext: retrieveLanceContext } = require("../../../rag")
const { generateResponse } = require("../../../gateway/responder")

async function retrieveContext(query = "", dbPath, vectordbPath, filter = {}) {
    return await retrieveLanceContext(query, { type: "menu" })
}

// tool handler interface — called by executor when type is "menu_rag"
async function execute(filter, context, toolConfig) {
    const query = context.rawMessage || ""
    const data  = await retrieveContext(query, toolConfig.db_path, null, filter)
    
    // Also include coupons if user asks for them
    if (query.toLowerCase().match(/coupon|discount|offer|promo/)) {
        const coupons = await retrieveLanceContext(query, { type: "coupons" })
        return await generateResponse(query, data + "\n\n" + coupons, toolConfig.system_prompt)
    }

    return await generateResponse(query, data, toolConfig.system_prompt)
}

module.exports = { retrieveContext, execute }
