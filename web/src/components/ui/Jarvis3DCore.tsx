"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { EffectComposer, DepthOfField, ChromaticAberration } from "@react-three/postprocessing";
import { BlendFunction } from "postprocessing";
import type { Jarvis3DBaseMode, Jarvis3DOverlayFx } from "@/lib/visual-core/types";
import {
    type VisualCoreEngine,
    type VisualCoreFailureCode,
    type WebGlRenderTier,
    getFallbackEngine,
    getInitialCoreEngine,
    parseForcedCoreEngine,
    shouldRetryGpgpu,
} from "@/lib/visual-core/runtime";
import { classifyGpgpuSample, isSampleStalled } from "@/lib/visual-core/health";
import { emitRuntimeEvent } from "@/lib/runtime-events";
import { isFeatureEnabled } from "@/lib/feature-flags";

const SIZE = 512;
const TOTAL_PARTICLES = SIZE * SIZE;
export type VisualCoreRuntimeStatus = "probing" | "ready" | "fallback";
export type VisualCoreRuntimeReason =
    | "capability_probe_pending"
    | "ok"
    | "stable_mode"
    | "lite_mode"
    | "cpu_mode"
    | "forced_engine"
    | "webgl_unavailable"
    | "canvas_runtime_error";
export const VISUAL_CORE_RUNTIME_STATUS_EVENT = "jarvis.visual_core.runtime_status";

export type CoreHealthSnapshot = {
    engine: VisualCoreEngine;
    isHealthy: boolean;
    failureCode: VisualCoreFailureCode;
    frameAgeMs: number;
};

const GPGPU_HEALTH_CHECK_INTERVAL_MS = 450;
const GPGPU_STALLED_THRESHOLD = 4;
const GPGPU_RECOVERY_RETRY_DELAY_MS = 12000;
const ENGINE_CROSSFADE_MS = 280;

function radicalInverseVdC(index: number): number {
    let bits = index;
    bits = ((bits << 16) | (bits >>> 16)) >>> 0;
    bits = (((bits & 0x55555555) << 1) | ((bits & 0xaaaaaaaa) >>> 1)) >>> 0;
    bits = (((bits & 0x33333333) << 2) | ((bits & 0xcccccccc) >>> 2)) >>> 0;
    bits = (((bits & 0x0f0f0f0f) << 4) | ((bits & 0xf0f0f0f0) >>> 4)) >>> 0;
    bits = (((bits & 0x00ff00ff) << 8) | ((bits & 0xff00ff00) >>> 8)) >>> 0;
    return bits * 2.3283064365386963e-10;
}

function resolveWebGlRenderTier(): WebGlRenderTier {
    if (typeof window === "undefined" || typeof document === "undefined") {
        return "fallback";
    }

    const canvas = document.createElement("canvas");
    const attrs: WebGLContextAttributes = {
        alpha: true,
        antialias: false,
        powerPreference: "default",
    };

    const contextWebGl2 = canvas.getContext("webgl2", attrs) as WebGL2RenderingContext | null;
    if (contextWebGl2) {
        const maxTextureSize = Number(contextWebGl2.getParameter(contextWebGl2.MAX_TEXTURE_SIZE) ?? 0);
        const maxVertexTextureUnits = Number(contextWebGl2.getParameter(contextWebGl2.MAX_VERTEX_TEXTURE_IMAGE_UNITS) ?? 0);
        const hasFloatColorBuffer = Boolean(contextWebGl2.getExtension("EXT_color_buffer_float"));
        if (maxTextureSize >= SIZE && maxVertexTextureUnits > 0 && hasFloatColorBuffer) {
            return "full";
        }
        return "lite";
    }

    const contextWebGl =
        (canvas.getContext("webgl", attrs) as WebGLRenderingContext | null) ??
        (canvas.getContext("experimental-webgl", attrs) as WebGLRenderingContext | null);
    if (!contextWebGl) {
        return "fallback";
    }

    const maxTextureSize = Number(contextWebGl.getParameter(contextWebGl.MAX_TEXTURE_SIZE) ?? 0);
    const maxVertexTextureUnits = Number(contextWebGl.getParameter(contextWebGl.MAX_VERTEX_TEXTURE_IMAGE_UNITS) ?? 0);
    const hasFloatTexture = Boolean(contextWebGl.getExtension("OES_texture_float"));
    const hasFloatColorBuffer = Boolean(
        contextWebGl.getExtension("WEBGL_color_buffer_float") ??
        contextWebGl.getExtension("EXT_color_buffer_half_float")
    );

    if (maxTextureSize >= SIZE && maxVertexTextureUnits > 0 && hasFloatTexture && hasFloatColorBuffer) {
        return "full";
    }
    return "lite";
}

type CanvasRuntimeBoundaryProps = {
    children: React.ReactNode;
    onError: (error: Error) => void;
};

type CanvasRuntimeBoundaryState = {
    hasError: boolean;
};

class CanvasRuntimeBoundary extends React.Component<CanvasRuntimeBoundaryProps, CanvasRuntimeBoundaryState> {
    constructor(props: CanvasRuntimeBoundaryProps) {
        super(props);
        this.state = { hasError: false };
    }

    static getDerivedStateFromError(): CanvasRuntimeBoundaryState {
        return { hasError: true };
    }

    componentDidCatch(error: Error) {
        this.props.onError(error);
    }

    render() {
        if (this.state.hasError) {
            return null;
        }
        return this.props.children;
    }
}

// ==========================================
// 1. GLSL SHADER CODE (Mathematical Core)
// ==========================================

const snoise3GLSL = `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise3(vec3 v) {
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);

  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);

  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;

  i = mod289(i);
  vec4 p = permute(permute(permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0));

  vec4 j = p - 49.0 * floor(p * (1.0 / 49.0));

  vec4 x_ = floor(j * (1.0 / 7.0));
  vec4 y_ = floor(j - 7.0 * x_);

  vec4 x = x_ * (2.0 / 7.0) + 0.5 / 7.0 - 1.0;
  vec4 y = y_ * (2.0 / 7.0) + 0.5 / 7.0 - 1.0;

  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);

  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;

  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);

  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;

  vec4 m = max(0.5 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  m = m * m;

  vec4 px = vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3));
  return 42.0 * dot(m, px);
}
`;

const curlNoiseGLSL = `
vec3 snoiseVec3(vec3 x) {
  float s  = snoise3(vec3( x ));
  float s1 = snoise3(vec3( x.y - 19.1 , x.z + 33.4 , x.x + 47.2 ));
  float s2 = snoise3(vec3( x.z + 74.2 , x.x - 124.5 , x.y + 99.4 ));
  return vec3( s , s1 , s2 );
}

vec3 snoiseVec3(vec3 step, vec3 x) {
  vec3 s0 = snoiseVec3(x);
  vec3 s1 = snoiseVec3(x + step * vec3(1.0, 0.0, 0.0));
  vec3 s2 = snoiseVec3(x + step * vec3(0.0, 1.0, 0.0));
  vec3 s3 = snoiseVec3(x + step * vec3(0.0, 0.0, 1.0));
  return vec3(s1.x - s0.x, s2.y - s0.y, s3.z - s0.z); 
}

vec3 curlNoise(vec3 p) {
  const float e = .1;
  vec3 dx = vec3( e   , 0.0 , 0.0 );
  vec3 dy = vec3( 0.0 , e   , 0.0 );
  vec3 dz = vec3( 0.0 , 0.0 , e   );

  vec3 p_x0 = snoiseVec3( p - dx );
  vec3 p_x1 = snoiseVec3( p + dx );
  vec3 p_y0 = snoiseVec3( p - dy );
  vec3 p_y1 = snoiseVec3( p + dy );
  vec3 p_z0 = snoiseVec3( p - dz );
  vec3 p_z1 = snoiseVec3( p + dz );

  float x = p_y1.z - p_y0.z - p_z1.y + p_z0.y;
  float y = p_z1.x - p_z0.x - p_x1.z + p_x0.z;
  float z = p_x1.y - p_x0.y - p_y1.x + p_y0.x;

  const float divisor = 1.0 / ( 2.0 * e );
  return safeNormalize( vec3( x , y , z ) * divisor );
}
`;

