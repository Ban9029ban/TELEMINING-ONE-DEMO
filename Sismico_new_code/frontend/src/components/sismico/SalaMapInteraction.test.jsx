// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, expect, test, vi } from 'vitest'
import LegacyStyledSismicoPage from './LegacyStyledSismicoPage'
import AndesNorteLegacyPage from '../AndesNorteLegacyPage'
import { ANDES_NORTE_CONFIG } from '../../config/andesNorteConfig'
import { getSismicoLegacySiteConfig } from '../../config/sismicoLegacySiteConfigs'
import { reconcileManualEntries } from '../../utils/sismicoManualState'
import { getSharedMapStore } from '../../hooks/useSharedMapState'
import { setManualObjectState, setPolygonControlMode } from '../../services/sismicoOperatorApi'
const mocks = vi.hoisted(()=>({refresh:vi.fn(async()=>{}),detail:{objects:[]},state:{object_states:[]}}))
vi.mock('../../context/AuthContext',()=>({useAuth:()=>({user:{username:'sala_cic',role_code:'user'}})}))
vi.mock('../../hooks/useSismicoSite',()=>({useSismicoSite:()=>({...mocks,accessDenied:false})}))
vi.mock('../../services/sismicoApi',()=>({loadPublicRuntimeConfig:async()=>({}),getEmergencyState:async()=>({is_active:false}),setEmergencyState:vi.fn()}))
vi.mock('../../services/sismicoOperatorApi',()=>({setManualObjectState:vi.fn(async()=>({ok:true})),setPolygonControlMode:vi.fn(async(site,code,mode)=>({object_code:code,mode,updated_at:new Date().toISOString()}))}))
vi.mock('../../utils/sismicoObjectResolver',()=>({hasSismicoObjectSupport:()=>true,resolveSismicoObjectCode:item=>item.code,normalizeSismicoObjectText:value=>String(value||'').toLowerCase()}))
let roots, nodes
beforeEach(()=>{globalThis.IS_REACT_ACT_ENVIRONMENT=true;roots=[];nodes=[];delete window.__tmoneManualMapStores;mocks.state.object_states=[];localStorage.clear();vi.clearAllMocks();vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});vi.useFakeTimers()})
afterEach(async()=>{await act(async()=>roots.forEach(root=>root.unmount()));nodes.forEach(node=>node.remove());vi.clearAllTimers();vi.useRealTimers();vi.restoreAllMocks();delete window.__tmoneManualMapStores})
async function pane(config,query,Component=LegacyStyledSismicoPage){window.history.replaceState({},'',`/legacy-sismico/diamante?pantalla=1&sic_lock=1&${query}`);const node=document.createElement('div');document.body.appendChild(node);const root=createRoot(node);roots.push(root);nodes.push(node);await act(async()=>root.render(<Component config={config}/>));return node}
test.each([['dual','alerta','normal'],['tri','inferior','centro'],['tri','superior','centro'],['traffic','rojo','verde']])('split panes display and animate %s / %s',async(mode,state,reset)=>{
 const assets={normal:'/normal.png',critical:'/alerta.png',inferior:'/inferior.png',superior:'/superior.png',rojo:'/rojo.png',verde:'/verde.png'}
 const config={siteCode:'diamante',title:'Poligonos',mapTitle:'Mapa',mapFallbacks:['/map.png'],objects:[{code:'poligono',name:'Poligono',stateMode:mode,keys:['poligono'],overlayAssets:assets}]}
 const buttons=await pane(config,'sic_map=0&sic_left=1');const map=await pane(config,'sic_map=1&sic_left=0')
 expect(buttons.querySelector('.legacy-site-map-overlay')).toBeNull()
 await act(async()=>[...buttons.querySelectorAll('button')].find(b=>b.textContent===state.toUpperCase()).click())
 const polygon=map.querySelector('.legacy-site-map-overlay')
 expect(polygon.getAttribute('src')).toContain(`/${state}.png`)
 expect(polygon.classList.contains(`state-${state}`)).toBe(true)
 expect(polygon.classList.contains('blink-slot-0')).toBe(true)
 expect(setManualObjectState).toHaveBeenCalledTimes(1)
 await act(async()=>[...buttons.querySelectorAll('button')].find(b=>b.textContent===reset.toUpperCase()).click())
 expect(map.querySelector('.legacy-site-map-overlay').classList.contains(`state-${reset}`)).toBe(true)
 expect(setManualObjectState).toHaveBeenCalledTimes(2)
})
test('manual state is isolated between sites and accounts',()=>{
 const a=getSharedMapStore('diamante','sala_cic','manual',{})
 a.set({polygon:{stateCode:'alerta'}})
 expect(getSharedMapStore('diamante','sala_cic','manual',{}).getSnapshot()).toEqual(a.getSnapshot())
 expect(getSharedMapStore('andes_norte','sala_cic','manual',{}).getSnapshot()).toEqual({})
 expect(getSharedMapStore('diamante','admin','manual',{}).getSnapshot()).toEqual({})
})

