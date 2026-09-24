'use client';

import { Canvas, useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

function CardMesh({ sourceCanvas, reducedMotion, revision }) {
  const meshRef = useRef(null);
  const lightRef = useRef(null);
  const texture = useMemo(() => new THREE.CanvasTexture(sourceCanvas), [sourceCanvas]);
  const geometry = useMemo(
    () => new RoundedBoxGeometry(3.16, 1.992, 0.055, 8, 0.085),
    []
  );

  useEffect(() => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    return () => {
      texture.dispose();
      geometry.dispose();
    };
  }, [geometry, texture]);

  useEffect(() => {
    // Refresh once after the editor redraws its 2D artwork, not on every
    // animation frame (which would repeatedly upload a large mobile texture).
    texture.needsUpdate = true;
  }, [revision, texture]);

  useFrame(({ clock }, delta) => {
    if (!meshRef.current) return;
    const time = clock.getElapsedTime();
    const targetX = reducedMotion ? 0.06 : 0.065 + Math.sin(time * 0.42) * 0.075;
    const targetY = reducedMotion ? -0.12 : Math.sin(time * 0.58) * 0.19;
    const targetZ = reducedMotion ? 0 : Math.sin(time * 0.35) * 0.018;
    meshRef.current.rotation.x = THREE.MathUtils.damp(meshRef.current.rotation.x, targetX, 4, delta);
    meshRef.current.rotation.y = THREE.MathUtils.damp(meshRef.current.rotation.y, targetY, 4, delta);
    meshRef.current.rotation.z = THREE.MathUtils.damp(meshRef.current.rotation.z, targetZ, 4, delta);
    if (lightRef.current && !reducedMotion) {
      lightRef.current.position.x = Math.sin(time * 0.38) * 3.2;
      lightRef.current.position.y = 2.8 + Math.cos(time * 0.29) * 1.2;
    }
  });

  return (
    <>
      <ambientLight intensity={0.84} />
      <directionalLight ref={lightRef} position={[-2.6, 3.1, 4.2]} intensity={1.75} />
      <pointLight position={[2.2, -1.8, 2.7]} color="#9acbff" intensity={4.5} distance={8} />
      <mesh ref={meshRef} geometry={geometry} castShadow receiveShadow>
        <meshPhysicalMaterial
          map={texture}
          color="#ffffff"
          roughness={0.32}
          metalness={0.14}
          clearcoat={0.54}
          clearcoatRoughness={0.24}
          side={THREE.DoubleSide}
        />
      </mesh>
    </>
  );
}

export default function ThreeCardPreview({ sourceCanvas, revision = 0, onReady }) {
  const [reducedMotion, setReducedMotion] = useState(false);
  const readyRef = useRef(false);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);

  if (!sourceCanvas) return null;

  return (
    <div className="threeCardPreview" aria-label="Animated physical card preview">
      <Canvas
        camera={{ position: [0, 0, 3.55], fov: 38 }}
        dpr={[1, 1.35]}
        gl={{ alpha: true, antialias: true, powerPreference: 'low-power' }}
        fallback={<span className="threeCardFallback">Physical preview unavailable on this device.</span>}
        onCreated={() => {
          if (readyRef.current) return;
          readyRef.current = true;
          onReady?.();
        }}
      >
        <CardMesh sourceCanvas={sourceCanvas} reducedMotion={reducedMotion} revision={revision} />
      </Canvas>
    </div>
  );
}
