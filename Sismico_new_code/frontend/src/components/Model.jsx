import React, { useEffect, useRef } from 'react'
import { OrbitControls, useGLTF } from '@react-three/drei'
import { useThree } from '@react-three/fiber'

function MineModel({ onScene }) {
  const gltf = useGLTF('/assets/models/tenientev2.glb')
  useEffect(() => {
    if (gltf?.scene && onScene) onScene(gltf.scene)
  }, [gltf, onScene])
  return <primitive object={gltf.scene} scale={90} />
}

export default function ThreeDViewer({ selectedZone }) {
  const modelRef = useRef(null)
  const pointRef = useRef(null)
  const { camera } = useThree()

  useEffect(() => {
    camera.position.set(180, 50, 42)
    camera.lookAt(0, 0, 0)
  }, [camera])

  useEffect(() => {
    if (!modelRef.current || !selectedZone || !pointRef.current) return

    const rotations = {
      andes: 2 * Math.PI,
      andesita: (7 * Math.PI) / 6,
      diamante: Math.PI / 2,
      esmeralda: 2 * Math.PI,
      dacita: (3 * Math.PI) / 2,
      diablo: (3 * Math.PI) / 4,
      recursos: (5 * Math.PI) / 4,
      pacifico: Math.PI,
      tte4: Math.PI / 3,
      reservas: (7 * Math.PI) / 4,
      pilar_N: (7 * Math.PI) / 4,
      corbata: (7 * Math.PI) / 4,
      pipa_N: (5 * Math.PI) / 4,
    }

    const pointPositions = {
      andes: [43, -7, -5],
      andesita: [35, -7, 32],
      diamante: [50, -8, -4],
      esmeralda: [35, 10, 40],
      dacita: [45, 2, 5],
      diablo: [50, 1, -10],
      recursos: [60, 2, 60],
      pacifico: [40, 6, 10],
      tte4: [78, 18, 1],
      reservas: [60, 1, -15],
      pilar_N: [50, 1, 14],
      corbata: [30, 1, 2],
      pipa_N: [42, 6, 0],
    }

    const targetRotation = rotations[selectedZone]
    const targetPosition = pointPositions[selectedZone]
    if (targetRotation === undefined || targetPosition === undefined) return

    const duration = 500
    const startRotation = modelRef.current.rotation.y
    const startTime = performance.now()

    const animateRotation = () => {
      const elapsed = performance.now() - startTime
      const t = Math.min(elapsed / duration, 1)
      modelRef.current.rotation.y = startRotation + (targetRotation - startRotation) * t
      if (t < 1) {
        requestAnimationFrame(animateRotation)
      } else {
        pointRef.current.position.set(...targetPosition)
      }
    }
    animateRotation()
  }, [selectedZone])

  return (
    <>
      <ambientLight intensity={0.7} />
      <directionalLight position={[5, 10, 7.5]} intensity={1.1} />
      <MineModel onScene={(scene) => (modelRef.current = scene)} />
      <mesh ref={pointRef} position={[43, -7, -5]}>
        <sphereGeometry args={[3, 32, 32]} />
        <meshBasicMaterial color="red" />
      </mesh>
      <OrbitControls />
    </>
  )
}
