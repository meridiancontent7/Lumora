import { useEffect, useMemo, useState } from 'react'
import CopyButton from './CopyButton.jsx'
import { supabase, callFunction } from '../lib/supabase.js'
import { formatDate } from '../lib/util.js'
import { prepareFrame } from '../lib/frame.js'
import {
  STYLES, STYLE_SETS, MOVES, PACES, GRADES, MUSIC, FORMATS,
  styleByCode, defaultSet, missingFor, buildShots, shotPrompt, editSheet,
} from '../lib/styles.js'

const SECONDS = [2, 3, 4, 5, 6]
// Rough guide only: an 8 s Kling 3.0 clip used about 14 credits (Sept 2026).
// Replace with the real figure once the first clips have run.
const CREDITS_PER_SECOND = 1.75
const PENDING = new Set(['queued', 'in_progress'])
const clipKey = (photoId, move) => `${photoId}|${move}`
const STATUS_TEXT = { queued: 'Queued', in_progress: 'Generating', completed: 'Ready', failed: 'Failed', nsfw: 'Rejected', canceled: 'Canceled', error: 'Failed' }

function sameIds(a, b) {
  return a.length === b.length && a.every((x, i) => x === b[i])
}

/**
 * Video style picker + shot-list builder.
 * Pick a style, check the client's photos cover it, set options,
 * then build a shot list with one ready-to-paste prompt per shot.
 */
