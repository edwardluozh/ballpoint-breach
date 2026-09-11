import * as THREE from 'three';

/**
 * 纸面+圆珠笔影线填充材质。
 * - 暖纸底色,按固定光向做两级"纸面阴影"
 * - 背光面叠多族确定性影线(角度/间距/粗细/弯度/断续由 seed 派生)
 * - 朝下 soffit 面额外加近水平密排 scribble
 * - 全部由世界坐标+seed 决定,无 time uniform → 相机移动不闪烁
 */
const VERT = /* glsl */ `
  varying vec3 vWPos;
  varying vec3 vWNormal;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWPos = wp.xyz;
    vWNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vWPos;
  varying vec3 vWNormal;
  uniform vec3 uPaper;
  uniform vec3 uInk;
  uniform vec3 uHatch;
  uniform vec3 uLightDir;   // 指向光源
  uniform float uSeed;
  uniform float uDensity;   // 全局密度倍率(建筑≈1)
  uniform float uOpacity;

  float hash11(float n) {
    return fract(sin(n * 127.1 + uSeed * 311.7) * 43758.5453);
  }

  // 一族影线的覆盖值
  float hatchFamily(vec2 p, float ang, float spacing, float thickness,
                    float wobAmp, float wobFreq, float phase, float drop) {
    vec2 dir = vec2(cos(ang), sin(ang));
    float perp = p.x * dir.y - p.y * dir.x;           // 垂直于线方向的有符号距离轴
    float along = p.x * dir.x + p.y * dir.y;          // 沿线方向
    float wob = wobAmp * sin(along * wobFreq + phase);
    float d = perp + wob;
    float cell = floor(d / spacing);
    float f = abs(fract(d / spacing) - 0.5) * spacing; // 距最近线中心
    float aa = fwidth(d) * 1.2 + 0.004;
    float line = 1.0 - smoothstep(thickness - aa, thickness + aa, f);
    // 断续:某些小段缺失(手绘不连续)
    float seg = floor(along / (spacing * 3.0));
    float m = step(drop, hash11(cell * 7.31 + seg * 13.97));
    return line * m;
  }

  void main() {
    vec3 n = normalize(vWNormal);
    float lambert = dot(n, normalize(uLightDir));
    float shade = clamp(1.0 - lambert, 0.0, 1.0);      // 0 亮面 → 1 背光

    // 面内稳定 2D 坐标(按法线主轴投影,避免透视插值漂移)
    vec3 an = abs(n);
    vec2 p;
    if (an.y >= an.x && an.y >= an.z) p = vWPos.xz;
    else if (an.x >= an.z) p = vWPos.zy;
    else p = vWPos.xy;

    float s = uSeed;
    // 三族基础影线:角度/间距/粗细各异
    float h = 0.0;
    h = max(h, hatchFamily(p, 0.95 + 0.25 * hash11(s),      0.42, 0.014, 0.045, 0.9,  s * 6.28, 0.10));
    h = max(h, hatchFamily(p, 1.85 + 0.30 * hash11(s + 3.), 0.64, 0.018, 0.060, 0.7,  s * 4.11, 0.16));
    h = max(h, hatchFamily(p, 0.50 + 0.20 * hash11(s + 7.), 1.05, 0.011, 0.030, 1.3,  s * 9.17, 0.22));
    // 深背光补第四族交叉
    float deep = smoothstep(0.55, 0.95, shade);
    h = max(h, deep * hatchFamily(p, 2.45 + 0.2 * hash11(s + 11.), 0.30, 0.013, 0.05, 1.1, s * 3.3, 0.30));

    // 朝下 soffit:近水平密排 loose scribble
    if (n.y < -0.45) {
      h = max(h, hatchFamily(p, 0.06 + 0.12 * hash11(s + 17.), 0.16, 0.016, 0.09, 0.5, s * 7.7, 0.34) * 0.95);
    }

    float inkAmt = h * uDensity * smoothstep(0.18, 0.62, shade); // 亮面保持纸白
    vec3 col = mix(uPaper, uHatch, inkAmt);
    // 极轻纸面明暗(两级)
    col *= (0.985 + 0.015 * smoothstep(-0.2, 1.0, lambert));
    gl_FragColor = vec4(col, uOpacity);
  }
`;

export interface PenFillOptions {
  paper?: number;
  ink?: number;
  hatch?: number;
  lightDir?: THREE.Vector3;
  seed?: number;
  density?: number;
  opacity?: number;
  side?: THREE.Side;
}

export function makePenFillMaterial(opts: PenFillOptions = {}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uPaper: { value: new THREE.Color(opts.paper ?? 0xf3eedd) },
      uInk: { value: new THREE.Color(opts.ink ?? 0x29277f) },
      uHatch: { value: new THREE.Color(opts.hatch ?? 0x7d79b8) },
      uLightDir: { value: opts.lightDir ?? new THREE.Vector3(0.45, 0.82, 0.35) },
      uSeed: { value: opts.seed ?? 1 },
      uDensity: { value: opts.density ?? 1 },
      uOpacity: { value: opts.opacity ?? 1 },
    },
    side: opts.side ?? THREE.FrontSide,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
}

/** 共享材质缓存 —— 相同 seed 档位的建筑件复用同一材质 */
const cache = new Map<string, THREE.ShaderMaterial>();
export function sharedPenFill(seedBucket: number, opts: PenFillOptions = {}): THREE.ShaderMaterial {
  const key = `${seedBucket}|${opts.paper ?? ''}|${opts.density ?? 1}|${opts.side ?? 0}|${opts.opacity ?? 1}`;
  let m = cache.get(key);
  if (!m) { m = makePenFillMaterial({ ...opts, seed: seedBucket * 0.731 + 0.13 }); cache.set(key, m); }
  return m;
}
