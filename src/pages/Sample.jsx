import { useState } from 'react'
import PhotoReel from '../components/PhotoReel.jsx'
import { SetupNotice } from '../components/Auth.jsx'
import { supabase, isConfigured } from '../lib/supabase.js'
import { filesToItems, uploadPhoto } from '../lib/intake.js'
import { SPACE_TYPES, EMPTY_DETAILS } from '../lib/prompts.js'
import { uid } from '../lib/util.js'

const WHATSAPP = import.meta.env.VITE_WHATSAPP_NUMBER || ''

const STEPS = [
  { title: 'Your business', note: 'So we know who the video is for' },
  { title: 'Your photos', note: 'In the order a guest would see them' },
  { title: 'The feel', note: 'What the video should do for you' },
]

export default function Sample() {
  const [step, setStep] = useState(0)
  const [vertical, setVertical] = useState('hospitality')
  const [contact, setContact] = useState({ name: '', business: '', whatsapp: '', email: '', country: 'Kenya', website: '' })
  const [details, setDetails] = useState({ ...EMPTY_DETAILS.hospitality })
  const [photos, setPhotos] = useState([])
  const [outcome, setOutcome] = useState('')
  const [about, setAbout] = useState('')
  const [sending, setSending] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  if (!isConfigured) return <SetupNotice />

  const c = (k, v) => setContact(p => ({ ...p, [k]: v }))
  const d = (k, v) => setDetails(p => ({ ...p, [k]: v }))
  const isCar = vertical === 'car'

  function chooseVertical(v) {
    setVertical(v)
    setDetails(prev => ({ ...EMPTY_DETAILS[v], format: prev.format }))
    setPhotos(p => p.map(x => ({ ...x, label: '' })))
  }

  const step0Ok = contact.name.trim() && contact.business.trim() && (contact.whatsapp.trim() || contact.email.trim())
  const unlabelled = photos.filter(p => !p.label).length

  function next() {
    setError('')
    if (step === 0 && !step0Ok) { setError('Add your name, business name and a WhatsApp number or email so we can send your video.'); return }
    setStep(s => s + 1)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function submit() {
    setSending(true); setError('')
    const id = uid()
    try {
      setProgress('Saving your details')
      const base = { ...details, format: details.format || '9:16' }
      const fullDetails = isCar ? base : { ...base, propertyName: details.propertyName || contact.business }
      const { error: e1 } = await supabase.from('requests').insert({
        id, vertical, status: 'new',
        contact_name: contact.name.trim(), business: contact.business.trim(),
        whatsapp: contact.whatsapp.trim() || null, email: contact.email.trim() || null,
        country: contact.country.trim() || null, website: contact.website.trim() || null,
        about: about.trim() || null, outcome: outcome.trim() || null,
        details: fullDetails, photo_count: photos.length,
      })
      if (e1) throw e1

      for (let i = 0; i < photos.length; i++) {
        setProgress(`Uploading photo ${i + 1} of ${photos.length}`)
        const path = await uploadPhoto(id, photos[i].file)
        const { error: e2 } = await supabase.from('request_photos').insert({ request_id: id, position: i, label: photos[i].label || null, path })
        if (e2) throw e2
      }
      setDone(true)
      window.scrollTo({ top: 0 })
    } catch (e) {
      setError(`Something stopped your request from sending (${e.message}). Check your connection and press Send again. Nothing you entered has been lost.`)
    }
    setSending(false); setProgress('')
  }

  if (done) {
    return (
      <div className="public">
        <aside className="public-aside">
          <div className="brand"><span className="brand-word">Lumora</span><span className="brand-mark" /></div>
          <div style={{ marginTop: 'auto' }}>
            <h1 className="display">Thank you, {contact.name.split(' ')[0]}.</h1>
            <p style={{ marginTop: 14 }}>Your request is with our production team.</p>
          </div>
        </aside>
        <section className="public-main">
          <div className="public-card">
            <h2 className="title">What happens next</h2>
            <ol className="next-list">
              <li><div><strong>We review your {photos.length ? 'photos' : 'request'} today.</strong> If anything is missing we’ll message you on {contact.whatsapp ? 'WhatsApp' : 'email'}.</div></li>
              {!photos.length && WHATSAPP && <li><div><strong>Send your photos on WhatsApp</strong> to {WHATSAPP}, with “{contact.business}” in the first message.</div></li>}
              <li><div><strong>Your free sample video usually arrives within 2–3 days,</strong> sized for Reels, TikTok and WhatsApp Status.</div></li>
              <li><div><strong>No payment and no obligation.</strong> If you like it, we’ll show you how monthly videos work.</div></li>
            </ol>
          </div>
        </section>
      </div>
    )
  }

  return (
    <div className="public">
      <aside className="public-aside">
        <div className="brand"><span className="brand-word">Lumora</span><span className="brand-mark" /></div>
        <div>
          <h1 className="display">Your first video is on us.</h1>
          <p style={{ marginTop: 14 }}>Send us the photos you already have. We turn them into a cinematic video you can post, free, usually within 2–3 days.</p>
        </div>
        <ol className="steps" aria-label="Progress">
          {STEPS.map((s, i) => (
            <li key={s.title} className={`step ${i === step ? 'is-current' : i > step ? 'is-todo' : ''}`} aria-current={i === step ? 'step' : undefined}>
              <span className="step-no">{i + 1}</span>
              <div><strong>{s.title}</strong><span>{s.note}</span></div>
            </li>
          ))}
        </ol>
      </aside>

      <section className="public-main">
        <div className="public-card">
          {step === 0 && (
            <>
              <h2 className="title">Tell us about your business</h2>
              <p className="muted small" style={{ margin: '6px 0 22px' }}>Takes about a minute.</p>

              <div className="field">
                <span className="label" id="v-label">What should the video show?</span>
                <div className="choice" role="group" aria-labelledby="v-label">
                  <button type="button" aria-pressed={!isCar} onClick={() => chooseVertical('hospitality')}>
                    <strong>A property</strong><span>Airbnb, villa, lodge or hotel</span>
                  </button>
                  <button type="button" aria-pressed={isCar} onClick={() => chooseVertical('car')}>
                    <strong>A car</strong><span>A vehicle you’re selling</span>
                  </button>
                </div>
              </div>

              <div className="row">
                <div className="field"><label className="label" htmlFor="s-name">Your name<span className="req">*</span></label><input id="s-name" className="input" autoComplete="name" value={contact.name} onChange={e => c('name', e.target.value)} /></div>
                <div className="field"><label className="label" htmlFor="s-biz">Business name<span className="req">*</span></label><input id="s-biz" className="input" autoComplete="organization" placeholder={isCar ? 'Westlands Motors' : 'Kazuri Diani Villas'} value={contact.business} onChange={e => c('business', e.target.value)} /></div>
              </div>
              <div className="row">
                <div className="field"><label className="label" htmlFor="s-wa">WhatsApp number</label><input id="s-wa" className="input" type="tel" autoComplete="tel" placeholder="+254 712 345 678" value={contact.whatsapp} onChange={e => c('whatsapp', e.target.value)} /></div>
                <div className="field"><label className="label" htmlFor="s-email">Email</label><input id="s-email" className="input" type="email" autoComplete="email" value={contact.email} onChange={e => c('email', e.target.value)} /></div>
              </div>
              <p className="hint" style={{ marginTop: 6 }}>We need one of these to send you the video.</p>
              <div className="row">
                <div className="field"><label className="label" htmlFor="s-country">Country</label><input id="s-country" className="input" autoComplete="country-name" value={contact.country} onChange={e => c('country', e.target.value)} /></div>
                <div className="field"><label className="label" htmlFor="s-web">Instagram or website</label><input id="s-web" className="input" placeholder="instagram.com/yourbusiness" value={contact.website} onChange={e => c('website', e.target.value)} /></div>
              </div>

              {isCar ? (
                <>
                  <div className="row">
                    <div className="field"><label className="label" htmlFor="s-make">Make</label><input id="s-make" className="input" placeholder="Toyota" value={details.make} onChange={e => d('make', e.target.value)} /></div>
                    <div className="field"><label className="label" htmlFor="s-model">Model</label><input id="s-model" className="input" placeholder="Land Cruiser Prado" value={details.model} onChange={e => d('model', e.target.value)} /></div>
                  </div>
                  <div className="row">
                    <div className="field"><label className="label" htmlFor="s-year">Year</label><input id="s-year" className="input" inputMode="numeric" value={details.year} onChange={e => d('year', e.target.value)} /></div>
                    <div className="field"><label className="label" htmlFor="s-price">Price</label><input id="s-price" className="input" placeholder="KES 6.8M" value={details.price} onChange={e => d('price', e.target.value)} /></div>
                  </div>
                </>
              ) : (
                <div className="row">
                  <div className="field">
                    <label className="label" htmlFor="s-type">Type of property</label>
                    <select id="s-type" className="input" value={details.spaceType} onChange={e => d('spaceType', e.target.value)}>
                      <option value="">Choose</option>
                      {SPACE_TYPES.map(t => <option key={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="field"><label className="label" htmlFor="s-loc">Location</label><input id="s-loc" className="input" placeholder="Diani Beach" value={details.location} onChange={e => d('location', e.target.value)} /></div>
                </div>
              )}
            </>
          )}

          {step === 1 && (
            <>
              <h2 className="title">Add your photos</h2>
              <p className="muted small" style={{ margin: '6px 0 22px' }}>
                {isCar
                  ? 'Front, sides, rear, then the interior. Drag them into order and tell us what each one shows.'
                  : 'Start at the entrance and walk us through. Drag photos into order and tell us which space each one shows.'}
              </p>
              <div className="field" style={{ marginBottom: 18 }}>
                <span className="label" id="f-label">Where will you post this video?</span>
                <div className="choice choice-3" role="group" aria-labelledby="f-label">
                  {[
                    ['9:16', 'Instagram, TikTok', 'Reels and WhatsApp Status'],
                    ['16:9', 'YouTube, website', 'Airbnb or Booking.com listing'],
                    ['both', 'Both', 'We’ll make each shape'],
                  ].map(([k, t, sub]) => (
                    <button key={k} type="button" aria-pressed={(details.format || '9:16') === k} onClick={() => d('format', k)}>
                      <strong>{t}</strong><span>{sub}</span>
                    </button>
                  ))}
                </div>
                <p className="hint" style={{ marginTop: 8 }}>
                  {(details.format || '9:16') === '16:9'
                    ? 'Tip: hold your phone sideways when taking photos.'
                    : (details.format || '9:16') === 'both'
                      ? 'Tip: upright photos suit Reels and TikTok; sideways photos suit YouTube. Send whichever you have.'
                      : 'Tip: for Reels and TikTok, hold your phone upright when taking photos.'}
                </p>
              </div>
              <PhotoReel items={photos} onChange={setPhotos} onAdd={files => setPhotos(p => [...p, ...filesToItems(files)])} vertical={vertical} max={15} format={details.format || '9:16'} />
              {photos.length > 0 && unlabelled > 0 && (
                <p className="hint" style={{ marginTop: 12 }}>{unlabelled} photo{unlabelled > 1 ? 's' : ''} still need a label. It helps, but you can skip it.</p>
              )}
              {!photos.length && WHATSAPP && (
                <p className="hint" style={{ marginTop: 12 }}>Photos on your phone? You can also skip this and send them on WhatsApp to {WHATSAPP} afterwards.</p>
              )}
            </>
          )}

          {step === 2 && (
            <>
              <h2 className="title">How should it feel?</h2>
              <p className="muted small" style={{ margin: '6px 0 22px' }}>Optional, but the more you tell us, the more it will feel like yours.</p>
              <div className="field">
                <label className="label" htmlFor="s-about">Who are your {isCar ? 'buyers' : 'guests'}?</label>
                <textarea id="s-about" className="input" rows={3} value={about} onChange={e => setAbout(e.target.value)}
                  placeholder={isCar ? 'Young professionals and families buying their first SUV.' : 'Couples from Nairobi on long weekends, and families from Europe in December.'} />
              </div>
              <div className="field">
                <label className="label" htmlFor="s-outcome">What should the video make people feel or do?</label>
                <textarea id="s-outcome" className="input" rows={3} value={outcome} onChange={e => setOutcome(e.target.value)}
                  placeholder={isCar ? 'Feel that the car is premium and well kept, then WhatsApp us.' : 'Feel calm and wanted. The pool is the highlight. Book direct instead of through Airbnb.'} />
              </div>
              {!isCar && (
                <div className="field">
                  <label className="label" htmlFor="s-features">Best features</label>
                  <input id="s-features" className="input" placeholder="Private pool, two minutes to the beach, rooftop terrace" value={details.features} onChange={e => d('features', e.target.value)} />
                </div>
              )}
            </>
          )}

          {error && <div className="notice notice-error" role="alert" style={{ marginTop: 18 }}>{error}</div>}

          <div className="form-nav">
            {step > 0 ? <button type="button" className="btn btn-quiet" onClick={() => setStep(s => s - 1)} disabled={sending}>Back</button> : <span />}
            {step < 2 && <button type="button" className="btn btn-dark" onClick={next}>Continue</button>}
            {step === 2 && (
              <button type="button" className="btn btn-primary" onClick={submit} disabled={sending}>
                {sending ? <><span className="spinner" /> {progress}</> : 'Send my request'}
              </button>
            )}
          </div>
          <p className="hint" style={{ marginTop: 14 }}>Free, no card needed. Your photos are only used to make your video.</p>
        </div>
      </section>
    </div>
  )
}
