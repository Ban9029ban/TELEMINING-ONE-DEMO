export const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
export function fitBox(box) {
  const width = clamp(Number(box.width) || 3, 3, 100)
  const height = clamp(Number(box.height) || 3, 3, 100)
  return { x: clamp(Number(box.x) || 0, 0, 100 - width), y: clamp(Number(box.y) || 0, 0, 100 - height), width, height }
}
export function moveBox(box, dx, dy, resize = false) {
  return fitBox(resize ? { ...box, width: clamp(box.width + dx, 3, 100 - box.x), height: clamp(box.height + dy, 3, 100 - box.y) } : { ...box, x: box.x + dx, y: box.y + dy })
}
export function defaultBoxes(ids) {
  const boxes = {}
  const contentIds = ids.filter(id => id !== 'actions')
  if (ids.includes('actions')) boxes.actions = { x: 1, y: 1, width: 48, height: 6 }
  if (contentIds.includes('map') && contentIds.includes('buttons')) {
    const extras = contentIds.filter(id => id !== 'map' && id !== 'buttons')
    const columns = Math.min(3, extras.length || 1)
    const rows = Math.ceil(extras.length / columns)
    const extraHeight = rows ? Math.min(44, rows * 24) : 0
    boxes.buttons = { x: 1, y: 8, width: 32, height: 90 - extraHeight }
    boxes.map = { x: 34, y: 8, width: 65, height: 90 - extraHeight }
    extras.forEach((id, index) => {
      boxes[id] = { x: 1 + index % columns * 98 / columns, y: 99 - extraHeight + Math.floor(index / columns) * extraHeight / rows,
                    width: 98 / columns - 1, height: extraHeight / rows - 1 }
    })
    return boxes
  }
  const columns = Math.ceil(Math.sqrt(contentIds.length || 1))
  const rows = Math.ceil(contentIds.length / columns) || 1
  contentIds.forEach((id, index) => { boxes[id] = { x: index % columns * (98 / columns) + 1, y: Math.floor(index / columns) * (90 / rows) + 8, width: 98 / columns - 1, height: 90 / rows - 1 } })
  return boxes
}
