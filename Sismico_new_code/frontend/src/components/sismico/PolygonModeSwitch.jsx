import React from 'react'
import './PolygonModeSwitch.css'
export default function PolygonModeSwitch({item,controls,allowed}) {
 if(!controls.automatic(item))return null
 const manual=controls.modeFor(item)==='manual'
 const label=`Cambiar ${item.name} a modo ${manual?'Automático':'Manual'}`
 return <button type="button" className={`polygon-mode-switch ${manual?'manual':'auto'}`} disabled={!allowed || controls.busy} title={label} aria-label={label} onClick={()=>controls.toggle(item)}>{manual?'MANUAL':'AUTO'} ⇄</button>
}