test('Andes Norte separated map receives state and selected polygon priority',async()=>{
 const config={siteCode:'andes_norte',title:'Andes Norte',mapTitle:'Mapa',mapBase:'/map.png',groups:[{title:'Grupo',name:'Grupo',items:[{code:'poligono',name:'Poligono',mode:'tri',assets:{centro:'/centro.png',inferior:'/inferior.png',superior:'/superior.png'}}]}]}
 const buttons=await pane(config,'sic_map=0&sic_left=1',AndesNorteLegacyPage)
 const map=await pane(config,'sic_map=1&sic_left=0',AndesNorteLegacyPage)
 await act(async()=>[...buttons.querySelectorAll('button')].find(b=>b.textContent==='SUPERIOR').click())
 const overlay=map.querySelector('.andesnorte-map-overlay')
 expect(overlay.getAttribute('src')).toBe('/superior.png')
 expect(overlay.classList.contains('state-superior')).toBe(true)
 expect(Number(overlay.style.zIndex)).toBeGreaterThanOrEqual(1300)
 expect(setManualObjectState).toHaveBeenCalledTimes(1)
})
test('separate iframe windows use the same parent screen state',()=>{
 const first=document.createElement('iframe'),second=document.createElement('iframe')
 document.body.append(first,second);nodes.push(first,second)
 const a=getSharedMapStore('diamante','sala_cic','manual',{},first.contentWindow)
 const b=getSharedMapStore('diamante','sala_cic','manual',{},second.contentWindow)
 const listener=vi.fn();const unsubscribe=b.subscribe(listener)
 a.set({polygon:{stateCode:'rojo'}})
 expect(b.getSnapshot()).toEqual({polygon:{stateCode:'rojo'}})
 expect(listener).toHaveBeenCalledOnce();unsubscribe()
})

test('buttons work directly even when previous mode is automatic',async()=>{
 mocks.state.object_states=[{object_code:'poligono',control_mode:'auto',value:'NORMAL'}]
 const config={siteCode:'diamante',title:'Poligonos',mapTitle:'Mapa',mapFallbacks:['/map.png'],objects:[{code:'poligono',name:'Poligono',stateMode:'dual',keys:['poligono'],overlayAssets:{normal:'/normal.png',critical:'/alerta.png'}}]}
 const buttons=await pane(config,'sic_map=0&sic_left=1');const map=await pane(config,'sic_map=1&sic_left=0')
 expect(buttons.querySelector('.polygon-mode-switch')).toBeNull()
 const alert=[...buttons.querySelectorAll('button')].find(b=>b.textContent==='ALERTA')
 expect(alert.disabled).toBe(false)
 await act(async()=>alert.click())
 expect(map.querySelector('.legacy-site-map-overlay').classList.contains('state-alerta')).toBe(true)
 expect(setPolygonControlMode).not.toHaveBeenCalled()
 expect(setManualObjectState).toHaveBeenCalledTimes(1)
})
test('failed manual save restores the displayed polygon and reports the failure',async()=>{
 setManualObjectState.mockResolvedValueOnce({ok:false,error:'Fuente no disponible'})
 const config={siteCode:'diamante',title:'Poligonos',mapTitle:'Mapa',mapFallbacks:['/map.png'],objects:[{code:'poligono',name:'Poligono',stateMode:'dual',keys:['poligono'],overlayAssets:{normal:'/normal.png',critical:'/alerta.png'}}]}
 const buttons=await pane(config,'sic_map=0&sic_left=1');const map=await pane(config,'sic_map=1&sic_left=0')
 await act(async()=>[...buttons.querySelectorAll('button')].find(b=>b.textContent==='ALERTA').click())
 expect(map.querySelector('.legacy-site-map-overlay').classList.contains('state-normal')).toBe(true)
 expect(buttons.querySelector('[role="alert"]').textContent).toContain('Fuente no disponible')
})

