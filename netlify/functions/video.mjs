// Netlify function: turns one storyboard photo + its shot prompt into a video clip
// using the Higgsfield API. The Higgsfield key lives only here.
//
// Actions (POST JSON, staff session required):
//   { action: 'submit', request_id, photo_id, label, move, prompt, duration }
//   { action: 'status', ids: [clip ids] }
//
// Env: HIGGSFIELD_API_KEY (the single key from the console; may look like id:secret)
//      or HIGGSFIELD_API_KEY_ID + HIGGSFIELD_API_KEY_SECRET,
//      optional HIGGSFIELD_MODEL (defaults to Kling 3.0 standard image-to-video)

const HF_BASE = 'https://api.higgsfield.ai'
const DEFAULT_MODEL = 'kling-video/v3.0/std/image-to-video'
const TERMINAL = new Set(['completed', 'failed', 'nsfw', 'canceled', 'error'])

const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
})

const SB = () => process.env.SUPABASE_URL
const service = () => ({
  apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
})
const hfAuth = () => {
  const single = (process.env.HIGGSFIELD_API_KEY || '').trim().replace(/^Key\s+/i, '')
  return single ? `Key ${single}` : `Key ${process.env.HIGGSFIELD_API_KEY_ID}:${process.env.HIGGSFIELD_API_KEY_SECRET}`
}
const hfConfigured = () => Boolean(process.env.HIGGSFIELD_API_KEY || (process.env.HIGGSFIELD_API_KEY_ID && process.env.HIGGSFIELD_API_KEY_SECRET))

