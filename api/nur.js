module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  let body = req.body || {};
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const needPin = process.env.NUR_PIN;
  if (needPin && String(body.pin || '') !== String(needPin)) return res.status(401).json({ error: 'pin' });
  try {
    if (body.action === 'chat') return await chat(body, res);
    if (body.action === 'tts') return await tts(body, res);
    return res.status(400).json({ error: 'unknown action' });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
};

async function chat({ system = '', messages = [] }, res) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: 'GEMINI_API_KEY йўқ' });
  // Ҳар бир моделнинг бепул лимити алоҳида: биттаси тугаса, кейингиси синалади
  const models = [process.env.GEMINI_MODEL, 'gemini-flash-latest', 'gemini-flash-lite-latest',
    'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3-flash-preview',
    'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemma-3-27b-it'].filter(Boolean);
  const base = (Array.isArray(messages) ? messages : []).slice(-12).map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: String(m.content || '').slice(0, 4000) }],
  }));
  const sys = String(system).slice(0, 4000);
  let lastErr = 'unknown', sawLimit = false;
  for (const model of models) {
    const gemma = model.startsWith('gemma');
    let contents = base;
    if (gemma && base.length) {
      contents = base.map((c, i) => i === 0 ? { role: c.role, parts: [{ text: sys + '\n\n' + c.parts[0].text }] } : c);
    }
    const payload = { contents, generationConfig: { temperature: 0.7, maxOutputTokens: 2048 } };
    if (!gemma) payload.systemInstruction = { parts: [{ text: sys }] };
    let r, j;
    try {
      r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(payload),
      });
      j = await r.json().catch(() => ({}));
    } catch (e) { lastErr = String(e.message || e); continue; }
    if (r.ok) {
      const parts = (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
      const text = parts.filter((p) => !p.thought).map((p) => p.text || '').join('').trim();
      if (text) return res.status(200).json({ text, model });
      lastErr = 'empty'; continue;
    }
    lastErr = (j.error && j.error.message) || 'HTTP ' + r.status;
    if (r.status === 401 || r.status === 403) return res.status(502).json({ error: 'Gemini калити нотўғри: ' + lastErr });
    if (r.status === 429) sawLimit = true;
  }
  if (sawLimit) return res.status(429).json({ error: 'limit' });
  return res.status(502).json({ error: lastErr });
}

async function tts({ text = '' }, res) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return res.status(501).json({ error: 'no tts key' });
  const voice = process.env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB';
  const model = process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2';
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_64`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({ text: String(text).slice(0, 600), model_id: model }),
  });
  if (!r.ok) { const t = await r.text().catch(() => ''); return res.status(502).json({ error: t.slice(0, 300) }); }
  const buf = Buffer.from(await r.arrayBuffer());
  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).send(buf);
}
