import type {
  CustomLayerInterface,
  Map as MapboxMap,
} from 'mapbox-gl';

export interface SunShadowLayerOptions {
  id?: string;
  softness?: number;
  maxDarkness?: number;
  tint?: [number, number, number];
  /** Longitude subdivisions (default 72 → every 5°). */
  lonSubdivisions?: number;
  /** Latitude subdivisions (default 36 → every 5°). */
  latSubdivisions?: number;
}

// Mapbox internal constant: GLOBE_RADIUS = EXTENT / (2π) where EXTENT = 8192.
// The ECEF axis convention below (x: through 90°E, -y: through north pole,
// z: through prime meridian) MUST match what Mapbox's globeMatrix expects;
// any other choice produces a geometrically valid but incorrectly-oriented
// sphere that won't line up with the basemap tiles.
const GLOBE_RADIUS = 8192 / (2 * Math.PI);

const VERTEX_SHADER = `#version 300 es
in vec2 a_lngLat;
uniform mat4 u_matrix;
uniform mat4 u_globeToMercator;
uniform float u_transition;
out vec3 v_unitNormal;

const float GLOBE_RADIUS = ${GLOBE_RADIUS.toFixed(10)};
const float PI = 3.14159265358979323846;

void main() {
  float lng = radians(a_lngLat.x);
  float lat = radians(a_lngLat.y);
  float cosLat = cos(lat);
  float sinLat = sin(lat);

  // ECEF position in Mapbox's globe convention.
  vec3 ecef = vec3(
    cosLat * sin(lng) * GLOBE_RADIUS,
    -sinLat * GLOBE_RADIUS,
    cosLat * cos(lng) * GLOBE_RADIUS
  );

  // Mercator-space position for the same lng/lat (used when transition > 0,
  // i.e. when Mapbox is interpolating toward the flat mercator projection).
  float merc_x = (a_lngLat.x + 180.0) / 360.0;
  float merc_y = 0.5 - log(tan(0.25 * PI + 0.5 * lat)) / (2.0 * PI);

  vec4 globe_in_merc = u_globeToMercator * vec4(ecef, 1.0);
  vec4 merc_pos = vec4(merc_x, merc_y, 0.0, 1.0);

  vec4 blended = vec4(
    mix(globe_in_merc.xyz, merc_pos.xyz, u_transition),
    1.0
  );

  gl_Position = u_matrix * blended;

  // Surface normal in latLngToUnitVector convention so dot(v_unitNormal, u_sunDir)
  // matches the CPU-side sun vector that GlobeMap pushes via setSunDirection.
  v_unitNormal = vec3(cosLat * cos(lng), sinLat, cosLat * sin(lng));
}
`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec3 v_unitNormal;
uniform vec3 u_sunDir;
uniform float u_softness;
uniform float u_maxDarkness;
uniform vec3 u_tint;
out vec4 fragColor;

