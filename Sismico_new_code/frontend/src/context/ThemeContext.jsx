import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'

const ThemeContext = createContext(null)

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => localStorage.getItem('tm_theme') || 'light')
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    document.body.classList.remove('theme-light', 'theme-dark')
    document.body.classList.add(theme === 'dark' ? 'theme-dark' : 'theme-light')
    localStorage.setItem('tm_theme', theme)
  }, [theme])
  const value = useMemo(() => ({
    theme,
    isDarkMode: theme === 'dark',
    toggleTheme: () => setTheme(t => t === 'dark' ? 'light' : 'dark')
  }), [theme])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme debe usarse dentro de ThemeProvider')
  return ctx
}
