import { useEffect, useState } from 'react'
import { useSharedMapState } from './useSharedMapState'
import { resolveSismicoObjectCode } from '../utils/sismicoObjectResolver'
import { setPolygonControlMode } from '../services/sismicoOperatorApi'
const stamp = value => Date.parse(value || '') || 0
export function usePolygonControlModes(siteCode, user, detail, state, setManual, refresh) {
 const [modes,setModes] = useSharedMapState(siteCode,user?.username,'control-modes',{})
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 useEffect(()=>{
  setModes(previous=>{
   const next={...previous};let changed=false
   for(const row of state?.object_states || []) {
    if(!row.control_mode)continue
    const entry={mode:row.control_mode,updated_at:row.control_updated_at}
    const old=next[row.object_code]
    if((!old || stamp(entry.updated_at)>=stamp(old.updated_at)) && JSON.stringify(old)!==JSON.stringify(entry)){next[row.object_code]=entry;changed=true}
   }
   return changed?next:previous
  })
 },[state,setModes])
 useEffect(()=>{
  setManual(previous=>{
   const next={...previous};let changed=false
   for(const [code,entry] of Object.entries(previous)) {
    const mode=modes[entry.backendObjectCode]
    if(mode?.mode==='auto'){delete next[code];changed=true}
   }
   return changed?next:previous
  })
  if(Object.keys(modes).length)refresh().catch(()=>{})
 },[modes,setManual,refresh])
 const codeFor=item=>resolveSismicoObjectCode(item,detail?.objects,state?.object_states)
 const modeFor=item=>modes[codeFor(item)]?.mode || state?.object_states?.find(row=>row.object_code===codeFor(item))?.control_mode || 'manual'
 const automatic=item=>Boolean(modes[codeFor(item)] || state?.object_states?.find(row=>row.object_code===codeFor(item))?.control_mode)
 const toggle=async item=>{
  setBusy(true);setError('')
  try {
   const code=codeFor(item),result=await setPolygonControlMode(siteCode,code,modeFor(item)==='auto'?'manual':'auto')
   setModes(previous=>({...previous,[result.object_code || code]:{mode:result.mode,updated_at:result.updated_at}}))
   await refresh()
  } catch(err){setError(err.message)} finally{setBusy(false)}
 }
 return {modeFor,automatic,toggle,busy,error,setError}
}