async function staffUser(req) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!token) return null
  const res = await fetch(`${SB()}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: process.env.SUPABASE_ANON_KEY },
  })
  if (!res.ok) return null
  const user = await res.json()
  const check = await fetch(`${SB()}/rest/v1/staff?user_id=eq.${user.id}&select=user_id`, { headers: service() })
  const rows = check.ok ? await check.json() : []
  return rows.length ? user : null
}

async function db(path, init = {}) {
  const res = await fetch(`${SB()}/rest/v1/${path}`, {
    ...init,
    headers: { ...service(), 'Content-Type': 'application/json', Prefer: 'return=representation', ...(init.headers || {}) },
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const msg = data?.message || `database error ${res.status}`
    if (/clips/.test(msg) && /exist|schema cache/i.test(msg)) throw new Error('the clips table is missing. Run update-3-generate.sql in Supabase')
    throw new Error(msg)
  }
  return data
}

async function signPhoto(path) {
  const res = await fetch(`${SB()}/storage/v1/object/sign/intake/${path.split('/').map(encodeURIComponent).join('/')}`, {
    method: 'POST',
    headers: { ...service(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn: 60 * 60 * 2 }),
  })
  const data = await res.json().catch(() => ({}))
  const signed = data.signedURL || data.signedUrl
  if (!res.ok || !signed) throw new Error('could not prepare the photo for generation')
  return `${SB()}/storage/v1${signed.startsWith('/') ? '' : '/'}${signed}`
}

function hfError(status, data) {
  const detail = data?.detail || data?.error || data?.message
  const text = typeof detail === 'string' ? detail : detail ? JSON.stringify(detail).slice(0, 300) : ''
  if (status === 401 || status === 403) return 'the Higgsfield API key was rejected. Check HIGGSFIELD_API_KEY in Netlify'
  if (status === 402 || /credit|balance|insufficient/i.test(text)) return 'the Higgsfield account is out of API credit. Top up at console.higgsfield.ai'
  if (status === 429) return 'Higgsfield is rate-limiting us. Wait a minute and try again'
  return `Higgsfield returned an error (${status}${text ? `: ${text}` : ''})`
}

function videoUrlFrom(data) {
  return data?.video?.url || data?.videos?.[0]?.url || data?.output?.url || data?.outputs?.[0]?.url || null
}

async function submit(user, body) {
  const requestId = String(body.request_id || '')
  const photoId = String(body.photo_id || '')
  const prompt = String(body.prompt || '').slice(0, 2500)
  if (!requestId || !photoId || !prompt.trim()) return json(400, { error: 'missing photo or prompt' })

  // Only photos that belong to this request can be sent
  const rows = await db(`request_photos?id=eq.${encodeURIComponent(photoId)}&request_id=eq.${encodeURIComponent(requestId)}&select=id,path`, { headers: { Prefer: '' } })
  if (!rows?.length) return json(404, { error: 'that photo is not saved on this request. Save the storyboard first' })
  // Use the frame-sized copy the Studio prepared, if it belongs to this request
  const prepared = String(body.image_path || '')
  const safe = new RegExp(`^${requestId.replace(/[^a-zA-Z0-9-]/g, '')}/gen/[A-Za-z0-9._-]+$`)
  const path = prepared && safe.test(prepared) ? prepared : rows[0].path

  const model = (process.env.HIGGSFIELD_MODEL || DEFAULT_MODEL).replace(/^\/+/, '')
  const duration = Math.min(15, Math.max(3, Math.round(Number(body.duration) || 5)))
  const imageUrl = await signPhoto(path)

  const res = await fetch(`${HF_BASE}/${model}`, {
    method: 'POST',
    headers: {
      Authorization: hfAuth(),
      'Content-Type': 'application/json',
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify({ image_url: imageUrl, prompt, duration, sound: 'off' }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) return json(502, { error: hfError(res.status, data) })

  const [clip] = await db('clips', {
    method: 'POST',
    body: JSON.stringify({
      created_by: user.id, request_id: requestId, photo_id: photoId, photo_path: path,
      label: String(body.label || '').slice(0, 60), move: String(body.move || '').slice(0, 20),
      prompt, model, duration,
      hf_request_id: data.request_id || null, status_url: data.status_url || null,
      status: data.status || 'queued',
      video_url: videoUrlFrom(data),
    }),
  })
  return json(200, { clip })
}

async function status(body) {
  const ids = (Array.isArray(body.ids) ? body.ids : []).map(String).filter(Boolean).slice(0, 30)
  if (!ids.length) return json(200, { clips: [] })
  const clips = await db(`clips?id=in.(${ids.map(encodeURIComponent).join(',')})&select=*`, { headers: { Prefer: '' } })
  const out = []
  for (const c of clips) {
    if (TERMINAL.has(c.status) || !c.status_url) { out.push(c); continue }
    const res = await fetch(c.status_url, { headers: { Authorization: hfAuth() } })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { out.push(c); continue }
    const next = {
      status: data.status || c.status,
      video_url: videoUrlFrom(data) || c.video_url,
      error: data.status === 'failed' ? (typeof data.error === 'string' ? data.error : 'generation failed')
        : data.status === 'nsfw' ? 'rejected by Higgsfield content moderation' : null,
      completed_at: TERMINAL.has(data.status) ? new Date().toISOString() : null,
    }
    if (next.status === c.status && next.video_url === c.video_url) { out.push(c); continue }
    const [updated] = await db(`clips?id=eq.${c.id}`, { method: 'PATCH', body: JSON.stringify(next) })
    out.push(updated || { ...c, ...next })
  }
  return json(200, { clips: out })
}

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Use POST' })
  if (!hfConfigured()) {
    return json(500, { error: 'video generation isn’t set up yet. Add HIGGSFIELD_API_KEY in Netlify' })
  }
  const user = await staffUser(req)
  if (!user?.id) return json(401, { error: 'your session has expired. Sign in again' })

  let body
  try { body = await req.json() } catch { return json(400, { error: 'invalid request' }) }
  try {
    if (body.action === 'submit') return await submit(user, body)
    if (body.action === 'status') return await status(body)
    return json(400, { error: 'unknown action' })
  } catch (e) {
    return json(502, { error: e.message })
  }
}
