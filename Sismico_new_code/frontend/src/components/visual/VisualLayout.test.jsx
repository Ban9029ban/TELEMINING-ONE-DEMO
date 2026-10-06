// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { AuthProvider } from '../../context/AuthContext'
import { VisualLayoutBoundary, VisualBox, VisualLayoutHeaderSlot } from './VisualLayout'

let root, container, layouts, puts, role
const empty = { version: 1, boxes: {} }
const assigned = {version: 1, boxes: {map: {x:40,y:10,width:50,height:75},buttons:{x:0,y:10,width:30,height:75}}}
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) }) }
function button(text) { return [...document.querySelectorAll('button')].find(node => node.textContent === text) }
async function click(text) { const node = button(text); expect(node).toBeTruthy(); await act(async () => node.click()); await flush() }
async function mount(userRole = 'admin', extra = false, overlays = false) {
  role = userRole
  localStorage.setItem('tmone_auth', JSON.stringify({token:'test-token', user:{username:'admin',role_code:userRole}}))
  await act(async () => root.render(<MemoryRouter initialEntries={['/legacy-sismico/diamante?pantalla=1']}><AuthProvider><VisualLayoutBoundary><header><VisualLayoutHeaderSlot /><span>Administrador</span></header><div className="legacy-site-page diamante-page">{extra && <VisualBox id="connection" label="Estado de conexión"><section>Conectado</section></VisualBox>}<VisualBox id="buttons" label="Botones"><section>Estados</section></VisualBox><VisualBox id="map" label="Mapa"><section>Plano</section></VisualBox>{overlays && <><VisualBox id="alert-map" label="Minimapa 3D"><aside data-testid="minimap">3D</aside></VisualBox><VisualBox id="remote-alerts" label="Alertas"><aside data-testid="alerts">Alerta</aside></VisualBox></>}</div></VisualLayoutBoundary></AuthProvider></MemoryRouter>))
  await flush(); await flush()
}
async function select(element, value) { await act(async () => { element.value=value; element.dispatchEvent(new Event('change', {bubbles:true})) }); await flush() }

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  layouts={admin:empty, user:assigned}; puts=[]
  vi.stubGlobal('fetch', vi.fn(async (url, options={}) => {
    let data
    if (url.endsWith('/auth/me')) data={username:'admin',full_name:'Administrador',role_code:role}
    else if (url.endsWith('/visual-layout/users')) data=[{username:'admin',full_name:'Administrador'}, {username:'user',full_name:'Usuario'}]
    else {
      const target=url.split('/').pop()
      if (options.method==='PUT') { data=JSON.parse(options.body); layouts[target]=data; puts.push({target,data}) }
      else data=layouts[target]
    }
    return {ok:true, json:async()=>structuredClone(data)}
  }))
  document.documentElement.requestFullscreen=vi.fn(async()=>{})
  container=document.createElement('div'); document.body.appendChild(container); root=createRoot(container)
})
afterEach(async()=>{ await act(async()=>root.unmount()); container.remove(); localStorage.clear(); vi.unstubAllGlobals() })

test('admin selects another user, previews, saves and returns to own view', async()=>{
  await mount()
  await click('⚙ Configurar vista')
  const target=document.querySelector('.visual-layout-controls select')
  expect(target.disabled).toBe(false)
  await select(target,'user')
  expect(document.querySelector('[data-visual-box="map"]').style.left).toBe('40%')
  expect(document.querySelector('.visual-box-content').classList.contains('diamante-page')).toBe(true)
  await click('Guardar vista')
  expect(puts).toEqual([{target:'user', data:assigned}])
  expect(document.querySelector('[role="status"]').textContent).toContain('Usuario')
  expect(document.querySelectorAll('[data-visual-box]').length).toBe(0)
})

test('User edits own default view without a user picker and can cancel', async()=>{
  await mount('user')
  await click('⚙ Configurar vista')
  expect(document.querySelectorAll('.visual-layout-controls select').length).toBe(1)
  expect(document.querySelectorAll('[data-visual-box]').length).toBe(2)
  await click('Cancelar')
  expect(puts.length).toBe(0)
  expect(document.querySelectorAll('[data-visual-box]').length).toBe(0)
})

