
import React, { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { img } from '../config/assets'

export default function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { login } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const onSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const data = await login(username, password)
      navigate(data.user?.role_code?.toLowerCase() === 'admin' ? (location.state?.from || '/legacy-sismico') : '/legacy-sismico/sala-sic', { replace: true })
    } catch (err) {
      setError(err.message || 'No fue posible iniciar sesión.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="tm-login-page">
      <div className="tm-login-card">
        <img src={img.tele} alt="Telemining" className="tm-login-logo" />
        <h1>Acceso TM One</h1>
        <p>Ingresa con tu usuario y contraseña.</p>
        <form onSubmit={onSubmit} className="tm-login-form">
          <label>
            <span>Usuario</span>
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
          </label>
          <label>
            <span>Contraseña</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </label>
          {error ? <div className="tm-login-error">{error}</div> : null}
          <button type="submit" className="alert-btn tm-login-btn" disabled={loading}>{loading ? 'Ingresando…' : 'Login'}</button>
        </form>
      </div>
    </div>
  )
}
