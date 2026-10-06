import { VisualBox } from '../visual/VisualLayout'
import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, useGLTF } from '@react-three/drei'
import { MathUtils } from 'three'
import { useSismicoAlertFocus, useSismicoRemotePolygonAlerts } from '../../context/SismicoViewContext'
import './SismicoAlertMiniMap.css'

const DEFAULT_TARGET = { rotation: 0, marker: [43, -7, -5] }

const MINE_TARGETS = {
  diamante: { rotation: Math.PI / 2, marker: [50, -8, -4] },
  andesita: { rotation: (7 * Math.PI) / 6, marker: [35, -7, 32] },
  andes_norte: { rotation: 2 * Math.PI, marker: [43, -7, -5] },
  andes_norte_tunel_correa: { rotation: (5 * Math.PI) / 4, marker: [42, 6, 0] },
  pilar_norte: { rotation: (7 * Math.PI) / 4, marker: [50, 1, 14] },
  esmeralda: { rotation: 2 * Math.PI, marker: [35, 10, 40] },
}

const POLYGON_TARGETS = {
  diamante_pipa: { rotation: (5 * Math.PI) / 4, marker: [42, 6, 0] },
  pipa: { rotation: (5 * Math.PI) / 4, marker: [42, 6, 0] },
  andesita_norte_hw: { rotation: (7 * Math.PI) / 6, marker: [35, -7, 32] },
  andesita_norte_fw: { rotation: (7 * Math.PI) / 6, marker: [35, -7, 32] },
  andesita_sur_hw: { rotation: (7 * Math.PI) / 6, marker: [35, -7, 32] },
}

function normalize(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
}

function targetForAlert(alert) {
  return POLYGON_TARGETS[normalize(alert?.polygon_code)]
    || MINE_TARGETS[normalize(alert?.site_code)]
    || DEFAULT_TARGET
}

function AlertModel({ alert }) {
  const { scene } = useGLTF('/assets/models/tenientev2.glb')
  const { camera } = useThree()
  const model = useMemo(() => scene.clone(), [scene])
  const modelRef = useRef(null)
  const markerRef = useRef(null)
  const target = targetForAlert(alert)
  const isCritical = alert?.state_code === 'critical'

  useEffect(() => {
    if (!modelRef.current) return
    modelRef.current.rotation.x = 0
    modelRef.current.rotation.z = 0
  }, [model])

  useFrame(({ clock }, delta) => {
    const targetFov = alert ? 43 : 50
    camera.fov = MathUtils.damp(camera.fov, targetFov, 3.6, delta)
    camera.updateProjectionMatrix()

    if (modelRef.current) {
      modelRef.current.rotation.y = MathUtils.damp(
        modelRef.current.rotation.y,
        target.rotation,
        3.6,
        delta,
      )
    }

    if (markerRef.current) {
      markerRef.current.position.lerp({ x: target.marker[0], y: target.marker[1], z: target.marker[2] }, Math.min(delta * 4, 1))
      const pulse = alert ? 1 + Math.sin(clock.elapsedTime * 5) * 0.16 : 0
      markerRef.current.scale.setScalar(pulse)
    }
  })

  return (
    <>
      <ambientLight intensity={0.82} />
      <directionalLight position={[5, 10, 7.5]} intensity={1.25} />
      <primitive ref={modelRef} object={model} scale={90} />
      {alert ? (
        <mesh ref={markerRef} position={target.marker}>
          <sphereGeometry args={[3.2, 24, 24]} />
          <meshStandardMaterial
            color={isCritical ? '#ef233c' : '#f59e0b'}
            emissive={isCritical ? '#9f1239' : '#9a5a00'}
            emissiveIntensity={1.2}
          />
        </mesh>
      ) : null}
    </>
  )
}

function pickFocusedAlert(alerts, focusedAlertKey) {
  const focused = alerts.find((item) => String(item.map_object_id) === focusedAlertKey)
  if (focused) return focused
  return [...alerts].sort((a, b) => String(b.observed_at || '').localeCompare(String(a.observed_at || '')))[0] || null
}

function groupAlertsByMap(alerts) {
  const groups = new Map()

  for (const alert of alerts) {
    const key = `${normalize(alert.site_code)}::${normalize(alert.map_code)}`
    const current = groups.get(key)
    if (!current || String(alert.observed_at || '') > String(current.alert.observed_at || '')) {
      groups.set(key, { key, alert })
    }
  }

  return Array.from(groups.values()).sort((a, b) => a.key.localeCompare(b.key))
}

export default function SismicoAlertMiniMap() {
  const alerts = useSismicoRemotePolygonAlerts()
  const { focusedAlertKey } = useSismicoAlertFocus()
  const groups = useMemo(() => groupAlertsByMap(alerts), [alerts])
  const groupSignature = groups.map(({ key, alert }) => `${key}:${alert.map_object_id}:${alert.state_code}`).join('|')
  const [cycleIndex, setCycleIndex] = useState(0)

  useEffect(() => {
    setCycleIndex((current) => (current >= groups.length ? 0 : current))
  }, [groupSignature, groups.length])

  useEffect(() => {
    if (groups.length < 2) return undefined
    const timer = window.setInterval(() => {
      setCycleIndex((current) => (current + 1) % groups.length)
    }, 3000)
    return () => window.clearInterval(timer)
  }, [groupSignature, groups.length])

  const focusedAlert = useMemo(() => pickFocusedAlert(alerts, focusedAlertKey), [alerts, focusedAlertKey])
  const activeGroup = groups[cycleIndex] || groups[0]
  const alert = groups.length > 1 ? activeGroup?.alert || null : focusedAlert
  const displayCycle = groups.length > 1 ? `${Math.min(cycleIndex + 1, groups.length)} de ${groups.length} mapas en alerta` : null

  return (
    <VisualBox id="alert-map" label="Mapa 3D de alertas"><aside className={`sismico-alert-mini-map ${alert ? 'has-alert' : ''}`} aria-label="Mapa geológico 3D de alertas remotas">
      <Canvas
        className="sismico-alert-mini-map__canvas"
        camera={{ position: [180, 50, 42], fov: 50 }}
        dpr={[1, 1.5]}
        gl={{ alpha: true, antialias: true }}
      >
        <Suspense fallback={null}>
          <AlertModel alert={alert} />
          <OrbitControls enablePan={false} enableZoom={false} enableDamping dampingFactor={0.08} />
        </Suspense>
      </Canvas>
      {alert ? (
        <div className={`sismico-alert-mini-map__caption state-${alert.state_code}`} aria-live="polite">
          <span>{alert.state_label}</span>
          <strong>{alert.site_name}</strong>
          <small>{alert.polygon_name}</small>
          {displayCycle ? <em>{displayCycle}</em> : null}
        </div>
      ) : null}
    </aside></VisualBox>
  )
}

useGLTF.preload('/assets/models/tenientev2.glb')
