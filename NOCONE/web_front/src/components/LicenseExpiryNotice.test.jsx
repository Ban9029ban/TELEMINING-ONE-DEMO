import React from 'react';
import { render, screen, act, cleanup } from '@testing-library/react';
import LicenseExpiryNotice from './LicenseExpiryNotice';

beforeEach(() => { jest.useFakeTimers(); global.fetch = jest.fn(); });
afterEach(() => { cleanup(); jest.useRealTimers(); delete global.fetch; });
const response = data => Promise.resolve({ok:true,json:async()=>data});

test('shows exact date then removes the notice after renewal without reloading', async () => {
 fetch.mockImplementationOnce(()=>response({license_expires_on:'2026-11-24',license_warning_due:true}))
   .mockImplementationOnce(()=>response({license_expires_on:'2027-11-24',license_warning_due:false}));
 await act(async()=>render(<LicenseExpiryNotice endpoint="/api/auth/me" token="test" />));
 expect(screen.getByRole('status')).toHaveTextContent('Licencia caduca en 24/11/2026');
 await act(async()=>jest.advanceTimersByTime(60000));
 expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
test('unlimited accounts do not show a notice', async()=>{
 fetch.mockImplementation(()=>response({license_expires_on:null,license_warning_due:false}));
 await act(async()=>render(<LicenseExpiryNotice endpoint="/api/auth/me" token="test" />));
 expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