const tcConfig = getSismicoLegacySiteConfig('andes_norte_tunel_correa')
test.each(['profundo','under'].flatMap(slug=>['inferior','centro','superior'].flatMap(value=>['andes_norte','andes_norte_tunel_correa'].map(site=>[site,slug,value]))))('HDIS updates %s / %s / %s in Sala CIC',async(site,slug,value)=>{
 const isAnn=site==='andes_norte',config=isAnn?ANDES_NORTE_CONFIG:tcConfig,Component=isAnn?AndesNorteLegacyPage:LegacyStyledSismicoPage
 const code=(isAnn?'':'tc_')+'bajo_andesita_'+slug
 mocks.state.object_states=[{object_code:code,value,source_status:'online',observed_at:new Date().toISOString()}]
 const buttons=await pane(config,'sic_map=0&sic_left=1',Component);const map=await pane(config,'sic_map=1&sic_left=0',Component)
 const item=(isAnn?config.groups.flatMap(g=>g.items):config.objects).find(i=>i.backendObjectCode===code)
 const expected=isAnn?item.assets[value]:item.overlayAssets[value==='centro'?'normal':value]
 const overlay=[...map.querySelectorAll('img')].find(i=>i.getAttribute('src')?.split('?')[0]===expected)
 expect(overlay).toBeTruthy();expect(overlay.classList.contains('state-'+value)).toBe(true)
 expect(overlay.className).toMatch(/blink-slot-/)
 expect(buttons.textContent).toContain(item.name)
 expect(setManualObjectState).not.toHaveBeenCalled()
})
test('new buttons follow reference dashboard order and TC uses traffic colors',()=>{
 expect(ANDES_NORTE_CONFIG.groups[0].items.slice(-2).map(i=>i.backendObjectCode)).toEqual(['bajo_andesita_profundo','bajo_andesita_under'])
 expect(tcConfig.objects.map(i=>i.code)).toEqual(['bajo_andesita_profundo','bajo_andesita_under','pilar_2_profundo','tc_oim','p_4600'])
 expect(tcConfig.objects.slice(3).every(i=>i.stateMode==='traffic' && i.overlayAssets.amarillo)).toBe(true)
})

test('new automatic polygon releases manual preview on a newer real reading',()=>{
 const entry={stateCode:'superior',backendObjectCode:'bajo_andesita_under',automaticSource:true,requestedAt:'2026-09-11T10:00:00Z'}
 const remote={object_code:'bajo_andesita_under',state_code:'normal',source_status:'online',observed_at:'2026-09-11T10:01:00Z'}
 expect(reconcileManualEntries({polygon:entry},[remote])).toEqual({})
 expect(reconcileManualEntries({polygon:entry},[{...remote,source_status:'offline'}])).toEqual({polygon:entry})
 expect(reconcileManualEntries({polygon:entry},[{...remote,observed_at:'2026-09-11T09:59:00Z'}])).toEqual({polygon:entry})
})


