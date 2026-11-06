// Relais du coach IA : garde la clé Groq secrète (variable GROQ_API_KEY de Cloudflare)
// et n'accepte que les demandes venant de l'appli.
const ORIGINS = ["https://remvan5917.github.io"];
const MODELS = ["openai/gpt-oss-120b", "qwen/qwen3.8-27b"];
const MAX_CHARS = 24000; // taille totale maximale d'une demande

const json = (data, status, headers) => new Response(JSON.stringify(data), { status, headers: { ...headers, "Content-Type": "application/json" } });

export default {
  async fetch(req, env) {
    const origin = req.headers.get("Origin") || "";
    const cors = {
      "Access-Control-Allow-Origin": ORIGINS.includes(origin) ? origin : ORIGINS[0],
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin",
    };
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    if (req.method !== "POST" || !ORIGINS.includes(origin)) return json({ error: { message: "interdit" } }, 403, cors);
    if (!env.GROQ_API_KEY) return json({ error: { message: "clé Groq absente du relais" } }, 500, cors);

    // limite de débit gérée par Cloudflare (partagée entre toutes les instances) : 12 demandes par minute et par adresse
    const ip = req.headers.get("CF-Connecting-IP") || "?";
    if (env.LIMITER) { const { success } = await env.LIMITER.limit({ key: ip }); if (!success) return json({ error: { message: "trop de questions" } }, 429, cors); }

    let body;
    try { body = await req.json(); } catch (e) { return json({ error: { message: "requête invalide" } }, 400, cors); }
    const model = MODELS.includes(body.model) ? body.model : MODELS[0];
    const messages = (Array.isArray(body.messages) ? body.messages : []).slice(-16).map(m => ({
      role: ["system", "user", "assistant"].includes(m.role) ? m.role : "user",
      content: String(m.content || "").slice(0, 14000),
    }));
    if (!messages.length) return json({ error: { message: "message vide" } }, 400, cors);
    if (messages.reduce((n, m) => n + m.content.length, 0) > MAX_CHARS) return json({ error: { message: "demande trop longue" } }, 413, cors);
    const out = { model, messages, temperature: 0.6, max_tokens: Math.min(Number(body.max_tokens) || 500, 1500) };
    if (model.startsWith("openai/gpt-oss")) out.reasoning_effort = "low";
    if (model.startsWith("qwen/")) out.reasoning_format = "hidden";

    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + env.GROQ_API_KEY },
      body: JSON.stringify(out),
    });
    return new Response(await r.text(), { status: r.status, headers: { ...cors, "Content-Type": "application/json" } });
  },
};