const sdfMathGLSL = `
float sdSphere(vec3 p, float s) { return length(p) - s; }
float sdTorus(vec3 p, vec2 t) { vec2 q = vec2(length(p.xz)-t.x,p.y); return length(q)-t.y; }
float sdOctahedron(vec3 p, float s) { p = abs(p); return (p.x+p.y+p.z-s)*0.57735027; }

float sdBrain(vec3 p) {
    vec3 p1 = p; p1.x -= 2.0;
    vec3 p2 = p; p2.x += 2.0;
    float d1 = sdSphere(p1, 3.5);
    float d2 = sdSphere(p2, 3.5);
    float base = min(d1, d2);
    float folds = sin(p.x*2.0)*sin(p.y*2.0)*sin(p.z*2.0) * 0.8;
    return base + folds;
}
float sdInfinity(vec3 p) {
    vec3 p1 = p; p1.x -= 2.5; 
    vec3 p2 = p; p2.x += 2.5;
    float d1 = sdTorus(p1, vec2(2.5, 0.8));
    float d2 = sdTorus(p2, vec2(2.5, 0.8));
    return min(d1, d2);
}
float sdEye(vec3 p) {
    float ring = length(vec2(length(p.xy)-4.5, p.z)) - 0.4;
    float pupil = sdSphere(p, 1.5);
    return min(ring, pupil);
}
float sdCrystal(vec3 p) {
    return sdOctahedron(p, 5.0);
}
`;

const simFragmentShader = `
uniform float uTime;
uniform float uSpeed;
uniform vec3 uTarget;
uniform float uTargetActive;

// Toggle Uniforms
uniform float uSdfMorph;
uniform float uShapeId;
uniform float uMultiAttractor;

varying vec2 vUv;
uniform sampler2D positions;
uniform sampler2D defaultPositions;

vec3 safeNormalize(vec3 v) {
    float lenSq = dot(v, v);
    if (lenSq <= 0.0000001) {
        return vec3(0.0);
    }
    return v * inversesqrt(lenSq);
}

// Inject algorithms
${snoise3GLSL}
${curlNoiseGLSL}
${sdfMathGLSL}

float getSceneSDF(vec3 p, float shapeId) {
    if (shapeId < 0.5) return sdBrain(p);
    if (shapeId < 1.5) return sdInfinity(p);
    if (shapeId < 2.5) return sdEye(p);
    return sdCrystal(p);
}

vec3 getSdfNormal(vec3 p, float shapeId) {
    vec2 e = vec2(0.01, 0.0);
    return safeNormalize(vec3(
        getSceneSDF(p + e.xyy, shapeId) - getSceneSDF(p - e.xyy, shapeId),
        getSceneSDF(p + e.yxy, shapeId) - getSceneSDF(p - e.yxy, shapeId),
        getSceneSDF(p + e.yyx, shapeId) - getSceneSDF(p - e.yyx, shapeId)
    ));
}

vec3 getSdfTarget(vec3 p, float shapeId) {
    vec3 n = getSdfNormal(p, shapeId);
    float d = getSceneSDF(p, shapeId);
    return p - n * d;
}

void main() {
    vec3 pos = texture2D(positions, vUv).xyz;
    vec3 dPos = texture2D(defaultPositions, vUv).xyz;

    // Evaluate the SDF state early to use its normal for other forces
    vec3 sdfNormal = vec3(0.0);
    if (uSdfMorph > 0.0) {
        sdfNormal = getSdfNormal(pos, uShapeId);
    }

    // 1. Return-to-base force (Gravity to origin sphere)
    vec3 dirOrigin = safeNormalize(dPos - pos);
    float distOrigin = length(dPos - pos);
    // Smoothly disable return force when SDF forms so they don't clump at the center!
    vec3 forceOrigin = dirOrigin * distOrigin * 0.5 * (1.0 - uSdfMorph);

    // 2. Curl Noise Turbulance (The Fluid dynamics)
    // Smoothly disable chaotic 3D vortex noise when SDF forms to retain perfect shapes!
    vec3 curlForce = curlNoise(pos * 0.5 + uTime * 0.2) * 1.5 * (1.0 - uSdfMorph);

    // 3. Tornado Target Gravity (When a stream is active)
    vec3 forceTarget = vec3(0.0);
    if(uTargetActive > 0.0) {
        vec3 dirTarget = safeNormalize(uTarget - pos);
        float distTarget = length(uTarget - pos);
        
        // Swirl around the target
        vec3 swirl = cross(dirTarget, vec3(0.0, 1.0, 0.0));
        forceTarget = (dirTarget * 5.0 + swirl * 2.0) * (2.0 / max(distTarget, 0.1));
    }

    // 5. Multi-Attractor Synapse Force
    vec3 forceMulti = vec3(0.0);
    if (uMultiAttractor > 0.0) {
        float pId = fract(dPos.x * 123.456 + dPos.y * 789.012);
        float angle = floor(pId * 5.0) * 6.28318 / 5.0;
        vec3 targetNode = vec3(cos(angle)*7.0, sin(angle*3.0)*2.0, sin(angle)*7.0);
        vec3 dirNode = safeNormalize(targetNode - pos);
        float distNode = length(targetNode - pos);
        vec3 swirl = cross(dirNode, vec3(0.0, 1.0, 0.0));
        forceMulti = (dirNode * 4.0 + swirl * 2.0) * (1.0 / max(distNode, 0.5));
    }

    // 6. Surface Flow for SDFs (Organic movement along the manifold)
    vec3 surfaceFlow = vec3(0.0);
    if (uSdfMorph > 0.0) {
        // Cross product of Normal and Up-vector creates a perfect surface swirl
        vec3 swirlDir = cross(sdfNormal, vec3(0.0, 1.0, 0.0));
        float noise = snoise3(pos * 2.0 + uTime * 0.5); 
        surfaceFlow = swirlDir * (1.5 + noise * 1.0);
        
        // Add a secondary organic axis for complex sliding
        surfaceFlow += cross(sdfNormal, safeNormalize(pos + vec3(0.1))) * 1.0;
    }

    // Combine remaining active forces (SDF logic is strictly handled by Position Lerping below)
    vec3 totalVelocity = (forceOrigin * 0.8 * (1.0 - uMultiAttractor)) 
                       + (curlForce * 1.2) 
                       + (forceTarget * uTargetActive) 
                       + (surfaceFlow * uSdfMorph)
                       + (forceMulti * uMultiAttractor);
    
    // Add velocity to position
    pos += totalVelocity * uSpeed * 0.016; // Assuming 60fps delta 

    // DIRECT POSITION CORRECTION for SDF (Absolute Stability)
    if (uSdfMorph > 0.0) {
        vec3 idealSurfacePos = getSdfTarget(pos, uShapeId);
        // Lerp position strictly toward the true mathematical surface
        pos = mix(pos, idealSurfacePos, uSdfMorph * 0.2); 
    }

    // Soft bounds, pull hard inside if far
    if(length(pos) > 12.0) {
        pos *= 0.95;
    }

    gl_FragColor = vec4(pos, 1.0);
}
`;

