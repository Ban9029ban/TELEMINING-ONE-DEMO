import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canManageSismicoManualState } from './sismicoPermissions.js'
test('Sala CIC can operate map buttons without admin role',()=>{
 assert.equal(canManageSismicoManualState({username:'sala_cic',role_code:'user'}),true)
})
test('other normal users remain read only',()=>{
 assert.equal(canManageSismicoManualState({username:'otro',role_code:'user'}),false)
 assert.equal(canManageSismicoManualState({username:'sala_cic_otro',role_code:'user'}),false)
})
test('admins and operators retain access',()=>{
 assert.equal(canManageSismicoManualState({role_code:'admin'}),true)
 assert.equal(canManageSismicoManualState({role_code:'operator'}),true)
})
test('missing session cannot operate buttons',()=>{
 assert.equal(canManageSismicoManualState(null),false)
})
