// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, afterEach, expect, test, vi } from 'vitest'
import { AuthProvider } from '../context/AuthContext'
import { VisualLayoutBoundary } from '../components/visual/VisualLayout'
import SalaSicPage from './SalaSicPage'
let root, node, role, stored, writes, reads
const project = {selected:true,mode:'together',showMap:true,showPolygons:false}
async function flush() { await act(async()=>{await new Promise(r=>setTimeout(r,0))}) }
async function mount(nextRole) {
 role=nextRole
 localStorage.setItem('tmone_auth',JSON.stringify({token:'test',user:{username:role==='admin'?'admin':'sala_cic',role_code:role}}))
 await act(async()=>root.render(<MemoryRouter initialEntries={['/legacy-sismico/sala-sic']}><AuthProvider><VisualLayoutBoundary><SalaSicPage /></VisualLayoutBoundary></AuthProvider></MemoryRouter>))
 await flush(); await flush()
}
async function click(text) {const button=[...document.querySelectorAll('button')].find(b=>b.textContent===text);expect(button).toBeTruthy();await act(async()=>button.click());await flush()}
beforeEach(()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true
 stored={version:1,boxes:{},sala:{density:'normal',projects:{diamante:project}}};writes=[];reads=[]
 vi.stubGlobal('fetch',vi.fn(async(url,options={})=>{
  let data
  if(url.endsWith('/auth/me'))data={username:role==='admin'?'admin':'sala_cic',role_code:role}
  else if(url.endsWith('/users'))data=[{username:'admin'},{username:'sala_cic'}]
  else {reads.push(url);if(options.method==='PUT'){stored=JSON.parse(options.body);writes.push(stored)}data=stored}
  return {ok:true,json:async()=>structuredClone(data)}
 }))
 node=document.createElement('div');document.body.appendChild(node);root=createRoot(node)
})
afterEach(async()=>{await act(async()=>root.unmount());node.remove();localStorage.clear();vi.unstubAllGlobals()})
test('Sala CIC sees only assigned map and no editing controls',async()=>{
 await mount('user')
 expect(document.querySelectorAll('iframe')).toHaveLength(1)
 expect(document.querySelector('iframe').src).toContain('/diamante?')
 expect(document.querySelector('iframe').src).toContain('sic_left=0')
 expect(document.querySelectorAll('button')).toHaveLength(0)
})
test('admin opens the actual sala_cic view and saves buttons only',async()=>{
 await mount('admin')
 expect(reads.every(url=>url.endsWith('/sala-sic/sala_cic'))).toBe(true)
 expect(document.querySelectorAll('iframe')).toHaveLength(1)
 await click('Mostrar configuracion Sala SIC')
 await click('Preset: Solo poligonos')
 await click('Guardar selección para usuario')
 expect(writes).toHaveLength(1)
 expect(writes[0].sala.projects.diamante.showMap).toBe(false)
 expect(writes[0].sala.projects.diamante.showPolygons).toBe(true)
 expect(document.querySelector('iframe').src).toContain('sic_map=0')
})
test('missing assignment does not display all maps for the user',async()=>{
 stored={version:1,boxes:{}}
 await mount('user')
 expect(document.querySelectorAll('iframe')).toHaveLength(0)
 expect(document.body.textContent).toContain('No hay mapas asignados')
})

test('Tunel Correa stays outside Sala CIC even with a previously saved selection',async()=>{
 stored.sala.projects.andes_norte_tunel_correa=project
 await mount('user')
 expect(document.querySelectorAll('iframe')).toHaveLength(1)
 expect([...document.querySelectorAll('iframe')].some(frame=>frame.src.includes('tunel-correa'))).toBe(false)
})
