/**
 * MIR AI — Netlify Function: AI Proxy
 * Proxies requests to OpenAI-compatible API securely.
 * If no API key is configured, returns a graceful fallback instruction.
 */
export async function handler(event) {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  }

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" }
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) }
  }

  const apiKey = process.env.OPENAI_API_KEY
  const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "")
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini"

  let body
  try { body = JSON.parse(event.body || "{}") } catch { body = {} }

  const { messages = [], stream = false, systemPrompt } = body
  if (!messages.length) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "messages required" }) }
  }

  if (!apiKey) {
    // No key configured — tell frontend to use local intelligent fallback
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        fallback: true,
        message: "No API key configured — using local MIR AI engine. Set OPENAI_API_KEY in Netlify environment variables for cloud model.",
        model: "mir-local"
      })
    }
  }

  // Build full messages with MIR AI identity
  const system = systemPrompt || `You are MIR AI, a premium personal AI assistant developed by Musonera Irahari Junior, popularly known as Mir Junior, a young software developer based in Rwanda who builds scalable, SEO-optimized web apps and specializes in DevOps. Studies at King David Academy, founder of Mir Collection tech community, 40+ projects, tech stack React/Next.js/Node.js/Python/Docker/Kubernetes, AWS Certified Cloud Practitioner and Meta Frontend certification. Portfolio: https://mirjunior.netlify.app/. You are MIR AI — not Jarvis. Be helpful, concise, premium. When asked who created you, answer: "I was developed by Musonera Irahari Junior, popularly known as Mir Junior, a young software developer based in Rwanda." Do not claim to personally know creator. Do not start every answer with developer credit.`

  const payload = {
    model,
    messages: [{ role: "system", content: system }, ...messages],
    temperature: 0.7,
    max_tokens: 1200,
    stream: !!stream
  }

  try {
    if (stream) {
      // For simplicity, non-stream pass-through; frontend handles streaming emulation
    }
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    })
    const data = await resp.json()
    if (!resp.ok) {
      return { statusCode: resp.status, headers, body: JSON.stringify({ error: data.error?.message || "Upstream error", fallback: true }) }
    }
    const content = data.choices?.[0]?.message?.content || ""
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ content, model, usage: data.usage })
    }
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message, fallback: true }) }
  }
}
