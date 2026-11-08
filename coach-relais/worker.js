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
  const addD = (d, n) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  (Array.isArray(data.ev) ? data.ev : []).slice(0, 600).forEach((e, i) => {
    if (e.allDay && /^\d{4}-\d{2}-\d{2}$/.test(e.d)){ // bande « Semaine A / B » sur toute la semaine
      L.push("BEGIN:VEVENT", `UID:${e.d.replace(/-/g, "")}-sem-${team.slice(0, 6)}@parcours`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${e.d.replace(/-/g, "")}`,
        `DTEND;VALUE=DATE:${addD(e.d, Math.min(7, Number(e.days) || 1)).replace(/-/g, "")}`, fold("SUMMARY:" + icsEsc(e.t)), fold("DESCRIPTION:" + icsEsc(e.desc)), "TRANSP:TRANSPARENT", "END:VEVENT");
      return;
    }
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

// ===================== Google Agenda (connexion directe) =====================
// La personne autorise une fois l'appli sur son compte Google ; le relais crée un agenda
// « Athéna · entraînement » et y écrit les séances (avec rappels), puis le tient à jour
// tout seul (toutes les 15 min, et juste après chaque changement dans l'appli).
// Secrets Cloudflare : GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET. Stockage : KV « GKV ».
const G_SCOPE = "https://www.googleapis.com/auth/calendar.app.created"; // une seule autorisation : pas de case à cocher chez Google
const G_CALLBACK = "https://parcours-coach.remyvancoppenolle.workers.dev/google/callback";
const APP_URL = "https://remvan5917.github.io/parcours/index.html";
const CAL_API = "https://www.googleapis.com/calendar/v3";
const TEAM_RE = /^[a-z0-9]{20,40}$/;
const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function sign(env, msg){
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.GOOGLE_CLIENT_SECRET), {name: "HMAC", hash: "SHA-256"}, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg)));
}
async function evId(team, key){
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(team + "|" + key));
  return "ath" + [...new Uint8Array(h)].slice(0, 16).map(b => b.toString(16).padStart(2, "0")).join(""); // base32hex valide
}
const back = q => Response.redirect(APP_URL + "?google=" + q + "#plan", 302);
const parisToday = () => new Intl.DateTimeFormat("en-CA", {timeZone: "Europe/Paris"}).format(new Date());
async function gToken(env, refresh){
  const r = await fetch("https://oauth2.googleapis.com/token", {method: "POST", headers: {"Content-Type": "application/x-www-form-urlencoded"},
    body: new URLSearchParams({client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, refresh_token: refresh, grant_type: "refresh_token"})});
  const d = await r.json().catch(() => ({}));
  return r.ok ? d.access_token : (d.error === "invalid_grant" ? "REVOKED" : null);
}
async function gStart(env, team, nom){
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GKV) return new Response("La connexion Google n'est pas encore configurée.", {status: 503, headers: {"Content-Type": "text/plain; charset=utf-8"}});
  if (!TEAM_RE.test(team || "")) return back("erreur");
  const n = b64url(new TextEncoder().encode(String(nom || "").trim().slice(0, 30)));
  const exp = Date.now() + 15 * 60000, state = `${team}.${exp}.${n}.${await sign(env, team + "." + exp + "." + n)}`;
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  Object.entries({client_id: env.GOOGLE_CLIENT_ID, redirect_uri: G_CALLBACK, response_type: "code", scope: G_SCOPE, access_type: "offline", prompt: "consent select_account", state}).forEach(([k, v]) => u.searchParams.set(k, v));
  return Response.redirect(u.toString(), 302);
}
async function gCallback(env, url, ctx){
  const [team, exp, n, sig] = (url.searchParams.get("state") || "").split(".");
  if (!TEAM_RE.test(team || "") || !(Number(exp) > Date.now()) || sig !== await sign(env, team + "." + exp + "." + n)) return back("erreur");
  let nom = ""; try { nom = new TextDecoder().decode(Uint8Array.from(atob((n || "").replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0))); } catch (e) {}
  if (url.searchParams.get("error") || !url.searchParams.get("code")) return back("refus");
  const r = await fetch("https://oauth2.googleapis.com/token", {method: "POST", headers: {"Content-Type": "application/x-www-form-urlencoded"},
    body: new URLSearchParams({code: url.searchParams.get("code"), client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: G_CALLBACK, grant_type: "authorization_code"})});
  const t = await r.json().catch(() => ({}));
  if (!r.ok || !t.refresh_token) return back("erreur");
  if (!String(t.scope || "").includes("calendar.app.created")) return back("case");
  const H = {Authorization: "Bearer " + t.access_token, "Content-Type": "application/json"};
  const canUse = async c => c && (await fetch(`${CAL_API}/calendars/${encodeURIComponent(c)}`, {headers: H})).ok;
  // même compte déjà connecté ? (son agenda Athéna lui est accessible) → on le reprend, sinon nouvel agenda
  let key = null, cal = null, map = {}, prev = null;
  for (const k of await teamKeys(env, team)){
    const st = JSON.parse(await env.GKV.get(k) || "null");
    if (st && await canUse(st.cal)){ prev = st; cal = st.cal; map = st.map || {}; key = k.split(":").length === 3 ? k : null; if (!key){ await env.GKV.delete(k); } break; }
  }
  if (!key) key = `g:${team}:${[...crypto.getRandomValues(new Uint8Array(6))].map(b => b.toString(16).padStart(2, "0")).join("")}`;
  if (!cal){
    const c = await fetch(`${CAL_API}/calendars`, {method: "POST", headers: H, body: JSON.stringify({summary: "Athéna · entraînement", description: "Séances préparées par Athéna. Mis à jour automatiquement : modifie ton planning dans l'appli, pas ici.", timeZone: "Europe/Paris"})});
    if (!c.ok) return back("erreur");
    cal = (await c.json()).id;
  }
  const label = nom || (prev && (prev.label || prev.email)) || "";
  await env.GKV.put(key, JSON.stringify({refresh: t.refresh_token, cal, map, label, lastAt: 0, pending: true, at: Date.now()}));
  ctx.waitUntil(gSyncKey(env, key, team, true));
  return back("ok");
}
async function gBatch(token, ops){
  const res = [];
  for (let i = 0; i < ops.length; i += 50){
    const part = ops.slice(i, i + 50), b = "athena_" + crypto.randomUUID();
    const body = part.map((o, j) => `--${b}\r\nContent-Type: application/http\r\nContent-ID: <it${j}>\r\n\r\n${o.method} ${o.path} HTTP/1.1\r\n` +
      (o.body ? `Content-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(o.body)}\r\n` : "\r\n")).join("") + `--${b}--`;
    const r = await fetch("https://www.googleapis.com/batch/calendar/v3", {method: "POST", headers: {Authorization: "Bearer " + token, "Content-Type": "multipart/mixed; boundary=" + b}, body});
    const txt = await r.text(), st = {};
    for (const m of txt.matchAll(/Content-ID:\s*<response-it(\d+)>[\s\S]*?HTTP\/1\.1 (\d{3})/gi)) st[m[1]] = Number(m[2]);
    part.forEach((o, j) => res.push(st[j] || (r.ok ? 0 : r.status)));
  }
  return res;
}
async function gSyncKey(env, k, team, force){
  const st = JSON.parse(await env.GKV.get(k) || "null");
  if (!st || st.revoked) return {connected: !!st, revoked: !!(st && st.revoked)};
  const r = await fetch(`https://firestore.googleapis.com/v1/projects/${FB_PROJECT}/databases/(default)/documents/equipes/${team}/reglages/agenda?key=${FB_WEB_KEY}`);
  if (!r.ok) return {connected: true, error: "agenda introuvable"};
  const doc = await r.json(), at = Number((doc.fields.at || {}).integerValue || (doc.fields.at || {}).doubleValue || 0);
  if (!force && at && st.lastAt === at && !st.pending) return {connected: true, upToDate: true};
  let data = {alarm: 30, ev: []}; try { data = JSON.parse(doc.fields.json.stringValue); } catch (e) {}
  const token = await gToken(env, st.refresh);
  if (token === "REVOKED"){ st.revoked = true; await env.GKV.put(k, JSON.stringify(st)); return {connected: true, revoked: true}; }
  if (!token) return {connected: true, error: "jeton"};
  const alarm = Math.min(240, Math.max(0, Number(data.alarm) || 30)), want = {};
  const addD = (d, n) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  for (const e of (Array.isArray(data.ev) ? data.ev : []).slice(0, 600)){
    if (e.allDay && /^\d{4}-\d{2}-\d{2}$/.test(e.d)){
      const key = `${e.d}|semaine|${String(e.t || "").slice(0, 40)}`;
      const body = {summary: String(e.t || "Semaine"), description: String(e.desc || ""), start: {date: e.d}, end: {date: addD(e.d, Math.min(7, Number(e.days) || 1))},
        transparency: "transparent", colorId: /A$/.test(e.t) ? "9" : "8", reminders: {useDefault: false}, status: "confirmed"};
      want[key] = {body, hash: JSON.stringify(body).length + ":" + [...JSON.stringify(body)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0)};
      continue;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.d) || !/^\d{2}:\d{2}$/.test(e.h)) continue;
    const [hh, mm] = e.h.split(":").map(Number), endMin = Math.min(23 * 60 + 59, hh * 60 + mm + Math.min(240, Number(e.dur) || 60));
    const key = `${e.d}|${e.h}|${String(e.t || "").slice(0, 80)}`;
    const body = {summary: String(e.t || "Séance"), description: String(e.desc || ""),
      start: {dateTime: `${e.d}T${e.h}:00`, timeZone: "Europe/Paris"},
      end: {dateTime: `${e.d}T${String(Math.floor(endMin / 60)).padStart(2, "0")}:${String(endMin % 60).padStart(2, "0")}:00`, timeZone: "Europe/Paris"},
      reminders: alarm > 0 ? {useDefault: false, overrides: [{method: "popup", minutes: alarm}]} : {useDefault: false}, status: "confirmed"};
    if (e.love) body.colorId = "4"; // moments à deux en rose (Flamingo)
    want[key] = {body, hash: JSON.stringify(body).length + ":" + [...JSON.stringify(body)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0)};
  }
  const calP = `/calendar/v3/calendars/${encodeURIComponent(st.cal)}/events`, today = parisToday(), ops = [];
  for (const [key, w] of Object.entries(want)){
    if (st.map[key] === w.hash) continue;
    const id = await evId(team, key);
    ops.push(st.map[key] ? {key, kind: "upd", method: "PUT", path: `${calP}/${id}`, body: w.body, hash: w.hash, id}
                         : {key, kind: "ins", method: "POST", path: calP, body: {id, ...w.body}, hash: w.hash, id});
  }
  for (const key of Object.keys(st.map)) if (!want[key] && key.slice(0, 10) >= today) ops.push({key, kind: "del", method: "DELETE", path: `${calP}/${await evId(team, key)}`});
  const apply = (o, code) => {
    if (o.kind === "del"){ if (code < 300 || code === 404 || code === 410) delete st.map[o.key]; return null; }
    if (code >= 200 && code < 300){ st.map[o.key] = o.hash; return null; }
    if (o.kind === "ins" && code === 409) return {...o, kind: "upd", method: "PUT", path: `${calP}/${o.id}`, body: Object.fromEntries(Object.entries(o.body).filter(([k]) => k !== "id"))};
    if (o.kind === "upd" && (code === 404 || code === 410)) return {...o, kind: "ins", method: "POST", path: calP, body: {id: o.id, ...o.body}};
    return "fail";
  };
  // envoi par paquets de 50, progression enregistrée après chaque paquet : si le relais est coupé,
  // la mise à jour automatique (toutes les 15 min) reprend là où il s'est arrêté
  const save = () => env.GKV.put(k, JSON.stringify(st));
  if (ops.length){ st.pending = true; await save(); }
  let todo = ops, fails = 0;
  for (let round = 0; round < 2 && todo.length; round++){
    const next = [];
    for (let i = 0; i < todo.length; i += 50){
      const chunk = todo.slice(i, i + 50), codes = await gBatch(token, chunk);
      chunk.forEach((o, j) => { const x = apply(o, codes[j]); if (x === "fail") fails++; else if (x) next.push(x); });
      await save();
      if (i + 50 < todo.length) await new Promise(z => setTimeout(z, 800));
    }
    todo = next;
  }
  st.lastAt = at; st.pending = fails + todo.length > 0; st.synced = Date.now();
  await save();
  return {connected: true, changed: ops.length, pending: st.pending};
}
async function teamKeys(env, team){
  const list = await env.GKV.list({prefix: "g:" + team});
  return list.keys.map(x => x.name).filter(n => n === "g:" + team || n.startsWith(`g:${team}:`));
}
async function gSync(env, team, force){
  const out = [];
  for (const k of await teamKeys(env, team)) out.push(await gSyncKey(env, k, team, force).catch(() => ({error: "échec"})));
  return {accounts: out.length, changed: out.reduce((n, x) => n + (x.changed || 0), 0), pending: out.some(x => x.pending)};
}
async function gStatus(env, team){
  const accounts = [];
  for (const k of await teamKeys(env, team)){
    const st = JSON.parse(await env.GKV.get(k) || "null"); if (!st) continue;
    accounts.push({id: k.split(":")[2] || "", email: st.label || st.email || "", synced: st.synced || null, pending: !!st.pending, revoked: !!st.revoked});
  }
  return {configured: true, connected: accounts.length > 0, accounts};
}
async function gOff(env, team, id){
  const k = id ? `g:${team}:${id}` : "g:" + team;
  if (!/^[a-z0-9-]{0,16}$/.test(id || "")) return {error: "compte invalide"};
  const st = JSON.parse(await env.GKV.get(k) || "null");
  if (st){
    const token = st.revoked ? null : await gToken(env, st.refresh);
    if (token && token !== "REVOKED"){
      await fetch(`${CAL_API}/calendars/${encodeURIComponent(st.cal)}`, {method: "DELETE", headers: {Authorization: "Bearer " + token}});
      await fetch("https://oauth2.googleapis.com/revoke?token=" + encodeURIComponent(st.refresh), {method: "POST"});
    }
    await env.GKV.delete(k);
  }
  return gStatus(env, team);
}

export default {
  async scheduled(event, env, ctx) {
    if (!env.GKV || !env.GOOGLE_CLIENT_ID) return;
    const list = await env.GKV.list({prefix: "g:"});
    for (const k of list.keys) ctx.waitUntil(gSyncKey(env, k.name, k.name.slice(2).split(":")[0], false).catch(() => {}));
  },
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (req.method === "GET"){
      const m = url.pathname.match(/^\/agenda\/([a-z0-9]{20,40})\.ics$/);
      if (m) return agenda(m[1]);
      if (url.pathname === "/google/start") return gStart(env, url.searchParams.get("equipe"), url.searchParams.get("nom"));
      if (url.pathname === "/google/callback") return gCallback(env, url, ctx);
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
    if (url.pathname.startsWith("/google/")){
      if (!env.GKV || !env.GOOGLE_CLIENT_ID) return json({ configured: false }, 200, cors);
      let b = {}; try { b = await req.json(); } catch (e) {}
      const team = String(b.equipe || "");
      if (!TEAM_RE.test(team)) return json({ error: { message: "code invalide" } }, 400, cors);
      if (url.pathname === "/google/sync") return json(await gSync(env, team, !!b.force), 200, cors);
      if (url.pathname === "/google/off") return json(await gOff(env, team, String(b.compte || "")), 200, cors);
      if (url.pathname === "/google/status") return json(await gStatus(env, team), 200, cors);
      return json({ error: { message: "inconnu" } }, 404, cors);
    }
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
