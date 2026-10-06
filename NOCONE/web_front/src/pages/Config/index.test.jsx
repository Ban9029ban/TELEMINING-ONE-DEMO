import React from 'react';
import {render,screen,fireEvent,within,waitFor,cleanup} from '@testing-library/react';
import Config from './index';
jest.mock('../../hooks/useUserPermissions',()=>()=>({permissions:{},roles:['Admin']}));
jest.mock('../../components/config/UserPermissionsAdminPanel',()=>()=>null);
jest.mock('../../components/production/ProductionConfigPanel',()=>()=>null);
const catalogs=[['Empresas','companies'],['Personas','persons'],['Equipos','equipment'],['Pórticos','porticos'],['Tags','tags'],['Vehículos','vehicles'],['Cámaras','cameras']];
let data;
beforeEach(()=>{
 localStorage.setItem('token','test');
 data=Object.fromEntries(catalogs.map(([,key])=>[key,[{id:77,name:'Registro prueba',full_name:'Registro prueba',patente:'TEST77',code:'TAG77',active:true,is_active:true,source_type:'rtsp',device_kind:'camera',camera_ip:'192.0.2.1'}]]));
 global.fetch=jest.fn(async(url,options={})=>{
  const path=String(url);const key=path.includes('/cameras/sources')?'cameras':path.split('/')[3];
  if(options.method==='DELETE')data[key]=[];
  return {ok:true,headers:{get:()=> 'application/json'},json:async()=>path.endsWith('/extra')?{}:data[key]||{}};
 });
});
afterEach(()=>{cleanup();localStorage.clear();delete global.fetch;});
test.each(catalogs)('%s: delete confirmation removes the row and survives refresh',async(label,key)=>{
 render(<Config/>);
 await screen.findByText('Registro prueba');
 fireEvent.click(screen.getByRole('button',{name:label,exact:true}));
 const remove=await screen.findByRole('button',{name:'Eliminar',exact:true});
 fireEvent.click(remove);
 let dialog=screen.getByRole('dialog');
 fireEvent.click(within(dialog).getByRole('button',{name:'Cancelar'}));
 expect(fetch.mock.calls.some(([,options])=>options?.method==='DELETE')).toBe(false);
 fireEvent.click(screen.getByRole('button',{name:'Eliminar',exact:true}));
 dialog=screen.getByRole('dialog');
 fireEvent.click(within(dialog).getByRole('button',{name:'Eliminar',exact:true}));
 await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
 expect(screen.queryByRole('button',{name:'Eliminar',exact:true})).not.toBeInTheDocument();
 const path=key==='cameras'?'/api/cameras/sources/77':`/api/config/${key}/77`;
 expect(fetch).toHaveBeenCalledWith(path,expect.objectContaining({method:'DELETE',headers:expect.objectContaining({Authorization:'Bearer test'})}));
 cleanup();
 render(<Config/>);
 await screen.findByRole('button',{name:label,exact:true});
 fireEvent.click(screen.getByRole('button',{name:label,exact:true}));
 await waitFor(()=>expect(fetch.mock.calls.filter(([url,options])=>url===path.replace('/77','') && !options?.method).length).toBeGreaterThan(1));
 expect(screen.queryByRole('button',{name:'Eliminar',exact:true})).not.toBeInTheDocument();
});

test.each(catalogs)('%s: edit opens and saves the expected endpoint',async(label,key)=>{
 render(<Config/>);
 await screen.findByText('Registro prueba');
 fireEvent.click(screen.getByRole('button',{name:label,exact:true}));
 fireEvent.click(await screen.findByRole('button',{name:'Editar',exact:true}));
 const save=await screen.findByRole('button',{name:key==='cameras'?'Guardar cambios':'Guardar',exact:true});
 fireEvent.click(save);
 const path=key==='cameras'?'/api/cameras/sources/77':`/api/config/${key}/77`;
 await waitFor(()=>expect(fetch.mock.calls.some(([url,options])=>url===path && options?.method==='PUT')).toBe(true));
});
test('camera delete failure stays visible and can be retried',async()=>{
 const original=fetch.getMockImplementation();
 fetch.mockImplementation(async(url,options)=>options?.method==='DELETE'?{ok:false,headers:{get:()=> 'application/json'},json:async()=>({detail:'Sin permiso'})}:original(url,options));
 render(<Config/>);await screen.findByText('Registro prueba');
 fireEvent.click(screen.getByRole('button',{name:'Cámaras',exact:true}));
 fireEvent.click(await screen.findByRole('button',{name:'Eliminar',exact:true}));
 fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Eliminar',exact:true}));
 expect(await screen.findByText(/No se pudo eliminar: Sin permiso/)).toBeInTheDocument();
 expect(within(screen.getByRole('dialog')).getByRole('button',{name:'Eliminar',exact:true})).toBeEnabled();
});

test.each(catalogs)('%s: create opens and cancellation does not write',async(label,key)=>{
 render(<Config/>);await screen.findByText('Registro prueba');
 fireEvent.click(screen.getByRole('button',{name:label,exact:true}));
 fireEvent.click(await screen.findByRole('button',{name:key==='cameras'?'Nuevo dispositivo NOC':['companies','persons'].includes(key)?'Nueva':'Nuevo',exact:true}));
 const dialog=screen.getByRole('dialog');
 expect(dialog).toBeInTheDocument();
 fireEvent.click(within(dialog).getByRole('button',{name:'Cerrar diálogo',exact:true}));
 expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
 expect(fetch.mock.calls.some(([,options])=>['POST','PUT','DELETE'].includes(options?.method))).toBe(false);
});

 test('inactive cameras enabled for NOC remain visible and editable in configuration',async()=>{
 data.cameras=[{...data.cameras[0],name:'Camara NOC existente',is_active:false,active:false,nok_enabled:true}];
 render(<Config/>);await screen.findByText('Registro prueba');
 fireEvent.click(screen.getByRole('button',{name:'Cámaras',exact:true}));
 expect(await screen.findByText('Camara NOC existente')).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Eliminar',exact:true})).toBeEnabled();
 expect(screen.getByRole('button',{name:'Editar',exact:true})).toBeEnabled();
 });
