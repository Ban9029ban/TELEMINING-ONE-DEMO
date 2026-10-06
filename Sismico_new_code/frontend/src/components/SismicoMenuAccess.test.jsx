// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { beforeEach, afterEach, test, expect, vi } from 'vitest'
import SismicoMenuAccess from './SismicoMenuAccess'
let auth, root, node
vi.mock('../context/AuthContext',()=>({useAuth:()=>auth}))
beforeEach(()=>{globalThis.IS_REACT_ACT_ENVIRONMENT=true;node=document.createElement('div');document.body.appendChild(node);root=createRoot(node)})
afterEach(async()=>{await act(async()=>root.unmount());node.remove()})
async function render(){await act(async()=>root.render(<MemoryRouter initialEntries={['/legacy-sismico']}><Routes><Route path="/legacy-sismico" element={<SismicoMenuAccess><div>Menu de mapas exclusivo</div></SismicoMenuAccess>}/><Route path="/legacy-sismico/sala-sic" element={<div>Sala CIC del usuario</div>}/><Route path="/login" element={<div>Ingresar</div>}/></Routes></MemoryRouter>))}
test('admin sees map menu',async()=>{auth={isAuthenticated:true,user:{role_code:'admin'}};await render();expect(node.textContent).toContain('Menu de mapas exclusivo')})
test.each(['user','operador','viewer'])('%s sees entry menu',async(role)=>{auth={isAuthenticated:true,user:{role_code:role}};await render();expect(node.textContent).toBe('Menu de mapas exclusivo')})
test('loading profile never flashes map menu',async()=>{auth={isAuthenticated:true,user:null};await render();expect(node.textContent).toContain('Cargando vista');expect(node.textContent).not.toContain('Menu de mapas')})
test('missing session requires login',async()=>{auth={isAuthenticated:false,user:null};await render();expect(node.textContent).toBe('Ingresar')})
