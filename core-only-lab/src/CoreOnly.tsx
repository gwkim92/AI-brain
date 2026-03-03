import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { ChromaticAberration, EffectComposer } from "@react-three/postprocessing";
import { BlendFunction } from "postprocessing";
import * as THREE from "three";

const PARTICLE_COUNT = 140000;

type RenderSupport = "probing" | "ready" | "unsupported";

function pseudoRandom(index: number): number {
  const x = Math.sin(index * 12.9898) * 43758.5453123;
  return x - Math.floor(x);
}

function resolveSupport(): RenderSupport {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return "unsupported";
  }

  const canvas = document.createElement("canvas");
  const gl2 = canvas.getContext("webgl2", { alpha: true, antialias: false, powerPreference: "high-performance" });
  if (gl2) {
    return "ready";
  }

  const gl1 = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
  return gl1 ? "ready" : "unsupported";
}

const vertexShader = `
attribute float aSeed;
uniform float uTime;
uniform vec2 uPointer;
varying float vDepth;
varying float vPulse;

void main() {
  float t = uTime;
  vec3 p = position;

  float radialPulse = sin(t * 1.2 + aSeed * 27.0) * 0.22;
  p += normalize(p) * radialPulse;

  float torsion = sin(t * 0.7 + p.y * 1.5 + aSeed * 13.0) * 0.42;
  float c = cos(torsion);
  float s = sin(torsion);
  mat2 rot = mat2(c, -s, s, c);
  p.xz = rot * p.xz;

  float orbit = sin(t * 0.45 + aSeed * 9.0);
  p.x += orbit * 0.35;
  p.z += cos(t * 0.52 + aSeed * 11.0) * 0.35;

  p.x += uPointer.x * (0.55 + 0.25 * sin(aSeed * 15.0));
  p.y += uPointer.y * (0.55 + 0.25 * cos(aSeed * 19.0));

  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;

  float depth = clamp((-mvPosition.z - 1.0) / 24.0, 0.0, 1.0);
  vDepth = depth;
  vPulse = 0.5 + 0.5 * sin(t * 1.7 + aSeed * 41.0);

  gl_PointSize = (15.0 + vPulse * 8.0) / max(-mvPosition.z, 0.1);
}
`;

const fragmentShader = `
varying float vDepth;
varying float vPulse;

void main() {
  float d = distance(gl_PointCoord, vec2(0.5));
  if (d > 0.5) {
    discard;
  }

  float glow = pow(1.0 - d * 2.0, 2.1);
  vec3 inner = vec3(0.62, 0.97, 1.0);
  vec3 mid = vec3(0.0, 0.96, 1.0);
  vec3 outer = vec3(0.01, 0.24, 0.6);

  vec3 color = mix(outer, mid, smoothstep(0.08, 0.9, vDepth));
  color = mix(color, inner, 0.26 * vPulse);
  color += vec3(0.06, 0.14, 0.18) * vPulse;

  gl_FragColor = vec4(color, glow * 0.86);
}
`;

function FullQualityCoreSurface() {
  const pointsRef = useRef<THREE.Points>(null);

  const { geometry, material } = useMemo(() => {
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const seeds = new Float32Array(PARTICLE_COUNT);

    for (let i = 0; i < PARTICLE_COUNT; i += 1) {
      const u = pseudoRandom(i * 3 + 1);
      const v = pseudoRandom(i * 3 + 2);
      const w = pseudoRandom(i * 3 + 3);

      const r = 6.2 * Math.cbrt(u);
      const theta = 2 * Math.PI * v;
      const phi = Math.acos(2 * w - 1);

      const i3 = i * 3;
      positions[i3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i3 + 1] = r * Math.cos(phi);
      positions[i3 + 2] = r * Math.sin(phi) * Math.sin(theta);
      seeds[i] = pseudoRandom(i * 7 + 5);
    }

    const pointGeometry = new THREE.BufferGeometry();
    pointGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    pointGeometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));

    const pointMaterial = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uPointer: { value: new THREE.Vector2(0, 0) },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    return { geometry: pointGeometry, material: pointMaterial };
  }, []);

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  const pointerTarget = useMemo(() => new THREE.Vector2(), []);

  useFrame((state) => {
    const pointMaterial = pointsRef.current?.material as THREE.ShaderMaterial | undefined;
    if (!pointMaterial) {
      return;
    }

    pointMaterial.uniforms.uTime.value = state.clock.elapsedTime;

    pointerTarget.set(state.pointer.x, state.pointer.y);
    const pointerUniform = pointMaterial.uniforms.uPointer.value as THREE.Vector2;
    pointerUniform.lerp(pointerTarget, 0.08);

    if (pointsRef.current) {
      const t = state.clock.elapsedTime;
      pointsRef.current.rotation.y = t * 0.1;
      pointsRef.current.rotation.x = Math.sin(t * 0.27) * 0.15;
    }
  });

  return <points ref={pointsRef} geometry={geometry} material={material} />;
}

export function CoreOnly() {
  const [support, setSupport] = useState<RenderSupport>("probing");
  const [runtimeError, setRuntimeError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSupport(resolveSupport());
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  if (support === "probing") {
    return <div className="core-status">GPU probing...</div>;
  }

  if (support === "unsupported") {
    return <div className="core-status core-status-error">WebGL is unavailable in this environment.</div>;
  }

  if (runtimeError) {
    return <div className="core-status core-status-error">{runtimeError}</div>;
  }

  return (
    <div className="core-root">
      <Canvas
        camera={{ position: [0, 0, 16], fov: 43 }}
        gl={{ antialias: false, alpha: true, powerPreference: "high-performance" }}
        dpr={[1, 2]}
        style={{ width: "100%", height: "100%" }}
        onCreated={({ gl }) => {
          gl.domElement.addEventListener(
            "webglcontextlost",
            (event) => {
              event.preventDefault();
              setRuntimeError("WebGL context lost. Reload the page.");
            },
            { once: true },
          );
        }}
      >
        <FullQualityCoreSurface />

        <EffectComposer enableNormalPass={false} multisampling={0}>
          <ChromaticAberration offset={new THREE.Vector2(0.0028, 0.0028)} blendFunction={BlendFunction.NORMAL} />
        </EffectComposer>
      </Canvas>
    </div>
  );
}
