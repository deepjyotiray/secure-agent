"use strict"

const http = require("http")

/**
 * Execute the mlx_lm.generate via the persistent server.
 * @param {string} prompt
 * @param {Object} config
 * @returns {Promise<string>}
 */
async function complete(prompt, config) {
    const maxTokens = config.max_tokens || 1000
    const port = process.env.MLX_PORT || 5001
    
    const postData = JSON.stringify({
        prompt: prompt,
        max_tokens: maxTokens,
        temp: 0.7,
        stop: config.stop || []
    })
    
    const startTime = Date.now()
    
    return new Promise((resolve, reject) => {
        const req = http.request({
            hostname: '127.0.0.1',
            port: port,
            path: '/generate',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            },
            timeout: 120000 // 120s timeout
        }, (res) => {
            let data = ''
            res.on('data', (chunk) => { data += chunk })
            res.on('end', () => {
                const duration = Date.now() - startTime
                try {
                    const json = JSON.parse(data)
                    if (json.error) {
                        console.error("MLX Server Error:", json.error)
                        resolve("")
                    } else {
                        const result = (json.response || "").trim()
                        console.log(`MLX: ${prompt.length} chars -> ${result.length} chars in ${duration}ms`)
                        resolve(result)
                    }
                } catch (e) {
                    console.error("MLX Response Parse Error:", e.message)
                    resolve("")
                }
            })
        })
        
        req.on('error', (e) => {
            console.error("MLX Request Error (is the server running?):", e.message)
            resolve("")
        })
        
        req.on('timeout', () => {
            req.destroy()
            console.error("MLX Request Timeout")
            resolve("")
        })
        
        req.write(postData)
        req.end()
    })
}

module.exports = { complete }
