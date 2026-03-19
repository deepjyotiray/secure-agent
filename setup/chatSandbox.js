"use strict"

const fs = require("fs")
const path = require("path")
const yaml = require("js-yaml")

const { sanitize } = require("../gateway/sanitizer")
const { routeCustomerMessage } = require("../gateway/customerRouter")
const executor = require("../runtime/executor")
const businessChatTool = require("../tools/businessChatTool")
const { getHistory, addTurn, getLastAgent } = require("../runtime/sessionMemory")
const { getActiveWorkspace } = require("../core/workspace")

function slugify(name = "") {
    return String(name).toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "")
}

function resolveDraftManifest(profile = {}) {
    const workspaceId = profile.workspaceId || getActiveWorkspace()
    const draftDir = path.resolve(__dirname, "..", "draft", "workspaces", workspaceId, "agents")
    const preferred = profile.businessName ? path.join(draftDir, `${slugify(profile.businessName)}.yml`) : null
    if (preferred && fs.existsSync(preferred)) return preferred
    if (!fs.existsSync(draftDir)) return null
    const files = fs.readdirSync(draftDir)
        .filter(name => name.endsWith(".yml"))
        .sort()
    return files.length ? path.join(draftDir, files[0]) : null
}

function fallbackBusinessReply(profile, manifest, message, context) {
    return businessChatTool.execute({}, context, {
        business_name: profile.businessName || manifest.agent?.name || "this business",
        cuisine: profile.businessType || "business services",
        tone: profile.brandVoice || "warm, helpful, and business-aware",
        greeting: profile.brandTagline || manifest.agent?.greet_message || `Welcome to ${profile.businessName || "our business"}.`,
        signature_line: "I can still help with general questions while deeper data is being configured.",
    })
}

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]

function normalizeName(text = "") {
    return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim()
}

function parseDoctorSchedules(rawText = "") {
    const lines = String(rawText).split("\n").map(line => line.trim()).filter(Boolean)
    const doctors = []
    let current = null

    for (const line of lines) {
        const header = line.match(/^\d+\.\s*(dr\.?\s+[^-:]+)\s*[-:]\s*(.+)$/i) || line.match(/^(dr\.?\s+[^-:]+)\s*[-:]\s*(.+)$/i)
        if (header) {
            current = { name: header[1].trim(), specialty: header[2].trim(), days: {} }
            doctors.push(current)
            continue
        }

        const dayMatch = line.match(/^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s*:\s*(.+)$/i)
        if (dayMatch && current) {
            current.days[dayMatch[1].toLowerCase()] = dayMatch[2].trim()
        }
    }

    return doctors
}

function detectRequestedDay(message) {
    const lower = message.toLowerCase()
    return DAYS.find(day => lower.includes(day)) || null
}

function detectRequestedTime(message) {
    const match = String(message).toLowerCase().match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/)
    if (!match) return null
    let hour = Number(match[1])
    const minute = Number(match[2] || 0)
    const meridiem = match[3]
    if (meridiem === "pm" && hour !== 12) hour += 12
    if (meridiem === "am" && hour === 12) hour = 0
    return { hour, minute, label: match[0] }
}

function nextWeekdayName(message) {
    const lower = String(message).toLowerCase()
    if (lower.includes("tomorrow")) {
        const now = new Date()
        return DAYS[(now.getDay() + 1) % 7]
    }
    if (lower.includes("today")) {
        const now = new Date()
        return DAYS[now.getDay()]
    }
    return detectRequestedDay(message)
}

function parseTimeRange(text = "") {
    const match = text.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM|am|pm)\s*-\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM|am|pm)/)
    if (!match) return null
    function toMinutes(hourRaw, minuteRaw, meridiem) {
        let hour = Number(hourRaw)
        const minute = Number(minuteRaw || 0)
        const lower = String(meridiem).toLowerCase()
        if (lower === "pm" && hour !== 12) hour += 12
        if (lower === "am" && hour === 12) hour = 0
        return hour * 60 + minute
    }
    return {
        start: toMinutes(match[1], match[2], match[3]),
        end: toMinutes(match[4], match[5], match[6]),
    }
}

function detectDoctorIntent(message) {
    return /(doctor|dr\.|appointment|available|availability|cardiologist|physician|specialist|clinic)/i.test(message)
}

function selectDoctor(doctors, message) {
    const lower = normalizeName(message)
    let best = null
    let bestScore = 0

    for (const doctor of doctors) {
        const haystack = normalizeName(`${doctor.name} ${doctor.specialty}`)
        let score = 0
        for (const token of lower.split(" ")) {
            if (token.length < 3) continue
            if (haystack.includes(token)) score += 1
        }
        if (score > bestScore) {
            bestScore = score
            best = doctor
        }
    }

    return bestScore > 0 ? best : null
}

