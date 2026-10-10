import { useRef, useState } from 'react'
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, TouchSensor, useSensor, useSensors,
} from '@dnd-kit/core'
import {
  SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ROOM_LABELS } from '../lib/prompts.js'

function Frame({ item, index, vertical, editable, onLabel, onRemove, shape, onShape }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id, disabled: !editable })
  const style = { transform: CSS.Transform.toString(transform), transition }
  const labels = ROOM_LABELS[vertical] || ROOM_LABELS.hospitality

  return (
    <div ref={setNodeRef} style={style} className={`frame${isDragging ? ' dragging' : ''}`}>
      <div className="frame-img" {...attributes} {...listeners} aria-label={`Photo ${index + 1}${item.label ? `, ${item.label}` : ''}. Drag to reorder.`}>
        <img src={item.url} alt="" onLoad={e => onShape?.(item.id, e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)} />
        <span className="frame-no">{index + 1}</span>
        {shape && <span className={`frame-shape is-${shape}`}>{shape === 'upright' ? 'Upright' : shape === 'sideways' ? 'Sideways' : 'Square'}</span>}
      </div>
      {editable && (
        <button type="button" className="frame-remove" onClick={() => onRemove(item.id)} aria-label={`Remove photo ${index + 1}`}>×</button>
      )}
      {editable ? (
        <select value={item.label || ''} onChange={e => onLabel(item.id, e.target.value)} aria-label={`What photo ${index + 1} shows`}>
          <option value="">What does this show?</option>
          {labels.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
      ) : (
        <div className="frame-label">{item.label || 'Unlabelled'}</div>
      )}
    </div>
  )
}

/**
 * Ordered photo storyboard. Items: { id, url, label, file? }.
 * Drag to reorder, label each frame, add more via the drop zone.
 */
/** upright | sideways | square, from a photo's pixel size */
export function shapeOf(w, h) {
  if (!w || !h) return null
  const r = w / h
  return r < 0.9 ? 'upright' : r > 1.1 ? 'sideways' : 'square'
}

/**
 * format: '9:16' | '16:9' | 'both' — when given, shows a gentle (never blocking)
 * note if photos don't match the shape of the video the client wants.
 */
export default function PhotoReel({ items, onChange, vertical = 'hospitality', editable = true, max = 20, onAdd, format }) {
  const inputRef = useRef(null)
  const [over, setOver] = useState(false)
  const [shapes, setShapes] = useState({})
  const onShape = (id, w, h) => setShapes(m => (m[id] ? m : { ...m, [id]: shapeOf(w, h) }))
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function handleDragEnd({ active, over }) {
    if (!over || active.id === over.id) return
    const from = items.findIndex(i => i.id === active.id)
    const to = items.findIndex(i => i.id === over.id)
    onChange(arrayMove(items, from, to))
  }

  function addFiles(fileList) {
    const files = Array.from(fileList || []).filter(f => f.type.startsWith('image/'))
    const room = Math.max(0, max - items.length)
    if (!files.length || !room) return
    onAdd(files.slice(0, room))
  }

  const full = items.length >= max

  return (
    <div>
      {items.length > 0 && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={items.map(i => i.id)} strategy={rectSortingStrategy}>
            <div className="reel">
              {items.map((item, i) => (
                <Frame
                  key={item.id} item={item} index={i} vertical={vertical} editable={editable}
                  shape={shapes[item.id]} onShape={onShape}
                  onLabel={(id, label) => onChange(items.map(x => (x.id === id ? { ...x, label } : x)))}
                  onRemove={id => onChange(items.filter(x => x.id !== id))}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {format && items.length > 0 && (() => {
        const known = items.map(i => shapes[i.id]).filter(Boolean)
        const sideways = known.filter(x => x === 'sideways').length
        const upright = known.filter(x => x === 'upright').length
        if (format === '9:16' && sideways) {
          return <p className="shape-note">{sideways} photo{sideways > 1 ? 's are' : ' is'} sideways. That’s fine, but for a vertical video we trim the left and right edges. If you have upright versions, they’ll look even better.</p>
        }
        if (format === '16:9' && upright) {
          return <p className="shape-note">{upright} photo{upright > 1 ? 's are' : ' is'} upright. That’s fine, but for a wide video we trim the top and bottom. If you have sideways versions, they’ll look even better.</p>
        }
        return null
      })()}

      {editable && !full && (
        <div
          className={`dropzone${over ? ' over' : ''}`}
          style={{ marginTop: items.length ? 14 : 0 }}
          role="button" tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click() } }}
          onDragOver={e => { e.preventDefault(); setOver(true) }}
          onDragLeave={() => setOver(false)}
          onDrop={e => { e.preventDefault(); setOver(false); addFiles(e.dataTransfer.files) }}
        >
          <input ref={inputRef} type="file" accept="image/*" multiple hidden onChange={e => { addFiles(e.target.files); e.target.value = '' }} />
          <strong>{items.length ? 'Add more photos' : 'Drop photos here, or click to choose'}</strong>
          <span>JPG or PNG, up to {max} photos. Drag them into the order a guest would walk through.</span>
        </div>
      )}
    </div>
  )
}