const renderVertexShader = `
uniform sampler2D positions;
uniform float uTime;
varying float vDistance;
uniform float uRipple;
uniform float uPointScale;

void main() {
    vec3 pos = texture2D(positions, position.xy).xyz;
    
    // Wave ripple effect
    if (uRipple > 0.0) {
        float d = length(pos.xz);
        pos.y += sin(d * 3.0 - uTime * 5.0) * uRipple * 1.5;
    }

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    
    vDistance = length(pos);

    gl_PointSize = (uPointScale / -mvPosition.z);
    // Add random variation to size
    gl_PointSize *= (0.5 + fract(sin(dot(position.xy, vec2(12.9898,78.233))) * 43758.5453) * 1.0);
}
`;

const renderFragmentShader = `
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uAlphaGain;
varying float vDistance;

void main() {
    float r = distance(gl_PointCoord, vec2(0.5));
    if(r > 0.5) discard;
    
    // Soft particle glow
    float alpha = (0.5 - r) * 2.0;

    // Mix color based on distance from core
    vec3 finalColor = mix(uColorA, uColorB, smoothstep(0.0, 6.0, vDistance));

    // Increase core brightness
    if(vDistance < 2.0) {
        finalColor += vec3(1.0) * (1.0 - vDistance/2.0); 
    }

    gl_FragColor = vec4(finalColor, alpha * uAlphaGain);
}
`;


// ==========================================
// 3. REACT THREE FIBER COMPONENTS
// ==========================================

