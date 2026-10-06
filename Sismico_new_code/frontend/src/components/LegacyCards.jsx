import React from 'react'
import { Link } from 'react-router-dom'

export function ProjectCards() {
  const cards = [
    { code: 'diamante', label: 'DIAMANTE', to: '/legacy-sismico/diamante', className: 'diamante' },
    { code: 'andesita', label: 'ANDESITA', to: '/legacy-sismico/andesita', className: 'andesita' },
    { code: 'andes-norte', label: 'ANDES NORTE', to: '/legacy-sismico/andes-norte', className: 'andesnorte' },
  ]
  return (
    <div className="legacy-card-grid">
      {cards.map(c => (
        <Link to={c.to} key={c.code} className={`legacy-card ${c.className}`}>
          <div className="legacy-card-mock" />
          <span>{c.label}</span>
        </Link>
      ))}
    </div>
  )
}
