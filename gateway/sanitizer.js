"use strict"

const MAX_LENGTH = 500

// ── Unicode / encoding normalization ──────────────────────────────────────────

function normalize(input) {
    return input
        .normalize("NFKC")                          // collapse Unicode variants (ﬁ→fi, ℯ→e, etc.)
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")  // strip control chars (keep \t \n \r)
        .replace(/[\u200B-\u200F\u2028-\u202F\uFEFF]/g, "")              // strip zero-width / invisible chars
}

// ── Pattern layers ────────────────────────────────────────────────────────────

// Layer 1: Prompt injection / jailbreak
const INJECTION_PATTERNS = [
    // Direct instruction override
    /ignore\s+(previous|above|system|all|prior|earlier|every)\s+(instructions?|prompts?|rules?|guidelines?|constraints?)/i,
    /disregard\s+(previous|above|all|prior|your)\s+(instructions?|prompts?|rules?|programming)/i,
    /forget\s+(previous|above|all|prior|your|everything)\s+(instructions?|prompts?|rules?|context)/i,
    /forget\s+(all|every(thing)?)\s+your\s+(instructions?|prompts?|rules?)/i,
    /override\s+(previous|your|all|system)\s+(instructions?|prompts?|rules?|behavior)/i,
    /system\s*(prompt|instructions?|message)/i,
    /\bDAN\b/,                                       // "Do Anything Now" jailbreak
    /\bAIM\b.*\bmachiavelli/i,                       // AIM jailbreak variant

    // Role manipulation
    /you\s+are\s+now/i,
    /act\s+as\s+(a\s+)?(different|new|another|unrestricted|evil|unfiltered|uncensored)/i,
    /pretend\s+(you\s+are|to\s+be|you're)/i,
    /roleplay\s+as/i,
    /imagine\s+you\s+are/i,
    /from\s+now\s+on\s+you/i,
    /switch\s+to\s+(a\s+)?(new|different|unrestricted)\s+(mode|persona|character)/i,
    /enter\s+(developer|god|admin|sudo|unrestricted|jailbreak)\s+mode/i,
    /enable\s+(developer|god|admin|sudo|unrestricted|jailbreak)\s+mode/i,
    /\b(developer|god|sudo|unrestricted|jailbreak)\s+mode\b/i,

    // Bypass / extraction attempts
    /\bjailbreak\b/i,
    /\bbypass\b.*\b(filter|safety|restriction|rule|guard|policy)/i,
    /reveal\s+(your|the|system)\s+(prompt|instructions?|rules?|source|config)/i,
    /show\s+me\s+(your|the)\s+(prompt|instructions?|rules?|system\s+message)/i,
    /what\s+(are|is)\s+your\s+(instructions?|rules?|system\s+prompt|programming)/i,
    /repeat\s+(your|the)\s+(system|initial|original)\s+(prompt|message|instructions?)/i,
    /output\s+(your|the)\s+(system|initial)\s+(prompt|message)/i,
    /print\s+(your|the)\s+(system|initial)\s+(prompt|message|instructions?)/i,
    /\btranslate\s+(your|the)\s+(system|initial)\s+(prompt|instructions?)/i,
]

// Layer 2: Code execution / system access
const CODE_EXEC_PATTERNS = [
    /execute\s+(command|code|script|shell|query|sql)/i,
    /run\s+(command|code|script|shell|query|sql)\b/i,
    /read\s+\/?(\.(env|git|ssh|aws|npmrc)|etc\/(passwd|shadow|hosts)|proc\/|var\/log)/i,
    /\$\(.*\)/,                                      // command substitution $(...)
    /`[^`]*`/,                                       // backtick execution
    /\beval\s*\(/i,
    /\bexec\s*\(/i,
    /\bFunction\s*\(/i,                              // Function constructor
    /\bsetTimeout\s*\(\s*['"`]/i,                    // setTimeout with string
    /\bsetInterval\s*\(\s*['"`]/i,
    /require\s*\(\s*['"](?:fs|child_process|os|net|http|path|crypto)['"]/i,
    /\bimport\s*\(\s*['"](?:fs|child_process|os|net|http)['"]/i,
    /process\.(env|exit|kill|argv)/i,
    /\b__proto__\b/,                                 // prototype pollution
    /\bconstructor\s*\[/,                            // constructor access
    /\bconstructor\.prototype/i,
]

// Layer 3: Path traversal / file access
const PATH_PATTERNS = [
    /\.\.\//,                                        // ../
    /\.\.\\/,                                        // ..\
    /\/etc\//i,
    /\/proc\//i,
    /\/dev\/(null|zero|random|sda)/i,
    /~\/\./,                                         // ~/.ssh, ~/.aws, etc.
    /\/(root|home\/\w+)\/(\.ssh|\.aws|\.env)/i,
]

// Layer 4: HTML / XSS injection
const XSS_PATTERNS = [
    /<script[\s>]/i,
    /<\/script>/i,
    /<img\b[^>]*\bon\w+\s*=/i,                      // <img onerror=...>
    /<svg\b[^>]*\bon\w+\s*=/i,                      // <svg onload=...>
    /<iframe[\s>]/i,
    /<object[\s>]/i,
    /<embed[\s>]/i,
    /<link\b[^>]*\bhref\s*=\s*['"]?javascript:/i,
    /\bjavascript\s*:/i,
    /\bdata\s*:\s*text\/html/i,
    /\bon(error|load|click|mouseover|focus|blur)\s*=/i,
]

// Layer 5: SQL injection (defense-in-depth — LLM generates SQL but user input should never contain raw SQL)
const SQL_PATTERNS = [
    /;\s*(DROP|DELETE|UPDATE|INSERT|ALTER|CREATE|TRUNCATE|EXEC)\b/i,
    /\bUNION\s+(ALL\s+)?SELECT\b/i,
    /\bOR\s+['"]?\d+['"]?\s*=\s*['"]?\d+['"]?/i,    // OR 1=1
    /\bOR\s+['"]?\w+['"]?\s*=\s*['"]?\w+['"]?/i,    // OR 'a'='a'
    /--\s*$/m,                                        // SQL comment at end of line
    /\/\*[\s\S]*?\*\//,                              // block comment /* */
    /\bSLEEP\s*\(\s*\d/i,                           // time-based injection
    /\bBENCHMARK\s*\(/i,
    /\bWAITFOR\s+DELAY\b/i,
    /\bLOAD_FILE\s*\(/i,
    /\bINTO\s+(OUT|DUMP)FILE\b/i,
]

const ALL_PATTERNS = [
    { patterns: INJECTION_PATTERNS, reason: "injection_detected" },
    { patterns: CODE_EXEC_PATTERNS, reason: "code_exec_detected" },
    { patterns: PATH_PATTERNS,      reason: "path_traversal_detected" },
    { patterns: XSS_PATTERNS,       reason: "xss_detected" },
    { patterns: SQL_PATTERNS,       reason: "sql_injection_detected" },
]

// ── Structural checks ─────────────────────────────────────────────────────────

function hasExcessiveRepetition(input) {
    // Same character repeated 20+ times
    if (/(.)\1{19,}/.test(input)) return true
    // Same word repeated 10+ times
    const words = input.toLowerCase().split(/\s+/)
    const freq = {}
    for (const w of words) {
        if (w.length < 2) continue
        freq[w] = (freq[w] || 0) + 1
        if (freq[w] >= 10) return true
    }
    return false
}

function hasEncodedPayload(input) {
    // Base64-encoded blocks that might hide payloads (40+ chars of base64)
    if (/[A-Za-z0-9+/]{40,}={0,2}/.test(input)) return true
    // Hex-encoded sequences (\x41\x42...)
    if (/(\\x[0-9a-f]{2}){4,}/i.test(input)) return true
    // Unicode escape sequences (\u0041\u0042...)
    if (/(\\u[0-9a-f]{4}){4,}/i.test(input)) return true
    return false
}

// ── Main sanitizer ────────────────────────────────────────────────────────────

function sanitize(input) {
    if (typeof input !== "string" || input.trim().length === 0) {
        return { safe: false, reason: "empty_input" }
    }

    if (input.length > MAX_LENGTH) {
        return { safe: false, reason: "input_too_long" }
    }

    const normalized = normalize(input)

    // Structural checks
    if (hasExcessiveRepetition(normalized)) {
        return { safe: false, reason: "excessive_repetition" }
    }

    if (hasEncodedPayload(normalized)) {
        return { safe: false, reason: "encoded_payload_detected" }
    }

    // Pattern matching against normalized input
    for (const layer of ALL_PATTERNS) {
        for (const pattern of layer.patterns) {
            if (pattern.test(normalized)) {
                return { safe: false, reason: layer.reason }
            }
        }
    }

    return { safe: true }
}

module.exports = { sanitize, normalize }
