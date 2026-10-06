import React from 'react';

const Footer = () => {
  return (
    <footer className="mt-6 rounded-[24px] border border-white/70 bg-white/80 px-5 py-4 text-sm text-slate-500 shadow-[0_14px_30px_rgba(15,23,42,0.06)] backdrop-blur">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>&copy; 2025 Telemining TMOne. Todos los derechos reservados.</div>
        <div className="text-xs uppercase tracking-[0.18em] text-slate-400">
          Operations UI Refresh
        </div>
      </div>
    </footer>);

};

export default Footer;