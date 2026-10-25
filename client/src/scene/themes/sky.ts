import * as THREE from "three";

const VERTEX = /* glsl */ `
varying vec3 vDirection;
void main() {
  // The dome is centred on the camera, so a vertex's position is the direction it is seen in.
  vDirection = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 zenith;
uniform vec3 horizon;
uniform vec3 below;
uniform vec3 sunDirection;
uniform vec3 sunColor;
uniform float sunStrength; // 0: no sun or moon (a theme that doesn't follow the sun)
uniform float night;       // 0 by day (the sun), 1 at night (the moon)
varying vec3 vDirection;

void main() {
  vec3 dir = normalize(vDirection);
  float h = dir.y;
  vec3 color = h >= 0.0 ? mix(horizon, zenith, pow(h, 0.55)) : mix(horizon, below, smoothstep(0.0, 0.35, -h));

  float cosAngle = max(dot(dir, normalize(sunDirection)), 0.0);
  // The sun: a disc of about one degree across, a tight glow and a wide soft one. The moon: a smaller, paler disc with a faint halo.
  float sunDisc = smoothstep(0.99985, 0.99995, cosAngle);
  float sunGlow = pow(cosAngle, 90.0) * 0.5 + pow(cosAngle, 8.0) * 0.18;
  float moonDisc = smoothstep(0.99992, 0.99997, cosAngle);
  float moonGlow = pow(cosAngle, 400.0) * 0.25;
  vec3 moonColor = mix(sunColor, vec3(1.0), 0.6);
  vec3 sun = sunColor * (sunDisc * 2.0 + sunGlow) * (1.0 - night);
  vec3 moon = moonColor * (moonDisc * 1.2 + moonGlow) * night;
  // Nothing of the sun or moon shows below the horizon.
  color += (sun + moon) * sunStrength * smoothstep(-0.02, 0.02, h);

  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export interface SkyUniforms {
  [uniform: string]: THREE.IUniform;
  zenith: THREE.IUniform<THREE.Color>;
  horizon: THREE.IUniform<THREE.Color>;
  below: THREE.IUniform<THREE.Color>;
  sunDirection: THREE.IUniform<THREE.Vector3>;
  sunColor: THREE.IUniform<THREE.Color>;
  sunStrength: THREE.IUniform<number>;
  night: THREE.IUniform<number>;
}

/**
 * The sky dome's material: a gradient (zenith, horizon, below the horizon) with the sun's disc and glow, or the moon,
 * at `sunDirection`. It is drawn on the inside of a sphere around the camera and writes no depth, and fog doesn't touch it.
 */
export function createSkyMaterial(): THREE.ShaderMaterial & { uniforms: SkyUniforms } {
  const uniforms: SkyUniforms = {
    zenith: { value: new THREE.Color() },
    horizon: { value: new THREE.Color() },
    below: { value: new THREE.Color() },
    sunDirection: { value: new THREE.Vector3(0, 1, 0) },
    sunColor: { value: new THREE.Color() },
    sunStrength: { value: 0 },
    night: { value: 0 },
  };
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
  }) as THREE.ShaderMaterial & { uniforms: SkyUniforms };
}