test('default geometry is persisted and recovered after reopening editor', async()=>{
  await mount('user'); await click('⚙ Configurar vista'); await click('Guardar vista')
  expect(Object.keys(puts[0].data.boxes)).toEqual(['buttons','map'])
  await click('⚙ Configurar vista')
  expect(document.querySelector('[data-visual-box="map"]').style.width).toBe('65%')
})

test('a failed save leaves draft open and can be retried', async()=>{
  await mount(); await click('⚙ Configurar vista')
  fetch.mockImplementationOnce(async()=>({ok:false,json:async()=>({detail:'Temporal'})}))
  await click('Guardar vista')
  expect(document.querySelector('[role="alert"]').textContent).toContain('Temporal')
  expect(button('Guardar vista').disabled).toBe(false)
  await click('Guardar vista'); expect(puts.length).toBe(1)
})

test('additional panels appear in the picker and are saved for the selected user', async()=>{
  await mount('admin', true); await click('⚙ Configurar vista')
  const selects=document.querySelectorAll('.visual-layout-controls select')
  expect([...selects[1].options].some(option=>option.value==='connection')).toBe(true)
  await select(selects[0], 'user')
  await click('Guardar vista')
  expect(puts[0].target).toBe('user')
  expect(puts[0].data.boxes.connection).toBeTruthy()
})

test('configure is inside the header and panel DOM survives editing and cancel', async()=>{
  await mount('user')
  expect(button('⚙ Configurar vista').closest('header')).toBeTruthy()
  const original = [...document.querySelectorAll('section')].find(node => node.textContent === 'Plano')
  await click('⚙ Configurar vista')
  expect(document.querySelector('[data-visual-box="map"] section')).toBe(original)
  await click('Cancelar')
  expect([...document.querySelectorAll('section')].find(node => node.textContent === 'Plano')).toBe(original)
  expect(button('⚙ Configurar vista').closest('header')).toBeTruthy()
})

async function toggleLabel(text) {
 const label=[...document.querySelectorAll('.visual-layout-controls label')].find(node=>node.textContent===text)
 expect(label).toBeTruthy()
 await act(async()=>label.querySelector('input').click());await flush()
}
test('user hides and restores minimap without changing alert visibility',async()=>{
 await mount('user',false,true)
 expect(document.querySelector('[data-testid="minimap"]')).toBeTruthy()
 await click('⚙ Configurar vista')
 await toggleLabel('Mostrar Minimapa 3D')
 expect(document.querySelector('[data-testid="minimap"]')).toBeNull()
 expect(document.querySelector('[data-testid="alerts"]')).toBeTruthy()
 await toggleLabel('Mostrar Minimapa 3D')
 expect(document.querySelector('[data-testid="minimap"]')).toBeTruthy()
 await toggleLabel('Mostrar Minimapa 3D');await click('Guardar vista')
 expect(puts[0].data.overlays['alert-map'].visible).toBe(false)
})
test('admin denial hides alerts and user cannot toggle them',async()=>{
 layouts.admin={...empty,overlays:{'remote-alerts':{allowed:false,visible:false}}}
 await mount('user',false,true)
 expect(document.querySelector('[data-testid="alerts"]')).toBeNull()
 await click('⚙ Configurar vista')
 const label=[...document.querySelectorAll('label')].find(node=>node.textContent==='Mostrar Alertas')
 expect(label.querySelector('input').disabled).toBe(true)
})
test('admin saves visibility permission for another user',async()=>{
 await mount('admin',false,true);await click('⚙ Configurar vista')
 await select(document.querySelector('.visual-layout-controls select'),'user')
 await toggleLabel('Permitir a este usuario ver Minimapa 3D')
 await click('Guardar vista')
 expect(puts[0].target).toBe('user')
 expect(puts[0].data.overlays['alert-map']).toEqual({allowed:false,visible:false})
})