test.each(['diamante_pipa', 'an_norte_fw', 'tc_oim'])('fresh source data replaces saved manual state for %s without a UI flag', code => {
 const entry={stateCode:'superior',backendObjectCode:code,requestedAt:'2026-09-11T10:00:00Z'}
 const entries={polygon:entry}
 const remote={object_code:code,source_status:'online',state_code:'normal',observed_at:'2026-09-11T10:01:00Z'}
 expect(reconcileManualEntries(entries,[remote])).toEqual({})
 for(const source_status of ['offline','cached','manual','unknown']) {
  expect(reconcileManualEntries(entries,[{...remote,source_status}])).toBe(entries)
 }
 expect(reconcileManualEntries(entries,[])).toBe(entries)
 expect(reconcileManualEntries(entries,[{...remote,object_code:'other_polygon'}])).toBe(entries)
 expect(reconcileManualEntries(entries,[{...remote,state_code:null}])).toBe(entries)
 expect(reconcileManualEntries(entries,[{...remote,observed_at:null}])).toBe(entries)
 expect(reconcileManualEntries(entries,[{...remote,observed_at:'2026-09-11T09:59:00Z'}])).toBe(entries)
 expect(reconcileManualEntries(entries,[{...remote}, {object_code:'manual_only',source_status:'manual'}])).toEqual({})
})


test.each(['diamante','andes_norte','andes_norte_tunel_correa'])('%s redraws the real polygon after a manual click and source recovery', async site => {
 const isAnn=site==='andes_norte'
 const Component=isAnn?AndesNorteLegacyPage:LegacyStyledSismicoPage
 const item={code:'poligono',name:'Poligono',mode:'tri',stateMode:'tri',keys:['poligono'],assets:{centro:'/normal.png',superior:'/superior.png'},overlayAssets:{normal:'/normal.png',superior:'/superior.png'}}
 const config={siteCode:site,title:'Poligonos',mapTitle:'Mapa',mapBase:'/map.png',mapFallbacks:['/map.png'],groups:[{title:'Grupo',items:[item]}],objects:[item]}
 const node=await pane(config,'sic_map=1&sic_left=1',Component)
 const selector=isAnn?'.andesnorte-map-overlay':'.legacy-site-map-overlay'
 await act(async()=>[...node.querySelectorAll('button')].find(b=>b.textContent==='SUPERIOR').click())
 expect(node.querySelector(selector).classList.contains('state-superior')).toBe(true)
 mocks.state={object_states:[{object_code:'poligono',value:'centro',source_status:'online',observed_at:new Date(Date.now()+1000).toISOString()}]}
 await act(async()=>roots[0].render(<Component config={config}/>))
 expect(node.querySelector(selector).classList.contains('state-centro')).toBe(true)
 expect(node.querySelector(selector).getAttribute('src')).toContain('/normal.png')
 expect(getSharedMapStore(site,'sala_cic','manual',{}).getSnapshot()).toEqual({})
})


test.each([
 ['diamante','diamante_pipa'],['diamante','footprint_hw'],['diamante','footprint_fw'],
 ['andes_norte','an_norte_hw'],['andes_norte','an_norte_fw'],['andes_norte','an_sur_hw'],
 ['andes_norte','cabecera_hw'],['andes_norte','cabecera_fw_norte'],['andes_norte','monitoreo_post_evento_fw'],
 ['andes_norte_tunel_correa','tc_tc_oim'],['andes_norte_tunel_correa','tc_p_4600'],
])('%s / %s remains manual even when a newer online row exists', (site,code) => {
 const entries={polygon:{stateCode:'superior',backendObjectCode:code,automaticSource:true,requestedAt:'2026-09-11T10:00:00Z'}}
 const remote={object_code:code,value:'centro',source_status:'online',observed_at:'2026-09-11T10:01:00Z'}
 expect(reconcileManualEntries(entries,[remote],site)).toBe(entries)
})

test.each([
 ['diamante','bde'],['andes_norte','bajo_andesita_profundo'],['andes_norte','bajo_andesita_under'],
 ['andes_norte','inicio_caving'],['andes_norte','poligono_pilar_2'],
 ['andes_norte_tunel_correa','tc_bajo_andesita_profundo'],['andes_norte_tunel_correa','tc_bajo_andesita_under'],
 ['andes_norte_tunel_correa','tc_pilar_2_profundo'],
])('%s / %s still releases manual state on a new source reading', (site,code) => {
 const entries={polygon:{stateCode:'superior',backendObjectCode:code,requestedAt:'2026-09-11T10:00:00Z'}}
 const remote={object_code:code,value:'centro',source_status:'online',observed_at:'2026-09-11T10:01:00Z'}
 expect(reconcileManualEntries(entries,[remote],site)).toEqual({})
})
