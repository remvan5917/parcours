// Relais du coach IA : garde la clé Groq secrète (variable GROQ_API_KEY de Cloudflare)
// et n'accepte que les demandes venant de l'appli.
const ORIGINS = ["https://remvan5917.github.io"];
const MODELS = ["openai/gpt-oss-120b", "qwen/qwen3.8-27b"];
const MAX_CHARS = 24000; // taille totale maximale d'une demande

const json = (data, status, headers) => new Response(JSON.stringify(data), { status, headers: { ...headers, "Content-Type": "application/json" } });

// Agenda abonné : l'appli dépose les séances calculées dans Firestore (equipes/<code>/reglages/agenda),
// le relais les publie au format agenda (.ics). Lecture seule, protégée par le code secret d'équipe.
const FB_PROJECT = "parcours-gpx-2027";
const FB_WEB_KEY = "AIzaSyDwb_C6B_LDUCgiY_r6ljIChmZzo_9dkJ8"; // clé web Firebase (publique par nature, déjà dans config.js)
const icsEsc = t => String(t || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
function fold(line){ const enc = new TextEncoder(), out = []; let cur = "", n = 0, lim = 75; for (const ch of line){ const b = enc.encode(ch).length; if (n + b > lim){ out.push(cur); cur = " "; n = 1; lim = 75; } cur += ch; n += b; } out.push(cur); return out.join("\r\n"); }
async function agenda(team){
  const r = await fetch(`https://firestore.googleapis.com/v1/projects/${FB_PROJECT}/databases/(default)/documents/equipes/${team}/reglages/agenda?key=${FB_WEB_KEY}`);
  let data = {alarm: 30, ev: []};
  if (r.ok){ const d = await r.json(); try { data = JSON.parse(d.fields.json.stringValue); } catch (e) {} }
  const alarm = Math.min(240, Math.max(0, Number(data.alarm) || 30));
  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Athena//Entrainement//FR", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "X-WR-CALNAME:Athéna · entraînement", "X-WR-TIMEZONE:Europe/Paris", "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H"];
  (Array.isArray(data.ev) ? data.ev : []).slice(0, 600).forEach((e, i) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.d) || !/^\d{2}:\d{2}$/.test(e.h)) return;
    const [hh, mm] = e.h.split(":").map(Number), dur = Math.min(240, Number(e.dur) || 60);
    const endMin = hh * 60 + mm + dur, eh = Math.min(23, Math.floor(endMin / 60)), em = endMin >= 24 * 60 ? 59 : endMin % 60;
    const day = e.d.replace(/-/g, "");
    L.push("BEGIN:VEVENT", `UID:${day}-${e.h.replace(":", "")}-${i}-${team.slice(0, 6)}@parcours`, `DTSTAMP:${stamp}`,
      `DTSTART:${day}T${e.h.replace(":", "")}00`, `DTEND:${day}T${String(eh).padStart(2, "0")}${String(em).padStart(2, "0")}00`,
      fold("SUMMARY:" + icsEsc(e.t)), fold("DESCRIPTION:" + icsEsc(e.desc)));
    if (alarm > 0) L.push("BEGIN:VALARM", "ACTION:DISPLAY", fold("DESCRIPTION:" + icsEsc(e.t)), `TRIGGER:-PT${alarm}M`, "END:VALARM");
    L.push("END:VEVENT");
  });
  L.push("END:VCALENDAR");
  return new Response(L.join("\r\n") + "\r\n", { headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "public, max-age=900", "Access-Control-Allow-Origin": "*" } });
}

export default {
  async fetch(req, env) {
    if (req.method === "GET"){
      const m = new URL(req.url).pathname.match(/^\/agenda\/([a-z0-9]{20,40})\.ics$/);
      if (m) return agenda(m[1]);
      return new Response("Relais du coach Parcours.", { status: 404 });
    }
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
