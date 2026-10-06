// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { vi, test, expect } from 'vitest'
import SismicoHomePage from './SismicoHomePage'
vi.mock('../context/AuthContext',()=>({useAuth:()=>({user:{username:'sala_cic',role_code:'user'},auth:{token:'test'}})}))
vi.mock('../services/sismicoApi',()=>({getSismicoSites:async()=>[],getEmergencyState:async()=>({is_active:false}),setEmergencyState:vi.fn()}))
test('menu shows assigned maps and simultaneous view',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({sala:{projects:{diamante:{selected:true},andes_norte:{selected:true},andesita:{selected:false}}}})})))
 vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{})
 const node=document.createElement('div');document.body.appendChild(node);const root=createRoot(node)
 try {
 await act(async()=>root.render(<MemoryRouter><SismicoHomePage/></MemoryRouter>))
 expect([...node.querySelectorAll('a')].map(a=>a.getAttribute('href'))).toEqual(['/legacy-sismico/diamante','/legacy-sismico/andes-norte','/legacy-sismico/andes-norte-tunel-correa','/legacy-sismico/sala-sic'])
 expect(node.textContent).toContain('VISTA SALA CIC');expect(node.textContent).not.toContain('Emergencia general')
 } finally {await act(async()=>root.unmount());node.remove();vi.unstubAllGlobals();vi.restoreAllMocks()}
})