const GPGPUFluidCore = ({
    baseMode,
    overlayFx,
    active,
    highVisibility,
    onHealthSnapshot,
}: {
    baseMode: Jarvis3DBaseMode;
    overlayFx: Jarvis3DOverlayFx[];
    active: boolean;
    highVisibility: boolean;
    onHealthSnapshot: (snapshot: CoreHealthSnapshot) => void;
}) => {
    const { gl } = useThree();

    const initialPositions = useMemo(() => {
        const data = new Float32Array(TOTAL_PARTICLES * 4);
        for (let i = 0; i < TOTAL_PARTICLES; i++) {
            // Deterministic low-discrepancy distribution in a solid sphere.
            const u = radicalInverseVdC(i + 1);
            const v = radicalInverseVdC((i + 1) * 3);
            const w = radicalInverseVdC((i + 1) * 5);
            const r = 5.0 * Math.cbrt(u);
            const theta = v * 2 * Math.PI;
            const phi = Math.acos(2 * w - 1);

            data[i * 4] = r * Math.sin(phi) * Math.cos(theta);
            data[i * 4 + 1] = r * Math.sin(phi) * Math.sin(theta);
            data[i * 4 + 2] = r * Math.cos(phi);
            data[i * 4 + 3] = 1.0;
        }
        const texture = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat, THREE.FloatType);
        texture.needsUpdate = true;
        return texture;
    }, []);

    const fboVars = useMemo(() => {
        const read = new THREE.WebGLRenderTarget(SIZE, SIZE, {
            minFilter: THREE.NearestFilter,
            magFilter: THREE.NearestFilter,
            format: THREE.RGBAFormat,
            type: THREE.FloatType,
            depthBuffer: false,
            stencilBuffer: false,
        });
        const write = read.clone();

        const simMat = new THREE.ShaderMaterial({
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = vec4(position, 1.0);
                }
            `,
            fragmentShader: simFragmentShader,
            uniforms: {
                positions: { value: initialPositions },
                defaultPositions: { value: initialPositions },
                uTime: { value: 0 },
                uSpeed: { value: 1.0 },
                uTarget: { value: new THREE.Vector3(0, 0, 0) },
                uTargetActive: { value: 0.0 },
                uSdfMorph: { value: 0.0 },
                uShapeId: { value: 0.0 },
                uMultiAttractor: { value: 0.0 },
            }
        });

        const renderMat = new THREE.ShaderMaterial({
            vertexShader: renderVertexShader,
            fragmentShader: renderFragmentShader,
            uniforms: {
                positions: { value: initialPositions },
                uTime: { value: 0 },
                uColorA: { value: new THREE.Color("#00FFFF") }, // Cyan Base
                uColorB: { value: new THREE.Color("#0000FF") }, // Deep Blue Core
                uRipple: { value: 0.0 },
                uPointScale: { value: 15.0 },
                uAlphaGain: { value: 0.6 },
            },
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        return { read, write, simMat, renderMat };
    }, [initialPositions]);
    const fboVarsRef = React.useRef(fboVars);
    const bootstrappedRef = React.useRef(false);
    const bootstrapStepRef = React.useRef(0);
    const healthSampleRef = React.useRef<Float32Array>(new Float32Array(4));
    const previousSampleRef = React.useRef<Float32Array | null>(null);
    const lastHealthCheckAtRef = React.useRef(0);
    const stalledCountRef = React.useRef(0);
    const lastHealthyAtRef = React.useRef(0);

    const scene = useMemo(() => {
        const renderScene = new THREE.Scene();
        const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), fboVars.simMat);
        renderScene.add(mesh);
        return { renderScene, camera, mesh };
    }, [fboVars.simMat]);

    const particlesGeometry = useMemo(() => {
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(TOTAL_PARTICLES * 3);
        for (let i = 0; i < SIZE; i++) {
            for (let j = 0; j < SIZE; j++) {
                const index = (i * SIZE + j) * 3;
                positions[index] = j / (SIZE - 1);
                positions[index + 1] = i / (SIZE - 1);
                positions[index + 2] = 0;
            }
        }
        geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        return geometry;
    }, []);

    useEffect(() => {
        fboVarsRef.current = fboVars;
        bootstrappedRef.current = false;
        bootstrapStepRef.current = 0;
        if (lastHealthyAtRef.current === 0) {
            lastHealthyAtRef.current = Date.now();
        }
    }, [fboVars]);

    useEffect(() => {
        return () => {
            particlesGeometry.dispose();
            scene.mesh.geometry.dispose();
            fboVars.read.dispose();
            fboVars.write.dispose();
            fboVars.simMat.dispose();
            fboVars.renderMat.dispose();
            initialPositions.dispose();
        };
    }, [fboVars, initialPositions, particlesGeometry, scene.mesh.geometry]);

    const targetVec = useMemo(() => new THREE.Vector3(), []);
    const targetColorA = useMemo(() => new THREE.Color(), []);
    const targetColorB = useMemo(() => new THREE.Color(), []);
    useFrame((state) => {
        const vars = fboVarsRef.current;

        // Apply Demo State Overrides Smoothly (Lerp uniforms for fluid transitions)
        vars.simMat.uniforms.uSpeed.value = THREE.MathUtils.lerp(
            vars.simMat.uniforms.uSpeed.value,
            baseMode === "risk" ? 3.0 : 1.0,
            0.05
        );

        const isSdf = baseMode.startsWith("sdf_");
        if (isSdf) {
            if (baseMode === "sdf_brain") vars.simMat.uniforms.uShapeId.value = 0.0;
            else if (baseMode === "sdf_infinity") vars.simMat.uniforms.uShapeId.value = 1.0;
            else if (baseMode === "sdf_eye") vars.simMat.uniforms.uShapeId.value = 2.0;
            else if (baseMode === "sdf_crystal") vars.simMat.uniforms.uShapeId.value = 3.0;
        }

        vars.simMat.uniforms.uSdfMorph.value = THREE.MathUtils.lerp(
            vars.simMat.uniforms.uSdfMorph.value,
            isSdf ? 1.0 : 0.0,
            0.05
        );

        vars.simMat.uniforms.uTargetActive.value = THREE.MathUtils.lerp(
            vars.simMat.uniforms.uTargetActive.value,
            baseMode === "stream" ? 1.0 : 0.0,
            0.05
        );

        vars.simMat.uniforms.uMultiAttractor.value = THREE.MathUtils.lerp(
            vars.simMat.uniforms.uMultiAttractor.value,
            baseMode === "multi_attractor" ? 1.0 : 0.0,
            0.05
        );

        const rippleActive = overlayFx.includes("event_ripple");
        vars.renderMat.uniforms.uRipple.value = THREE.MathUtils.lerp(
            vars.renderMat.uniforms.uRipple.value,
            rippleActive ? 1.0 : 0.0,
            0.05
        );
        vars.renderMat.uniforms.uPointScale.value = THREE.MathUtils.lerp(
            vars.renderMat.uniforms.uPointScale.value,
            highVisibility ? 18 : 15,
            0.08
        );
        vars.renderMat.uniforms.uAlphaGain.value = THREE.MathUtils.lerp(
            vars.renderMat.uniforms.uAlphaGain.value,
            highVisibility ? 0.9 : 0.6,
            0.08
        );

        targetColorA.set(baseMode === "risk" ? "#FF0044" : "#00FFFF");
        targetColorB.set(baseMode === "risk" ? "#440000" : "#0000FF");
        vars.renderMat.uniforms.uColorA.value.lerp(targetColorA, 0.05);
        vars.renderMat.uniforms.uColorB.value.lerp(targetColorB, 0.05);

        targetVec.set(
            (state.pointer.x * state.viewport.width) / 2,
            (state.pointer.y * state.viewport.height) / 2,
            0
        );
        vars.simMat.uniforms.uTarget.value.lerp(targetVec, 0.1);

        // 1. Run Simulation (Render to 'write' FBO)
        vars.simMat.uniforms.uTime.value = state.clock.elapsedTime;
        // Keep a deterministic seed for first boot frames to prevent zero-vector bootstrap spikes.
        vars.simMat.uniforms.positions.value = bootstrapStepRef.current >= 2 ? vars.read.texture : initialPositions;

        gl.setRenderTarget(vars.write);
        gl.render(scene.renderScene, scene.camera);
        gl.setRenderTarget(null);

        // 2. Set Render Mat to use new positions
        vars.renderMat.uniforms.positions.value = vars.write.texture;
        vars.renderMat.uniforms.uTime.value = state.clock.elapsedTime;

        // 3. Swap ping-pong buffers
        const temp = vars.read;
        vars.read = vars.write;
        vars.write = temp;
        bootstrappedRef.current = true;
        bootstrapStepRef.current += 1;

        if (!active) {
            return;
        }

        const now = Date.now();
        if (now - lastHealthCheckAtRef.current < GPGPU_HEALTH_CHECK_INTERVAL_MS) {
            return;
        }
        lastHealthCheckAtRef.current = now;

        try {
            const sx = (Math.floor(state.clock.elapsedTime * 97) % SIZE + SIZE) % SIZE;
            const sy = (Math.floor(state.clock.elapsedTime * 193) % SIZE + SIZE) % SIZE;
            gl.readRenderTargetPixels(vars.read, sx, sy, 1, 1, healthSampleRef.current);

            let failureCode = classifyGpgpuSample(healthSampleRef.current);
            if (failureCode === "none" && isSampleStalled(healthSampleRef.current, previousSampleRef.current)) {
                stalledCountRef.current += 1;
                if (stalledCountRef.current >= GPGPU_STALLED_THRESHOLD) {
                    failureCode = "gpgpu_health_stalled";
                }
            } else if (failureCode === "none") {
                stalledCountRef.current = 0;
            }

            previousSampleRef.current = new Float32Array(healthSampleRef.current);

            if (failureCode === "none") {
                lastHealthyAtRef.current = now;
            }

            onHealthSnapshot({
                engine: "gpgpu",
                isHealthy: failureCode === "none",
                failureCode,
                frameAgeMs: now - lastHealthyAtRef.current,
            });
        } catch {
            onHealthSnapshot({
                engine: "gpgpu",
                isHealthy: false,
                failureCode: "gpgpu_health_readback_error",
                frameAgeMs: Date.now() - lastHealthyAtRef.current,
            });
        }
    });

    return <points geometry={particlesGeometry} material={fboVars.renderMat} />;
};


// Main Export Component
interface Jarvis3DCoreProps {
    hideUI?: boolean;
    baseMode?: Jarvis3DBaseMode;
    overlayFx?: Jarvis3DOverlayFx[];
    highVisibility?: boolean;
}

const MANUAL_RIPPLE_DURATION_MS = 1300;

export interface CoreRendererProps {
    baseMode: Jarvis3DBaseMode;
    overlayFx: Jarvis3DOverlayFx[];
    highVisibility?: boolean;
}

function resolveModeColor(baseMode: Jarvis3DBaseMode): { primary: string; secondary: string } {
    if (baseMode === "risk") {
        return { primary: "#ff406f", secondary: "#4a000e" };
    }
    if (baseMode === "stream") {
        return { primary: "#32e6ff", secondary: "#0b245d" };
    }
    if (baseMode.startsWith("sdf_")) {
        return { primary: "#a5a9ff", secondary: "#191947" };
    }
    if (baseMode === "multi_attractor") {
        return { primary: "#58bbff", secondary: "#12224f" };
    }
    if (baseMode === "cinematic_dof") {
        return { primary: "#8ad8ff", secondary: "#081128" };
    }
    return { primary: "#00ffff", secondary: "#001a46" };
}

function resolveModeId(baseMode: Jarvis3DBaseMode): number {
    if (baseMode === "default") return 0;
    if (baseMode === "stream") return 1;
    if (baseMode === "risk") return 2;
    if (baseMode === "sdf_brain") return 3;
    if (baseMode === "sdf_infinity") return 4;
    if (baseMode === "sdf_eye") return 5;
    if (baseMode === "sdf_crystal") return 6;
    if (baseMode === "multi_attractor") return 7;
    return 8;
}

const stableVertexShader = `
uniform float uTime;
uniform float uMode;
uniform float uRipple;
uniform float uPointScale;
varying float vMix;

vec3 safeNormalize(vec3 v) {
  float lenSq = dot(v, v);
  if (lenSq <= 0.0000001) {
    return vec3(0.0, 0.0, 1.0);
  }
  return v * inversesqrt(lenSq);
}

vec3 morphMode(vec3 p, float mode, float t) {
  if (mode < 0.5) {
    vec3 tangent = safeNormalize(vec3(-p.z, 0.2 + p.y * 0.2, p.x));
    p += tangent * (0.4 + sin(t * 0.8 + length(p) * 2.2) * 0.2);
    return p;
  }
  if (mode < 1.5) {
    float r = max(0.65, length(p.xz) * 0.35);
    float a = atan(p.z, p.x) + t * 1.4 + p.y * 0.24;
    return vec3(cos(a) * r, p.y * 1.65 + sin(t * 2.0 + r) * 0.55, sin(a) * r);
  }
  if (mode < 2.5) {
    vec3 n = safeNormalize(p);
    float pulse = 5.2 + sin(t * 5.2 + dot(p, vec3(2.1, 2.4, 2.7))) * 0.45;
    return n * pulse;
  }
  if (mode < 3.5) {
    vec3 q = p;
    q.x += sign(p.x) * 1.9;
    vec3 n = safeNormalize(q);
    float fold = sin((p.y + p.z) * 7.0 + t * 1.6) * 0.22;
    return n * (4.65 + fold);
  }
  if (mode < 4.5) {
    float a = atan(p.z, p.x);
    float ring = 4.0 + 1.7 * sign(cos(a * 2.0));
    float y = sin(a * 2.0 + t * 0.65) * 0.75 + p.y * 0.25;
    return vec3(cos(a) * ring, y, sin(a) * ring);
  }
  if (mode < 5.5) {
    vec3 q = p;
    q.y *= 0.42;
    float shell = length(q) * 0.95;
    vec3 n = safeNormalize(q);
    float iris = sin((atan(p.z, p.x) * 8.0) + t * 0.9) * 0.24;
    return n * (4.4 + iris) + vec3(0.0, sin(shell + t * 1.4) * 0.4, 0.0);
  }
  if (mode < 6.5) {
    vec3 n = safeNormalize(sign(p) * pow(abs(p), vec3(0.55)));
    float shimmer = sin(dot(p, vec3(6.0, 5.0, 4.0)) + t * 1.5) * 0.2;
    return n * (5.1 + shimmer);
  }
  if (mode < 7.5) {
    float node = floor(fract(dot(p, vec3(12.91, 41.63, 27.17))) * 5.0);
    float angle = node * 6.2831853 / 5.0;
    vec3 attractor = vec3(cos(angle) * 5.4, sin(angle * 1.8) * 1.5, sin(angle) * 5.4);
    return mix(p * 0.35, attractor + safeNormalize(p - attractor) * 0.9, 0.62);
  }

  vec3 n = safeNormalize(p);
  return n * (4.75 + sin(t * 0.8 + p.y * 2.0) * 0.3);
}

void main() {
  vec3 transformed = morphMode(position, uMode, uTime);
  if (uRipple > 0.001) {
    float d = length(transformed.xz);
    transformed.y += sin(d * 2.7 - uTime * 5.8) * uRipple * 1.05;
  }

  vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  vMix = smoothstep(0.0, 7.8, length(transformed));
  gl_PointSize = (uPointScale / max(1.2, -mvPosition.z)) * (0.8 + fract(sin(dot(position.xy, vec2(13.3, 79.1))) * 4591.21));
}
`;

const stableFragmentShader = `
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uAlpha;
varying float vMix;

void main() {
  float r = distance(gl_PointCoord, vec2(0.5));
  if (r > 0.5) discard;
  float glow = smoothstep(0.5, 0.0, r);
  vec3 color = mix(uColorA, uColorB, vMix);
  gl_FragColor = vec4(color, glow * uAlpha);
}
`;

function StableCoreRenderer({ baseMode, overlayFx, highVisibility = false }: CoreRendererProps) {
    const pointsRef = useRef<THREE.Points>(null);

    const geometry = useMemo(() => {
        const count = 32000;
        const positions = new Float32Array(count * 3);
        for (let i = 0; i < count; i += 1) {
            const i3 = i * 3;
            const u = radicalInverseVdC(i + 1);
            const v = radicalInverseVdC(i * 5 + 7);
            const w = radicalInverseVdC(i * 11 + 13);
            const r = 6.0 * Math.cbrt(u);
            const theta = v * Math.PI * 2;
            const phi = Math.acos(2 * w - 1);
            positions[i3] = r * Math.sin(phi) * Math.cos(theta);
            positions[i3 + 1] = r * Math.cos(phi);
            positions[i3 + 2] = r * Math.sin(phi) * Math.sin(theta);
        }
        const particleGeometry = new THREE.BufferGeometry();
        particleGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        return particleGeometry;
    }, []);

    const material = useMemo(
        () =>
            new THREE.ShaderMaterial({
                vertexShader: stableVertexShader,
                fragmentShader: stableFragmentShader,
                uniforms: {
                    uTime: { value: 0 },
                    uMode: { value: 0 },
                    uRipple: { value: 0 },
                    uPointScale: { value: 19 },
                    uColorA: { value: new THREE.Color("#00ffff") },
                    uColorB: { value: new THREE.Color("#001a46") },
                    uAlpha: { value: 0.82 },
                },
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            }),
        []
    );

    const targetColorA = useMemo(() => new THREE.Color(), []);
    const targetColorB = useMemo(() => new THREE.Color(), []);

    useEffect(() => {
        return () => {
            geometry.dispose();
            material.dispose();
        };
    }, [geometry, material]);

    useFrame((state) => {
        const current = pointsRef.current;
        if (!current) {
            return;
        }
        const shader = current.material as THREE.ShaderMaterial;
        const shaderUniforms = shader.uniforms;

        shaderUniforms.uTime.value = state.clock.elapsedTime;
        shaderUniforms.uMode.value = resolveModeId(baseMode);
        shaderUniforms.uRipple.value = THREE.MathUtils.lerp(
            shaderUniforms.uRipple.value,
            overlayFx.includes("event_ripple") ? 1 : 0,
            0.09
        );
        shaderUniforms.uPointScale.value = THREE.MathUtils.lerp(
            shaderUniforms.uPointScale.value,
            highVisibility ? 24 : 19,
            0.06
        );
        shaderUniforms.uAlpha.value = THREE.MathUtils.lerp(
            shaderUniforms.uAlpha.value,
            highVisibility ? 0.95 : 0.82,
            0.06
        );

        const tone = resolveModeColor(baseMode);
        targetColorA.set(tone.primary);
        targetColorB.set(tone.secondary);
        (shaderUniforms.uColorA.value as THREE.Color).lerp(targetColorA, 0.06);
        (shaderUniforms.uColorB.value as THREE.Color).lerp(targetColorB, 0.06);

        const t = state.clock.elapsedTime;
        current.rotation.y = t * (baseMode === "risk" ? 0.2 : 0.14);
        current.rotation.x = Math.sin(t * 0.19) * 0.12;
    });

    return <points ref={pointsRef} geometry={geometry} material={material} />;
}

function LiteParticleCore({ baseMode, overlayFx, highVisibility = false }: CoreRendererProps) {
    const pointsRef = useRef<THREE.Points>(null);

    const { geometry, tint } = useMemo(() => {
        const count = 9000;
        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        const radius = 6.8;

        const baseTint =
            baseMode === "risk"
                ? new THREE.Color("#ff3366")
                : baseMode === "stream"
                    ? new THREE.Color("#3dd9ff")
                    : new THREE.Color("#00ffff");
        const deepTint = new THREE.Color("#123a5f");

        for (let i = 0; i < count; i += 1) {
            const i3 = i * 3;
            const u = radicalInverseVdC(i + 1);
            const v = radicalInverseVdC(i * 7 + 3);
            const theta = 2 * Math.PI * u;
            const phi = Math.acos(2 * v - 1);
            const shell = radius * (0.3 + radicalInverseVdC(i * 17 + 11) * 0.7);

            positions[i3] = shell * Math.sin(phi) * Math.cos(theta);
            positions[i3 + 1] = shell * Math.cos(phi);
            positions[i3 + 2] = shell * Math.sin(phi) * Math.sin(theta);

            const mixed = deepTint.clone().lerp(baseTint, radicalInverseVdC(i * 29 + 19));
            colors[i3] = mixed.r;
            colors[i3 + 1] = mixed.g;
            colors[i3 + 2] = mixed.b;
        }

        const particleGeometry = new THREE.BufferGeometry();
        particleGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        particleGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
        return { geometry: particleGeometry, tint: baseTint };
    }, [baseMode]);

    useEffect(() => {
        return () => {
            geometry.dispose();
        };
    }, [geometry]);

    useFrame((state) => {
        if (!pointsRef.current) {
            return;
        }
        const t = state.clock.elapsedTime;
        pointsRef.current.rotation.y = t * 0.08;
        pointsRef.current.rotation.x = Math.sin(t * 0.13) * 0.16;
        const ripple = overlayFx.includes("event_ripple") ? 0.1 : 0;
        const pulse = 1 + Math.sin(t * 0.9) * (0.025 + ripple);
        pointsRef.current.scale.setScalar(pulse);
    });

    return (
        <points ref={pointsRef} geometry={geometry}>
            <pointsMaterial
                color={tint}
                size={highVisibility ? 0.055 : 0.045}
                transparent
                opacity={highVisibility ? 0.86 : 0.72}
                depthWrite={false}
                vertexColors
                blending={THREE.AdditiveBlending}
            />
        </points>
    );
}

function CpuParticleFallback() {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }
        const ctx = canvas.getContext("2d");
        if (!ctx) {
            return;
        }

        let rafId = 0;
        const particleCount = 340;
        const particles = Array.from({ length: particleCount }, (_, index) => ({
            angle: (index / particleCount) * Math.PI * 2,
            radius: 18 + ((index * 17) % 220),
            speed: 0.0014 + ((index * 13) % 17) * 0.00017,
            depth: 40 + ((index * 31) % 420),
            drift: ((index * 7) % 21) * 0.008,
        }));

        const resize = () => {
            const rect = canvas.getBoundingClientRect();
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            canvas.width = Math.max(1, Math.floor(rect.width * dpr));
            canvas.height = Math.max(1, Math.floor(rect.height * dpr));
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        };

        const draw = (time: number) => {
            const width = canvas.clientWidth;
            const height = canvas.clientHeight;
            if (width <= 0 || height <= 0) {
                rafId = window.requestAnimationFrame(draw);
                return;
            }

            ctx.clearRect(0, 0, width, height);
            ctx.fillStyle = "rgba(0, 6, 16, 0.16)";
            ctx.fillRect(0, 0, width, height);

            const cx = width * 0.5;
            const cy = height * 0.5;
            const pulse = 1 + Math.sin(time * 0.0008) * 0.08;

            for (const particle of particles) {
                const theta = particle.angle + time * particle.speed;
                const z = Math.sin(theta * 1.6 + particle.drift) * particle.depth;
                const perspective = 260 / (320 + z);
                const x = cx + Math.cos(theta) * particle.radius * perspective * 4.4 * pulse;
                const y = cy + Math.sin(theta * 1.8 + particle.drift) * particle.radius * perspective * 2.6 * pulse;
                const size = Math.max(0.45, perspective * 2.1);
                const alpha = Math.min(0.95, 0.18 + perspective * 0.82);

                ctx.fillStyle = `rgba(0,255,240,${alpha.toFixed(3)})`;
                ctx.beginPath();
                ctx.arc(x, y, size, 0, Math.PI * 2);
                ctx.fill();
            }

            rafId = window.requestAnimationFrame(draw);
        };

        resize();
        rafId = window.requestAnimationFrame(draw);
        window.addEventListener("resize", resize);

        return () => {
            window.cancelAnimationFrame(rafId);
            window.removeEventListener("resize", resize);
        };
    }, []);

    return (
        <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full opacity-80"
            aria-hidden="true"
        />
    );
}

type VisualCoreRuntimeEventDetail = {
    status: VisualCoreRuntimeStatus;
    reason: VisualCoreRuntimeReason;
    engine: VisualCoreEngine;
    failureCode: VisualCoreFailureCode;
    switchCount: number;
    isRecovered: boolean;
};

function resolveRuntimeReason(input: {
    status: VisualCoreRuntimeStatus;
    engine: VisualCoreEngine;
    forcedEngine: VisualCoreEngine | null;
    failureCode: VisualCoreFailureCode;
    webGlRenderTier: WebGlRenderTier;
}): VisualCoreRuntimeReason {
    if (input.status === "probing") {
        return "capability_probe_pending";
    }
    if (input.forcedEngine && input.failureCode === "none") {
        return "forced_engine";
    }
    if (input.webGlRenderTier === "fallback" || input.failureCode === "webgl_unavailable") {
        return "webgl_unavailable";
    }
    if (input.failureCode !== "none") {
        return "canvas_runtime_error";
    }
    if (input.engine === "gpgpu") {
        return "ok";
    }
    if (input.engine === "stable") {
        return "stable_mode";
    }
    if (input.engine === "lite") {
        return "lite_mode";
    }
    return "cpu_mode";
}

export function Jarvis3DCore({ hideUI = false, baseMode, overlayFx, highVisibility = false }: Jarvis3DCoreProps) {
    const [manualBaseMode, setManualBaseMode] = useState<Jarvis3DBaseMode>("default");
    const [manualOverlayFx, setManualOverlayFx] = useState<Jarvis3DOverlayFx[]>([]);
    const [webGlRenderTier, setWebGlRenderTier] = useState<WebGlRenderTier>("probing");
    const [forcedEngine, setForcedEngine] = useState<VisualCoreEngine | null>(null);
    const [forcedEngineHydrated, setForcedEngineHydrated] = useState(false);
    const [activeEngine, setActiveEngine] = useState<VisualCoreEngine>("cpu");
    const [previousEngine, setPreviousEngine] = useState<VisualCoreEngine | null>(null);
    const [fadeOutPrevious, setFadeOutPrevious] = useState(false);
    const [failureCode, setFailureCode] = useState<VisualCoreFailureCode>("none");
    const [switchCount, setSwitchCount] = useState(0);
    const [isRecovered, setIsRecovered] = useState(false);
    const [lastSwitchAtMs, setLastSwitchAtMs] = useState(() => Date.now());

    const activeEngineRef = useRef<VisualCoreEngine>(activeEngine);
    const lastRuntimeEventEngineRef = useRef<VisualCoreEngine>(activeEngine);
    const crossfadeTimerRef = useRef<number | null>(null);
    const fadeRafRef = useRef<number | null>(null);
    const initializedEngineRef = useRef(false);
    const autoFailoverEnabled = useMemo(
        () => isFeatureEnabled("visual_core.auto_failover", true),
        []
    );

    useEffect(() => {
        activeEngineRef.current = activeEngine;
    }, [activeEngine]);

    useEffect(() => {
        return () => {
            if (crossfadeTimerRef.current !== null) {
                window.clearTimeout(crossfadeTimerRef.current);
            }
            if (fadeRafRef.current !== null) {
                window.cancelAnimationFrame(fadeRafRef.current);
            }
        };
    }, []);

    useEffect(() => {
        if (!manualOverlayFx.includes("event_ripple")) {
            return;
        }

        const timer = window.setTimeout(() => {
            setManualOverlayFx([]);
        }, MANUAL_RIPPLE_DURATION_MS);

        return () => {
            window.clearTimeout(timer);
        };
    }, [manualOverlayFx]);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            setWebGlRenderTier(resolveWebGlRenderTier());
        }, 0);
        return () => {
            window.clearTimeout(timer);
        };
    }, []);

    useEffect(() => {
        if (typeof window === "undefined") {
            return;
        }
        const timer = window.setTimeout(() => {
            const debugQueryEnabled =
                process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_ENABLE_CORE_ENGINE_QUERY === "1";
            const forced = debugQueryEnabled ? parseForcedCoreEngine(window.location.search) : null;
            setForcedEngine(forced);
            setForcedEngineHydrated(true);
        }, 0);
        return () => {
            window.clearTimeout(timer);
        };
    }, []);

    const performEngineSwitch = React.useCallback(
        (nextEngine: VisualCoreEngine, nextFailureCode: VisualCoreFailureCode, recovered: boolean) => {
            const prevEngine = activeEngineRef.current;
            if (prevEngine === nextEngine) {
                setFailureCode(nextFailureCode);
                setIsRecovered(recovered);
                return;
            }

            activeEngineRef.current = nextEngine;
            setPreviousEngine(prevEngine);
            setFadeOutPrevious(false);
            if (fadeRafRef.current !== null) {
                window.cancelAnimationFrame(fadeRafRef.current);
            }
            fadeRafRef.current = window.requestAnimationFrame(() => {
                setFadeOutPrevious(true);
            });

            if (crossfadeTimerRef.current !== null) {
                window.clearTimeout(crossfadeTimerRef.current);
            }
            crossfadeTimerRef.current = window.setTimeout(() => {
                setPreviousEngine(null);
            }, ENGINE_CROSSFADE_MS);

            setActiveEngine(nextEngine);
            setFailureCode(nextFailureCode);
            setIsRecovered(recovered);
            setSwitchCount((current) => current + 1);
            setLastSwitchAtMs(Date.now());
        },
        []
    );

    const registerEngineFailure = React.useCallback(
        (engine: VisualCoreEngine, code: VisualCoreFailureCode) => {
            if (activeEngineRef.current !== engine) {
                return;
            }
            if (!autoFailoverEnabled) {
                setFailureCode(code);
                setIsRecovered(false);
                return;
            }
            if (engine === "cpu") {
                setFailureCode(code);
                setIsRecovered(false);
                return;
            }

            const nextEngine = getFallbackEngine(engine);
            performEngineSwitch(nextEngine, code, false);
        },
        [autoFailoverEnabled, performEngineSwitch]
    );

    const handleGpgpuHealthSnapshot = React.useCallback(
        (snapshot: CoreHealthSnapshot) => {
            if (snapshot.engine !== "gpgpu" || activeEngineRef.current !== "gpgpu") {
                return;
            }
            if (!snapshot.isHealthy) {
                registerEngineFailure("gpgpu", snapshot.failureCode);
            }
        },
        [registerEngineFailure]
    );

    useEffect(() => {
        if (webGlRenderTier === "probing" || !forcedEngineHydrated || initializedEngineRef.current) {
            return;
        }
        const timer = window.setTimeout(() => {
            initializedEngineRef.current = true;
            const initialEngine = getInitialCoreEngine(webGlRenderTier, forcedEngine);
            const initialFailureCode: VisualCoreFailureCode =
                forcedEngine !== null
                    ? "forced_engine"
                    : webGlRenderTier === "fallback"
                        ? "webgl_unavailable"
                        : "none";
            performEngineSwitch(initialEngine, initialFailureCode, false);
        }, 0);
        return () => {
            window.clearTimeout(timer);
        };
    }, [forcedEngine, forcedEngineHydrated, performEngineSwitch, webGlRenderTier]);

    useEffect(() => {
        if (!autoFailoverEnabled) {
            return;
        }
        if (
            !shouldRetryGpgpu({
                forcedEngine,
                tier: webGlRenderTier,
                currentEngine: activeEngine,
                lastSwitchAtMs,
                nowMs: Date.now(),
                retryDelayMs: GPGPU_RECOVERY_RETRY_DELAY_MS,
            })
        ) {
            return;
        }

        const timer = window.setTimeout(() => {
            performEngineSwitch("gpgpu", "none", true);
        }, 120);
        return () => {
            window.clearTimeout(timer);
        };
    }, [activeEngine, autoFailoverEnabled, forcedEngine, lastSwitchAtMs, performEngineSwitch, webGlRenderTier]);

    const resolvedBaseMode = baseMode ?? manualBaseMode;
    const resolvedOverlayFx = overlayFx ?? manualOverlayFx;

    const runtimeStatus: VisualCoreRuntimeStatus =
        webGlRenderTier === "probing" || !forcedEngineHydrated
            ? "probing"
            : activeEngine === "cpu"
                ? "fallback"
                : "ready";
    const runtimeReason = resolveRuntimeReason({
        status: runtimeStatus,
        engine: activeEngine,
        forcedEngine,
        failureCode,
        webGlRenderTier,
    });

    useEffect(() => {
        if (typeof window === "undefined") {
            return;
        }

        const detail: VisualCoreRuntimeEventDetail = {
            status: runtimeStatus,
            reason: runtimeReason,
            engine: activeEngine,
            failureCode,
            switchCount,
            isRecovered,
        };

        window.dispatchEvent(
            new CustomEvent(VISUAL_CORE_RUNTIME_STATUS_EVENT, {
                detail,
            })
        );
    }, [activeEngine, failureCode, isRecovered, runtimeReason, runtimeStatus, switchCount]);

    useEffect(() => {
        const previous = lastRuntimeEventEngineRef.current;
        if (previous === activeEngine) {
            return;
        }
        emitRuntimeEvent("visual_core_engine_switched", {
            fromEngine: previous,
            toEngine: activeEngine,
            failureCode,
            switchCount,
            isRecovered,
            reason: runtimeReason,
            status: runtimeStatus,
        });
        lastRuntimeEventEngineRef.current = activeEngine;
    }, [activeEngine, failureCode, isRecovered, runtimeReason, runtimeStatus, switchCount]);

    const renderEngineLayer = (engine: VisualCoreEngine, activeLayer: boolean) => {
        if (engine === "cpu") {
            return (
                <div className="absolute inset-0 pointer-events-none">
                    <CpuParticleFallback />
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_rgba(0,255,255,0.22)_0%,_rgba(0,40,70,0.16)_38%,_rgba(0,0,0,0.92)_100%)]" />
                    <div className="absolute inset-0 opacity-40 bg-[linear-gradient(90deg,transparent_0%,rgba(0,255,255,0.14)_50%,transparent_100%)] animate-pulse" />
                    <div className="absolute inset-0 opacity-30 bg-[conic-gradient(from_180deg_at_50%_50%,rgba(0,0,0,0)_0deg,rgba(0,255,255,0.15)_80deg,rgba(0,0,0,0)_180deg,rgba(0,255,255,0.1)_280deg,rgba(0,0,0,0)_360deg)] mix-blend-screen" />
                </div>
            );
        }

        if (engine === "gpgpu") {
            return (
                <CanvasRuntimeBoundary onError={() => registerEngineFailure("gpgpu", "gpgpu_runtime_error")}>
                    <Canvas
                        camera={{ position: [0, 0, 15], fov: 45 }}
                        gl={{ antialias: false, powerPreference: "high-performance", alpha: true }}
                        dpr={[1, highVisibility ? 2 : 1.5]}
                        style={{ width: "100%", height: "100%" }}
                        onCreated={({ gl }) => {
                            gl.domElement.addEventListener(
                                "webglcontextlost",
                                (event) => {
                                    event.preventDefault();
                                    registerEngineFailure("gpgpu", "gpgpu_context_lost");
                                },
                                { once: true }
                            );
                        }}
                    >
                        <GPGPUFluidCore
                            baseMode={resolvedBaseMode}
                            overlayFx={resolvedOverlayFx}
                            active={activeLayer}
                            highVisibility={highVisibility}
                            onHealthSnapshot={handleGpgpuHealthSnapshot}
                        />
                        {resolvedBaseMode === "cinematic_dof" ? (
                            <EffectComposer enableNormalPass={false} multisampling={0}>
                                <DepthOfField focusDistance={0.0} focalLength={0.02} bokehScale={5} height={480} />
                                <ChromaticAberration
                                    offset={new THREE.Vector2(0.005, 0.005)}
                                    blendFunction={BlendFunction.NORMAL}
                                />
                            </EffectComposer>
                        ) : null}
                    </Canvas>
                </CanvasRuntimeBoundary>
            );
        }

        if (engine === "stable") {
            return (
                <CanvasRuntimeBoundary onError={() => registerEngineFailure("stable", "stable_runtime_error")}>
                    <Canvas
                        camera={{ position: [0, 0, 14], fov: 46 }}
                        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
                        dpr={[1, highVisibility ? 2 : 1.6]}
                        style={{ width: "100%", height: "100%" }}
                        onCreated={({ gl }) => {
                            gl.domElement.addEventListener(
                                "webglcontextlost",
                                (event) => {
                                    event.preventDefault();
                                    registerEngineFailure("stable", "stable_context_lost");
                                },
                                { once: true }
                            );
                        }}
                    >
                        <StableCoreRenderer
                            baseMode={resolvedBaseMode}
                            overlayFx={resolvedOverlayFx}
                            highVisibility={highVisibility}
                        />
                        {resolvedBaseMode === "cinematic_dof" ? (
                            <EffectComposer enableNormalPass={false} multisampling={0}>
                                <DepthOfField focusDistance={0.0} focalLength={0.018} bokehScale={4} height={480} />
                            </EffectComposer>
                        ) : null}
                    </Canvas>
                </CanvasRuntimeBoundary>
            );
        }

        return (
            <CanvasRuntimeBoundary onError={() => registerEngineFailure("lite", "lite_runtime_error")}>
                <Canvas
                    camera={{ position: [0, 0, 14], fov: 48 }}
                    gl={{ antialias: true, alpha: true, powerPreference: "default" }}
                    dpr={[1, highVisibility ? 1.8 : 1.5]}
                    style={{ width: "100%", height: "100%" }}
                    onCreated={({ gl }) => {
                        gl.domElement.addEventListener(
                            "webglcontextlost",
                            (event) => {
                                event.preventDefault();
                                registerEngineFailure("lite", "lite_context_lost");
                            },
                            { once: true }
                        );
                    }}
                >
                    <LiteParticleCore
                        baseMode={resolvedBaseMode}
                        overlayFx={resolvedOverlayFx}
                        highVisibility={highVisibility}
                    />
                </Canvas>
            </CanvasRuntimeBoundary>
        );
    };

    return (
        <div
            className="w-full h-full relative bg-transparent overflow-hidden"
            data-testid="jarvis-core-root"
            data-core-engine={activeEngine}
            data-core-status={runtimeStatus}
            data-core-reason={runtimeReason}
            data-core-failure={failureCode}
            data-core-switch-count={switchCount}
        >
            {previousEngine && previousEngine !== activeEngine && (
                <div
                    className={`absolute inset-0 transition-opacity duration-300 ${
                        fadeOutPrevious ? "opacity-0" : "opacity-100"
                    }`}
                >
                    {renderEngineLayer(previousEngine, false)}
                </div>
            )}
            <div className="absolute inset-0 opacity-100 transition-opacity duration-300">
                {renderEngineLayer(activeEngine, true)}
            </div>

            {!hideUI && (
                <div className="absolute inset-0 z-[100] pointer-events-none p-8 flex flex-col justify-between">
                    <div className="flex justify-center flex-col shadow-2xl">
                        <div className="flex gap-2 mx-auto pointer-events-auto">
                            <button
                                onClick={() => setManualBaseMode("default")}
                                className={`px-4 py-2 rounded-full text-xs font-bold tracking-widest transition-all ${resolvedBaseMode === "default" ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/50 shadow-[0_0_15px_rgba(0,255,255,0.3)]" : "text-white/50 hover:text-white border border-white/5"}`}
                            >
                                [01] NORMAL
                            </button>
                            <button
                                onClick={() => setManualBaseMode("stream")}
                                className={`px-4 py-2 rounded-full text-xs font-bold tracking-widest transition-all ${resolvedBaseMode === "stream" ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/50 shadow-[0_0_15px_rgba(0,255,255,0.3)]" : "text-white/50 hover:text-white border border-white/5"}`}
                            >
                                [02] STREAM TORNADO
                            </button>
                            <button
                                onClick={() => setManualBaseMode("risk")}
                                className={`px-4 py-2 rounded-full text-xs font-bold tracking-widest transition-all ${resolvedBaseMode === "risk" ? "bg-red-500/20 text-red-400 border border-red-500/50 shadow-[0_0_15px_rgba(255,0,0,0.3)]" : "text-white/50 hover:text-white border border-white/5"}`}
                            >
                                [03] RISK OVERHEAT
                            </button>
                        </div>
                        <div className="flex gap-2 mx-auto mt-2 flex-wrap justify-center pointer-events-auto">
                            <button
                                onClick={() => setManualBaseMode("sdf_brain")}
                                className={`px-4 py-2 rounded-full text-xs font-bold tracking-widest transition-all ${resolvedBaseMode === "sdf_brain" ? "bg-purple-500/20 text-purple-400 border border-purple-500/50 shadow-[0_0_15px_rgba(168,85,247,0.3)]" : "text-white/50 hover:text-white border border-white/5"}`}
                            >
                                [04] SDF: BRAIN
                            </button>
                            <button
                                onClick={() => setManualBaseMode("sdf_infinity")}
                                className={`px-4 py-2 rounded-full text-xs font-bold tracking-widest transition-all ${resolvedBaseMode === "sdf_infinity" ? "bg-purple-500/20 text-purple-400 border border-purple-500/50 shadow-[0_0_15px_rgba(168,85,247,0.3)]" : "text-white/50 hover:text-white border border-white/5"}`}
                            >
                                [05] SDF: INFINITY
                            </button>
                            <button
                                onClick={() => setManualBaseMode("sdf_eye")}
                                className={`px-4 py-2 rounded-full text-xs font-bold tracking-widest transition-all ${resolvedBaseMode === "sdf_eye" ? "bg-purple-500/20 text-purple-400 border border-purple-500/50 shadow-[0_0_15px_rgba(168,85,247,0.3)]" : "text-white/50 hover:text-white border border-white/5"}`}
                            >
                                [06] SDF: EYE
                            </button>
                        </div>
                        <div className="flex gap-2 mx-auto mt-2 flex-wrap justify-center pointer-events-auto">
                            <button
                                onClick={() => setManualBaseMode("sdf_crystal")}
                                className={`px-4 py-2 rounded-full text-xs font-bold tracking-widest transition-all ${resolvedBaseMode === "sdf_crystal" ? "bg-purple-500/20 text-purple-400 border border-purple-500/50 shadow-[0_0_15px_rgba(168,85,247,0.3)]" : "text-white/50 hover:text-white border border-white/5"}`}
                            >
                                [07] SDF: CRYSTAL
                            </button>
                        </div>
                        <div className="flex gap-2 mx-auto mt-2 flex-wrap justify-center pointer-events-auto">
                            <button
                                onClick={() => setManualBaseMode("multi_attractor")}
                                className={`px-4 py-2 rounded-full text-xs font-bold tracking-widest transition-all ${resolvedBaseMode === "multi_attractor" ? "bg-blue-500/20 text-blue-400 border border-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.3)]" : "text-white/50 hover:text-white border border-white/5"}`}
                            >
                                [08] SYNAPSE
                            </button>
                            <button
                                onClick={() => setManualBaseMode("cinematic_dof")}
                                className={`px-4 py-2 rounded-full text-xs font-bold tracking-widest transition-all ${resolvedBaseMode === "cinematic_dof" ? "bg-blue-500/20 text-blue-400 border border-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.3)]" : "text-white/50 hover:text-white border border-white/5"}`}
                            >
                                [09] CINEMATIC
                            </button>
                            <button
                                onClick={() => setManualOverlayFx(["event_ripple"])}
                                className={`px-4 py-2 rounded-full text-xs font-bold tracking-widest transition-all ${resolvedOverlayFx.includes("event_ripple") ? "bg-blue-500/20 text-blue-400 border border-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.3)]" : "text-white/50 hover:text-white border border-white/5"}`}
                            >
                                [10] RIPPLE
                            </button>
                        </div>
                    </div>
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center">
                        <div className="px-6 py-2 border border-cyan-500/30 bg-cyan-950/20 backdrop-blur-sm shadow-[0_0_30px_rgba(0,255,255,0.1)] clip-edges">
                            <span className="text-cyan-400 font-mono text-xl tracking-[0.2em] animate-pulse relative z-10 font-bold">
                                <span className="inline-block w-2 h-2 rounded-full bg-cyan-400 mr-3 animate-ping"></span>
                                INITIALIZE SYSTEM
                            </span>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