void main() {
  float dotP = dot(normalize(v_unitNormal), normalize(u_sunDir));
  float daylight = smoothstep(-u_softness, u_softness, dotP);
  float darkness = (1.0 - daylight) * u_maxDarkness;
  fragColor = vec4(u_tint, darkness);
}
`;

function compile(
  gl: WebGL2RenderingContext,
  type: number,
  src: string,
): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`SunShadowLayer shader compile failed: ${info}`);
  }
  return shader;
}

// Mesh latitude is clamped to ±MAX_LAT_DEG to avoid the log(tan(...))
// singularity in the mercator-Y branch of the vertex shader. Polar caps
// (last ~5°) won't be shaded — acceptable since labels there are sparse.
const MAX_LAT_DEG = 85;

function buildSphereMesh(
  lonSubs: number,
  latSubs: number,
): Float32Array {
  const verts: number[] = [];
  const latSpan = 2 * MAX_LAT_DEG;
  for (let j = 0; j < latSubs; j++) {
    const lat0 = -MAX_LAT_DEG + (latSpan * j) / latSubs;
    const lat1 = -MAX_LAT_DEG + (latSpan * (j + 1)) / latSubs;
    for (let i = 0; i < lonSubs; i++) {
      const lng0 = -180 + (360 * i) / lonSubs;
      const lng1 = -180 + (360 * (i + 1)) / lonSubs;
      verts.push(lng0, lat0, lng1, lat0, lng1, lat1);
      verts.push(lng0, lat0, lng1, lat1, lng0, lat1);
    }
  }
  return new Float32Array(verts);
}

const IDENTITY_MATRIX = new Float32Array([
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
]);

export class SunShadowLayer implements CustomLayerInterface {
  public readonly id: string;
  public readonly type = 'custom' as const;
  public readonly renderingMode = '3d' as const;

  private sunDir: [number, number, number] = [1, 0, 0];
  private softness: number;
  private maxDarkness: number;
  private tint: [number, number, number];
  private lonSubs: number;
  private latSubs: number;

  private map: MapboxMap | null = null;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private vbo: WebGLBuffer | null = null;
  private vertexCount = 0;
  private uMatrixLoc: WebGLUniformLocation | null = null;
  private uGlobeToMercatorLoc: WebGLUniformLocation | null = null;
  private uTransitionLoc: WebGLUniformLocation | null = null;
  private uSunDirLoc: WebGLUniformLocation | null = null;
  private uSoftnessLoc: WebGLUniformLocation | null = null;
  private uMaxDarknessLoc: WebGLUniformLocation | null = null;
  private uTintLoc: WebGLUniformLocation | null = null;

  constructor(options: SunShadowLayerOptions = {}) {
    this.id = options.id ?? 'sun-shadow';
    this.softness = options.softness ?? 0.15;
    this.maxDarkness = options.maxDarkness ?? 0.65;
    // Near-black with a barely-perceptible blue hint. The previous default
    // ([0.05, 0.08, 0.18]) read as "blue overlay" rather than "shadow of the
    // Earth". Lower these RGB values toward 0 for pure black, or pass a
    // `tint` option from GlobeMap to override.

    // - Pure black: [0.0, 0.0, 0.0]
    // - Near-black with subtle blue (current): [0.0, 0.0, 0.02]
    // - Slightly bluer dark: [0.0, 0.01, 0.05]
    // - Darker, more dramatic — also bump maxDarkness (line above): try 0.85 or 0.95 instead of 0.65 to make the night side more opaque.
    this.tint = options.tint ?? [0.0, 0.0, 0.02];
    this.lonSubs = options.lonSubdivisions ?? 72;
    this.latSubs = options.latSubdivisions ?? 36;
  }

  setSunDirection(dir: [number, number, number]): void {
    this.sunDir = dir;
    this.map?.triggerRepaint();
  }

  onAdd(map: MapboxMap, gl: WebGL2RenderingContext): void {
    this.map = map;

    const vs = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    const program = gl.createProgram()!;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(
        `SunShadowLayer program link failed: ${gl.getProgramInfoLog(program)}`,
      );
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);

    this.program = program;
    this.uMatrixLoc = gl.getUniformLocation(program, 'u_matrix');
    this.uGlobeToMercatorLoc = gl.getUniformLocation(
      program,
      'u_globeToMercator',
    );
    this.uTransitionLoc = gl.getUniformLocation(
      program,
      'u_transition',
    );
    this.uSunDirLoc = gl.getUniformLocation(program, 'u_sunDir');
    this.uSoftnessLoc = gl.getUniformLocation(program, 'u_softness');
    this.uMaxDarknessLoc = gl.getUniformLocation(
      program,
      'u_maxDarkness',
    );
    this.uTintLoc = gl.getUniformLocation(program, 'u_tint');

    const mesh = buildSphereMesh(this.lonSubs, this.latSubs);
    this.vertexCount = mesh.length / 2;

    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, mesh, gl.STATIC_DRAW);
    const aLngLat = gl.getAttribLocation(program, 'a_lngLat');
    gl.enableVertexAttribArray(aLngLat);
    gl.vertexAttribPointer(aLngLat, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  onRemove(_map: MapboxMap, gl: WebGL2RenderingContext): void {
    if (this.program) gl.deleteProgram(this.program);
    if (this.vao) gl.deleteVertexArray(this.vao);
    if (this.vbo) gl.deleteBuffer(this.vbo);
    this.program = null;
    this.vao = null;
    this.vbo = null;
    this.map = null;
  }

  render(
    gl: WebGL2RenderingContext,
    matrix: number[],
    _projection?: unknown,
    projectionToMercatorMatrix?: number[],
    projectionToMercatorTransition?: number,
  ): void {
    if (!this.program || !this.vao) return;

    // In mercator mode, projectionToMercatorMatrix is undefined and the layer
    // shouldn't be visible (GlobeMap only installs us in globe mode). If we
    // ever do get called in mercator, fall back to identity + transition=1
    // so the shader takes the pure-mercator branch and renders correctly.
    const globeToMerc = projectionToMercatorMatrix ?? IDENTITY_MATRIX;
    const transition = projectionToMercatorTransition ?? 1.0;

    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.uniformMatrix4fv(this.uMatrixLoc, false, matrix);
    gl.uniformMatrix4fv(
      this.uGlobeToMercatorLoc,
      false,
      globeToMerc as Float32Array | number[],
    );
    gl.uniform1f(this.uTransitionLoc, transition);
    gl.uniform3fv(this.uSunDirLoc, this.sunDir);
    gl.uniform1f(this.uSoftnessLoc, this.softness);
    gl.uniform1f(this.uMaxDarknessLoc, this.maxDarkness);
    gl.uniform3fv(this.uTintLoc, this.tint);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);
    gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount);
    gl.bindVertexArray(null);
  }
}
