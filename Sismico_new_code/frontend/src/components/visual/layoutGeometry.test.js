import test from 'node:test'
import assert from 'node:assert/strict'
import { fitBox, moveBox, defaultBoxes } from './layoutGeometry.js'

test('moving keeps the complete box on screen', () => {
  assert.deepEqual(moveBox({x:10,y:10,width:30,height:20}, 100, -100), {x:70,y:0,width:30,height:20})
})
test('resizing keeps origin and bounds', () => {
  assert.deepEqual(moveBox({x:20,y:30,width:30,height:20}, 100, 100, true), {x:20,y:30,width:80,height:70})
  assert.equal(moveBox({x:20,y:30,width:30,height:20}, -100, 0, true).width, 3)
})
test('all Sala SIC defaults fit within the screen', () => {
  for (let count=1; count<=16; count++) for (const box of Object.values(defaultBoxes(Array.from({length:count}, (_,i)=>`tile-${i}`)))) assert.deepEqual(fitBox(box), box)
})

test('additional dashboard cards all receive editable geometry', () => {
  const ids = ['map','buttons','actions','project','connection','alert-map','remote-alerts']
  const boxes = defaultBoxes(ids)
  assert.deepEqual(Object.keys(boxes).sort(), ids.sort())
  for (const box of Object.values(boxes)) assert.deepEqual(fitBox(box), box)
})