export default function StylePanel({ vertical, details, photos, request }) {
  const [setKey, setSetKey] = useState(() => defaultSet(vertical, details))
  const [code, setCode] = useState('')
  const [options, setOptions] = useState(null)
  const [built, setBuilt] = useState(null) // { shots, unused, photoIds }
  const [history, setHistory] = useState([])
  const [historyError, setHistoryError] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [clips, setClips] = useState({}) // key -> latest clip
  const [genSetup, setGenSetup] = useState(false)
  const [genBusy, setGenBusy] = useState({}) // key -> true while submitting
  const [genError, setGenError] = useState('')
  const [ratios, setRatios] = useState({}) // photo id -> width / height

  // Keep the set in line with the industry
  useEffect(() => {
    const allowed = Object.entries(STYLE_SETS).filter(([, s]) => s.vertical === vertical).map(([k]) => k)
    if (!allowed.includes(setKey)) { setSetKey(defaultSet(vertical, details)); setCode(''); setBuilt(null) }
  }, [vertical]) // eslint-disable-line react-hooks/exhaustive-deps

  // Earlier shot lists for this request or client
  useEffect(() => {
    if (!request) return
    let alive = true
    ;(async () => {
      let q = supabase.from('productions').select('id, created_at, style_code, style_name, options, shots, request_id').order('created_at', { ascending: false }).limit(12)
      q = request.client_id ? q.or(`request_id.eq.${request.id},client_id.eq.${request.client_id}`) : q.eq('request_id', request.id)
      const { data, error: e } = await q
      if (!alive) return
      if (e) setHistoryError(/productions/.test(e.message) ? 'setup' : e.message)
      else setHistory(data || [])
    })()
    return () => { alive = false }
  }, [request?.id, request?.client_id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Clips already generated for this request
  useEffect(() => {
    if (!request) return
    let alive = true
    supabase.from('clips').select('*').eq('request_id', request.id).order('created_at').then(({ data, error: e }) => {
      if (!alive) return
      if (e) { if (/clips/.test(e.message)) setGenSetup(true); return }
      const map = {}
      for (const c of data || []) map[clipKey(c.photo_id, c.move)] = c
      setClips(map)
    })
    return () => { alive = false }
  }, [request?.id])

  // Check on clips that are still generating
  const pendingIds = Object.values(clips).filter(c => PENDING.has(c.status)).map(c => c.id)
  const pendingKey = pendingIds.join(',')
  useEffect(() => {
    if (!pendingIds.length) return
    const t = setInterval(async () => {
      try {
        const res = await callFunction('video', { action: 'status', ids: pendingIds })
        setClips(prev => {
          const next = { ...prev }
          for (const c of res.clips || []) next[clipKey(c.photo_id, c.move)] = c
          return next
        })
      } catch { /* try again on the next tick */ }
    }, 8000)
    return () => clearInterval(t)
  }, [pendingKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const sets = Object.entries(STYLE_SETS)
  const styles = STYLES.filter(s => s.set === setKey)
  const style = code ? styleByCode(code) : null
  const styleVertical = style ? STYLE_SETS[style.set].vertical : vertical
  const usedCount = useMemo(() => history.reduce((m, h) => ({ ...m, [h.style_code]: (m[h.style_code] || 0) + 1 }), {}), [history])
  const photoIds = photos.map(p => p.id)
  const stale = built && !sameIds(built.photoIds, photoIds)

  // The client's own choice on the sample form wins over the style default
  function startFormats(s) {
    if (details.format === '16:9') return ['16:9']
    if (details.format === 'both') return ['9:16', '16:9']
    if (details.format === '9:16') return s.defaults.formats.includes('9:16') ? [...s.defaults.formats] : ['9:16']
    return [...s.defaults.formats]
  }

  function choose(s) {
    setCode(s.code)
    setOptions({ ...s.defaults, formats: startFormats(s) })
    setNote(''); setError('')
    // One click: pick the style and get its shot list straight away
    setBuilt(photos.length ? { ...buildShots(s, photos, details), photoIds } : null)
  }

  function pickSet(k) {
    setSetKey(k); setCode(''); setBuilt(null)
  }

  const opt = (k, v) => setOptions(o => ({ ...o, [k]: v }))
  function toggleFormat(f) {
    setOptions(o => {
      const has = o.formats.includes(f)
      const next = has ? o.formats.filter(x => x !== f) : [...o.formats, f]
      return { ...o, formats: next.length ? FORMATS.filter(x => next.includes(x)) : o.formats }
    })
  }

  function build(savedMoves) {
    if (!style) return
    const res = buildShots(style, photos, details)
    if (savedMoves && savedMoves.length === res.shots.length) {
      res.shots = res.shots.map((s, i) => ({ ...s, move: savedMoves[i] || s.move }))
    }
    setBuilt({ ...res, photoIds })
    setNote(''); setError('')
  }

  const setMove = (i, move) => setBuilt(b => ({ ...b, shots: b.shots.map((s, j) => (j === i ? { ...s, move } : s)) }))
  const setCaption = (i, caption) => setBuilt(b => ({ ...b, shots: b.shots.map((s, j) => (j === i ? { ...s, caption } : s)) }))

  const promptFor = s => shotPrompt({ vertical: styleVertical, details, label: s.label, note: s.note, move: s.move, options })
  const real = built ? built.shots.filter(s => !s.missing) : []
  const allPrompts = built ? real.map((s, i) => `Shot ${i + 1} (${s.label}, ${MOVES[s.move]?.name})\n${promptFor(s)}`).join('\n\n') : ''
  const sheet = built ? editSheet({ style, options, shots: built.shots, details, vertical: styleVertical, business: request?.business }) : ''

  const frameFormat = options?.formats?.[0] || '9:16'
  const [fw, fh] = frameFormat.split(':').map(Number)
  const frameRatio = fw / fh
  const frameCss = `${fw} / ${fh}`

  const canGenerate = s => Boolean(request && s.photo?.path && !s.photo?.file && !s.missing)
  const genSeconds = () => Math.max(3, options?.seconds || 4)

  async function generate(s) {
    const key = clipKey(s.photo.id, s.move)
    setGenBusy(b => ({ ...b, [key]: true })); setGenError('')
    try {
      const format = options.formats[0] || '9:16'
      const imagePath = await prepareFrame({ requestId: request.id, photo: s.photo, format })
      const res = await callFunction('video', {
        action: 'submit', request_id: request.id, photo_id: s.photo.id, image_path: imagePath,
        label: s.label, move: s.move, prompt: promptFor(s), duration: genSeconds(),
      })
      setClips(c => ({ ...c, [key]: res.clip }))
    } catch (e) {
      setGenError(`Shot “${s.label}” didn’t start: ${e.message}`)
    }
    setGenBusy(b => ({ ...b, [key]: false }))
    return true
  }

  async function generateAll() {
    const todo = real.filter(s => canGenerate(s) && clips[clipKey(s.photo.id, s.move)]?.status !== 'completed' && !PENDING.has(clips[clipKey(s.photo.id, s.move)]?.status))
    if (!todo.length) { setGenError('Every shot already has a clip or is generating.'); return }
    const secs = genSeconds() * todo.length
    const ok = window.confirm(`Generate ${todo.length} clip${todo.length > 1 ? 's' : ''} (${secs} seconds of video)?\n\nRough cost: about ${Math.round(secs * CREDITS_PER_SECOND)} Higgsfield credits. Check your balance at console.higgsfield.ai.`)
    if (!ok) return
    for (const s of todo) {
      // one at a time, so we stay inside Higgsfield's rate limits
      // eslint-disable-next-line no-await-in-loop
      await generate(s)
    }
  }

  async function save() {
    if (!request || !built) return
    setBusy(true); setError(''); setNote('')
    const row = {
      request_id: request.id, client_id: request.client_id || null,
      style_code: style.code, style_name: style.name, options,
      shots: built.shots.map(s => ({
        photo_id: s.photo?.id || null, path: s.photo?.path || null, label: s.label,
        move: s.move, caption: s.caption || '', missing: Boolean(s.missing),
        prompt: s.missing ? null : promptFor(s),
      })),
      edit_sheet: sheet,
    }
    const { data, error: e } = await supabase.from('productions').insert(row).select('id, created_at, style_code, style_name, options, shots, request_id').single()
    if (e) {
      setError(/productions/.test(e.message)
        ? 'Shot lists can’t be saved yet. Run update-2-styles.sql in Supabase (SQL Editor), then try again.'
        : `The shot list didn’t save: ${e.message}`)
    } else {
      setHistory(h => [data, ...h]); setNote('Shot list saved')
    }
    setBusy(false)
  }

  function load(h) {
    const s = styleByCode(h.style_code)
    if (!s) { setError(`Style ${h.style_code} is no longer in the library.`); return }
    setSetKey(s.set); setCode(s.code)
    setOptions({ ...s.defaults, ...(h.options || {}) })
    const res = buildShots(s, photos, details)
    const saved = h.shots || []
    if (saved.length === res.shots.length) {
      res.shots = res.shots.map((x, i) => ({ ...x, move: saved[i].move || x.move, caption: saved[i].caption ?? x.caption }))
    }
    setBuilt({ ...res, photoIds })
    setNote(`Loaded the ${s.name} shot list from ${formatDate(h.created_at)}`)
  }

  return (
    <section className="panel" style={{ marginTop: 16 }}>
      <div className="panel-head">
        <div>
          <h3>Video style</h3>
          <p className="hint">Choose the niche, then click a style. The shot list builds straight away.</p>
        </div>
        <div className="segmented" role="group" aria-label="Niche">
          {sets.map(([k, s]) => (
            <button key={k} type="button" aria-pressed={setKey === k} onClick={() => pickSet(k)}>{s.label}</button>
          ))}
        </div>
      </div>

      <div className="panel-pad">
        <div className="style-grid" role="list">
          {styles.map(s => {
            const missing = missingFor(s, photos)
            const on = s.code === code
            return (
              <button key={s.code} type="button" role="listitem" className={`style-card${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => choose(s)}>
                <span className="style-top">
                  <span className="style-code">{s.code}</span>
                  <span className={`style-status ${s.status === 'tested' ? 'is-tested' : ''}`}>{s.status === 'tested' ? 'Tested' : 'Untested'}</span>
                </span>
                <span className="style-name">{s.name}</span>
                <span className="style-best">{s.bestFor}</span>
                <span className="style-meta">
                  {s.target[0]}–{s.target[1]} s{s.avatar ? ', avatar add-on' : ''}
                  {usedCount[s.code] ? `, used ${usedCount[s.code]}× here` : ''}
                </span>
                {photos.length > 0 && (
                  missing.length
                    ? <span className="style-check is-missing">Needs: {missing.join('; ')}</span>
                    : <span className="style-check is-ready">Photos cover this style</span>
                )}
              </button>
            )
          })}
        </div>

        {!photos.length && <p className="hint" style={{ marginTop: 14 }}>Add and label photos in the storyboard to see which styles they cover.</p>}

        {style && options && (
          <div className="style-detail">
            <div className="style-detail-head">
              <div>
                <h4>{style.code} {style.name}</h4>
                <p className="hint">{style.edit.replace('{location}', details.location || 'the place')}</p>
              </div>
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => choose(style)}>Reset options</button>
            </div>

            <div className="style-options">
              <div className="field">
                <label className="label" htmlFor="o-sec">Seconds per shot</label>
                <select id="o-sec" className="input" value={options.seconds} onChange={e => opt('seconds', Number(e.target.value))}>
                  {SECONDS.map(n => <option key={n} value={n}>{n} s</option>)}
                </select>
              </div>
              <div className="field">
                <label className="label" htmlFor="o-pace">Pace</label>
                <select id="o-pace" className="input" value={options.pace} onChange={e => opt('pace', e.target.value)}>
                  {Object.keys(PACES).map(p => <option key={p}>{p}</option>)}
                </select>
              </div>
              <div className="field">
                <label className="label" htmlFor="o-grade">Look</label>
                <select id="o-grade" className="input" value={options.grade} onChange={e => opt('grade', e.target.value)}>
                  {Object.keys(GRADES).map(g => <option key={g}>{g}</option>)}
                </select>
              </div>
              <div className="field">
                <label className="label" htmlFor="o-music">Music</label>
                <select id="o-music" className="input" value={options.music} onChange={e => opt('music', e.target.value)}>
                  {MUSIC.map(m => <option key={m}>{m}</option>)}
                </select>
              </div>
            </div>

            <div className="style-toggles">
              <label className="check"><input type="checkbox" checked={options.voiceover} onChange={e => opt('voiceover', e.target.checked)} /> Voiceover</label>
              <label className="check"><input type="checkbox" checked={options.captions} onChange={e => opt('captions', e.target.checked)} /> Captions</label>
              <span className="style-formats" role="group" aria-label="Formats">
                {FORMATS.map(f => (
                  <label key={f} className="check"><input type="checkbox" checked={options.formats.includes(f)} onChange={() => toggleFormat(f)} /> {f}</label>
                ))}
              </span>
            </div>

            <div className="style-actions">
              <button type="button" className="btn btn-ghost" onClick={() => build()} disabled={!photos.length}>
                Rebuild with these options
              </button>
              {stale && <span className="hint">The storyboard changed since this list was built. Rebuild to match it.</span>}
            </div>
          </div>
        )}

        {error && <div className="notice notice-error" role="alert" style={{ marginTop: 16 }}>{error}</div>}

        {built && style && (
          <div className="output" style={{ marginTop: 18 }}>
            <div className="output-head">
              <div>
                <h4>Shot list</h4>
                <p>Thumbnails show the {frameFormat} crop each clip will use.</p>
                <p>{real.length} shots, about {real.length * options.seconds} s. Target {style.target[0]}–{style.target[1]} s.</p>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {request && !genSetup && (
                  <button type="button" className="btn btn-primary btn-sm" onClick={generateAll} disabled={!real.some(canGenerate)}>Generate all clips</button>
                )}
                <CopyButton text={allPrompts} label="Copy all prompts" />
                <CopyButton text={sheet} label="Copy edit sheet" />
              </div>
            </div>
            {(genError || genSetup || (request && real.some(canGenerate))) && (
              <div className="output-body" style={{ borderBottom: '1px solid var(--line)', paddingTop: 12, paddingBottom: 12 }}>
                {genError && <div className="notice notice-error" role="alert">{genError}</div>}
                {genSetup && <p className="hint">Clip generation isn’t switched on yet. Run update-3-generate.sql in Supabase.</p>}
                {!genSetup && request && (
                  <p className="hint">Clips are made with Higgsfield from each saved photo, cropped to {options.formats[0] || '9:16'} ({Math.max(3, options.seconds)} s each{options.seconds < 3 ? ', trim to length in the edit' : ''}). Download the ones you keep: Higgsfield deletes them after 7 days.</p>
                )}
              </div>
            )}
            <div className="output-body shots">
              {built.shots.map((s, i) => (
                <div className={`shot${s.missing ? ' is-missing' : ''}`} key={`${s.photo?.id || 'gap'}-${i}`}>
                  <div className={`shot-thumb${frameRatio > 1 ? ' is-wide' : ''}`} style={{ aspectRatio: frameCss }} title={`Crop preview: what the ${frameFormat} video will show`}>
                    {s.photo?.url ? (
                      <img src={s.photo.url} alt="" onLoad={e => {
                        const { naturalWidth: w, naturalHeight: h } = e.currentTarget
                        const id = s.photo.id
                        setRatios(r => (r[id] ? r : { ...r, [id]: w / h }))
                      }} />
                    ) : <span>No photo</span>}
                    <span className="frame-no">{i + 1}</span>
                  </div>
                  <div className="shot-body">
                    <div className="shot-row">
                      <strong>{s.label}</strong>
                      {s.photo && ratios[s.photo.id] && Math.abs(ratios[s.photo.id] - frameRatio) / frameRatio > 0.3 && (
                        <span className="trim-tag" title="The photo is a different shape from the video, so part of it is cut off. Check the thumbnail.">
                          {ratios[s.photo.id] > frameRatio ? 'Sides trimmed' : 'Top and bottom trimmed'}
                        </span>
                      )}
                      {!s.missing && (
                        <select className="input input-sm" value={s.move} onChange={e => setMove(i, e.target.value)} aria-label={`Camera move for shot ${i + 1}`}>
                          {Object.entries(MOVES).map(([k, m]) => <option key={k} value={k}>{m.name}</option>)}
                        </select>
                      )}
                    </div>
                    {s.missing ? (
                      <p className="hint">No photo for this shot. Ask the client on WhatsApp for one, or pick another style.</p>
                    ) : (
                      <>
                        {options.captions && (
                          <input className="input input-sm" value={s.caption || ''} placeholder="Caption (optional)" onChange={e => setCaption(i, e.target.value)} aria-label={`Caption for shot ${i + 1}`} />
                        )}
                        <details className="shot-prompt">
                          <summary>Video prompt</summary>
                          <div className="prompt-text">{promptFor(s)}</div>
                        </details>
                        {(() => {
                          const key = clipKey(s.photo.id, s.move)
                          const clip = clips[key]
                          const sending = genBusy[key]
                          const pending = clip && PENDING.has(clip.status)
                          return (
                            <>
                              {clip && (
                                <div className={`clip clip-${clip.status}`}>
                                  <span className="clip-status">{STATUS_TEXT[clip.status] || clip.status}{pending ? <span className="spinner spinner-dark" /> : null}</span>
                                  {clip.status === 'completed' && clip.video_url && (
                                    <video className="clip-video" src={clip.video_url} controls playsInline muted preload="metadata" />
                                  )}
                                  {clip.error && <span className="hint">{clip.error}</span>}
                                </div>
                              )}
                              <div className="shot-row">
                                {request && !genSetup && (
                                  canGenerate(s) ? (
                                    <button type="button" className={`btn btn-sm ${clip ? 'btn-ghost' : 'btn-dark'}`} onClick={() => generate(s)} disabled={sending || pending}>
                                      {sending ? <span className="spinner" /> : clip ? (clip.status === 'completed' ? 'Redo clip' : pending ? 'Generating' : 'Try again') : 'Generate clip'}
                                    </button>
                                  ) : <span className="hint">Save the storyboard to generate this shot.</span>
                                )}
                                {clip?.status === 'completed' && clip.video_url && (
                                  <a className="btn btn-quiet btn-sm" href={clip.video_url} target="_blank" rel="noreferrer" download>Download clip</a>
                                )}
                                <CopyButton text={promptFor(s)} label="Copy prompt" />
                                {s.photo?.url && <a className="btn btn-quiet btn-sm" href={s.photo.url} target="_blank" rel="noreferrer">Open photo</a>}
                              </div>
                            </>
                          )
                        })()}
                      </>
                    )}
                  </div>
                </div>
              ))}
              {built.unused.length > 0 && (
                <p className="hint" style={{ marginTop: 12 }}>
                  {built.unused.length} photo{built.unused.length > 1 ? 's are' : ' is'} not used by this style
                  {built.unused.some(p => !p.label) ? ' (some have no label yet)' : ''}.
                </p>
              )}
            </div>
            <div className="output-head" style={{ borderTop: '1px solid var(--line)', borderBottom: 'none' }}>
              <p className="hint">{note || (request ? 'Generate clips here, or copy the prompts to run them in Higgsfield yourself.' : 'Open a request to generate clips. For now, copy the prompts into Higgsfield.')}</p>
              {request && (
                <button type="button" className="btn btn-dark btn-sm" onClick={save} disabled={busy}>
                  {busy ? <span className="spinner" /> : 'Save shot list'}
                </button>
              )}
            </div>
          </div>
        )}

        {request && (history.length > 0 || historyError === 'setup') && (
          <div className="style-history">
            <h4>Saved shot lists{request.client_id ? ' for this client' : ''}</h4>
            {historyError === 'setup' && <p className="hint">Run update-2-styles.sql in Supabase to save and reuse shot lists.</p>}
            {history.map(h => (
              <div className="style-history-row" key={h.id}>
                <span><strong>{h.style_code}</strong> {h.style_name}</span>
                <span className="hint">{formatDate(h.created_at)}{h.request_id !== request.id ? ', another request' : ''}</span>
                <button type="button" className="btn btn-quiet btn-sm" onClick={() => load(h)}>Load</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