function answerDoctorAvailability(profile, message) {
    if (!detectDoctorIntent(message)) return null

    const doctors = parseDoctorSchedules([
        profile.offerings,
        profile.catalogNotes,
        profile.faqSeed,
        profile.description,
    ].filter(Boolean).join("\n"))

    if (!doctors.length) return null

    const requestedDay = detectRequestedDay(message)
    const doctor = selectDoctor(doctors, message)

    if (doctor && requestedDay) {
        const slot = doctor.days[requestedDay]
        if (!slot || /^off$/i.test(slot)) {
            return `${doctor.name} (${doctor.specialty}) is not available on ${requestedDay[0].toUpperCase() + requestedDay.slice(1)}.`
        }
        return `${doctor.name} (${doctor.specialty}) is available on ${requestedDay[0].toUpperCase() + requestedDay.slice(1)}: ${slot}.`
    }

    if (doctor) {
        const schedule = DAYS
            .filter(day => doctor.days[day])
            .map(day => `${day[0].toUpperCase() + day.slice(1)}: ${doctor.days[day]}`)
            .join("\n")
        return `${doctor.name} (${doctor.specialty}) is available at:\n${schedule}`
    }

    if (requestedDay) {
        const available = doctors
            .filter(doc => doc.days[requestedDay] && !/^off$/i.test(doc.days[requestedDay]))
            .map(doc => `${doc.name} (${doc.specialty}) - ${doc.days[requestedDay]}`)
        if (!available.length) {
            return `No doctors are listed as available on ${requestedDay[0].toUpperCase() + requestedDay.slice(1)}.`
        }
        return `Doctors available on ${requestedDay[0].toUpperCase() + requestedDay.slice(1)}:\n${available.join("\n")}`
    }

    return `Here are the doctors currently configured:\n${doctors.map(doc => `${doc.name} (${doc.specialty})`).join("\n")}\n\nAsk me about a specific doctor or a day to check availability.`
}

function buildGroundedContext(profile, message) {
    const requestedDay = nextWeekdayName(message)
    const requestedTime = detectRequestedTime(message)
    const doctors = parseDoctorSchedules([
        profile.offerings,
        profile.catalogNotes,
        profile.faqSeed,
        profile.description,
    ].filter(Boolean).join("\n"))

    const selectedDoctor = selectDoctor(doctors, message)
    const lines = [
        `Current date: ${new Date().toDateString()}`,
        `Business type: ${profile.businessType || "not provided"}`,
        `Business hours: ${profile.businessHours || "not provided"}`,
        `Offerings summary: ${profile.offerings || "not provided"}`,
        `Scheduling notes: ${profile.bookingFlow || "not provided"}`,
        `Requested day: ${requestedDay || "not clearly specified"}`,
        `Requested time: ${requestedTime ? requestedTime.label : "not clearly specified"}`,
        `Selected doctor: ${selectedDoctor ? `${selectedDoctor.name} (${selectedDoctor.specialty})` : "not clearly identified"}`,
    ]

    if (selectedDoctor && requestedDay) {
        const slotText = selectedDoctor.days[requestedDay] || "not available"
        lines.push(`Doctor schedule for ${requestedDay}: ${slotText}`)
        const range = parseTimeRange(slotText)
        if (requestedTime && range) {
            const requestedMinutes = requestedTime.hour * 60 + requestedTime.minute
            lines.push(`Requested time is ${requestedMinutes >= range.start && requestedMinutes <= range.end ? "inside" : "outside"} the scheduled range.`)
        }
    }

    if (doctors.length) {
        lines.push("Structured doctor schedule:")
        for (const doctor of doctors) {
            lines.push(`${doctor.name} (${doctor.specialty})`)
            for (const day of DAYS) {
                if (doctor.days[day]) lines.push(`- ${day}: ${doctor.days[day]}`)
            }
        }
    }

    lines.push("Use only this grounded context plus the user's message. If the requested slot is outside the schedule, say so clearly and offer the nearest valid time instead of pretending it is available.")
    return lines.join("\n")
}

async function chatWithDraft(profile, message, phone) {
    const manifestPath = resolveDraftManifest(profile)
    if (!manifestPath) return null

    const sanity = sanitize(message)
    if (!sanity.safe) return "Your message could not be processed."

    const manifest = yaml.load(fs.readFileSync(manifestPath, "utf8"))
    const history = getHistory(phone)
    const lastAgent = getLastAgent(phone)
    let routed = await routeCustomerMessage(message, manifest)
    const shortFollowUp = message.trim().split(/\s+/).length <= 4
    if (shortFollowUp && lastAgent && manifest.intents?.general_chat && routed.intent === "greet") {
        routed = { intent: "general_chat", filter: { query: message.trim().toLowerCase() } }
    }
    const intent = manifest.intents?.[routed.intent] ? routed.intent : (manifest.intents?.general_chat ? "general_chat" : Object.keys(manifest.intents || {})[0])
    if (!intent) return manifest.agent?.error_message || "Something went wrong. Please try again."
    const context = {
        phone,
        rawMessage: message,
        history,
        extraContext: buildGroundedContext(profile, message),
    }
    const toolName = manifest.intents?.[intent]?.tool
    const toolConfig = manifest.tools?.[toolName] || {}

    if (toolConfig.type === "static") {
        const response = /help/i.test(intent)
            ? manifest.agent?.help_message || "I can help with common customer questions."
            : await fallbackBusinessReply(profile, manifest, message, context)
        addTurn(phone, message, response, manifest.agent?.name || intent)
        return response
    }

    try {
        const response = await executor.execute(manifest, { intent, filter: routed.filter || {} }, context)
        addTurn(phone, message, response, manifest.agent?.name || intent)
        return response
    } catch (err) {
        const text = String(err?.message || err)
        if (/unable to open database file|SQLITE_CANTOPEN|unknown tool type|no such table/i.test(text)) {
            const response = await fallbackBusinessReply(profile, manifest, message, context)
            addTurn(phone, message, response, manifest.agent?.name || intent)
            return response
        }
        const response = await fallbackBusinessReply(profile, manifest, message, context)
        addTurn(phone, message, response, manifest.agent?.name || intent)
        return response
    }
}

module.exports = { chatWithDraft, resolveDraftManifest }
