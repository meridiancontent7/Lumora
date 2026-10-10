import { supabase, INTAKE_BUCKET } from './supabase.js'

// Frame sizes Kling accepts comfortably, one per delivery format.
export const FRAME_SIZES = {
  '9:16': [720, 1280],
  '4:5': [864, 1080],
  '16:9': [1280, 720],
}

/**
 * Makes a copy of a photo cropped to the video's frame (centre crop) and
 * sized for the video model, saves it next to the original, and returns
 * its storage path. Phone photos are often too big or an odd shape for
 * image-to-video models; this keeps every clip the shape of the final video.
 */
export async function prepareFrame({ requestId, photo, format = '9:16' }) {
  const [w, h] = FRAME_SIZES[format] || FRAME_SIZES['9:16']
  if (!photo?.url) throw new Error('the photo isn’t loaded yet. Refresh the page and try again')

  let bitmap
  try {
    const res = await fetch(photo.url)
    if (!res.ok) throw new Error(`photo download failed (${res.status})`)
    bitmap = await createImageBitmap(await res.blob())
  } catch {
    throw new Error('this photo can’t be read in the browser (HEIC photos from iPhones often can’t). Save it as a JPG, replace it in the storyboard and try again')
  }

  // Centre crop to the target shape, then scale to the target size
  const target = w / h
  const src = bitmap.width / bitmap.height
  let sw = bitmap.width, sh = bitmap.height, sx = 0, sy = 0
  if (src > target) { sw = Math.round(bitmap.height * target); sx = Math.round((bitmap.width - sw) / 2) }
  else if (src < target) { sh = Math.round(bitmap.width / target); sy = Math.round((bitmap.height - sh) / 2) }

  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, w, h)
  bitmap.close?.()

  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9))
  if (!blob) throw new Error('could not prepare the photo')

  const path = `${requestId}/gen/${photo.id}-${format.replace(':', 'x')}.jpg`
  const { error } = await supabase.storage.from(INTAKE_BUCKET).upload(path, blob, {
    contentType: 'image/jpeg', upsert: true, cacheControl: '60',
  })
  if (error) throw new Error(`could not save the resized photo (${error.message})`)
  return path
}
