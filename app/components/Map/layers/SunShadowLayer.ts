import type { CustomLayerInterface, Map as MapboxMap } from 'mapbox-gl';

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

const VERTEX_SHADER = `#version 300 es
in vec2 a_lngLat;
uniform mat4 u_matrix;
out vec3 v_unitNormal;

void main() {
  float lng = radians(a_lngLat.x);
  float lat = radians(a_lngLat.y);

  // MercatorCoordinate world-space for (lng, lat), altitude 0.
  // Mapbox's matrix transforms this directly to clip space (and applies
  // the globe projection when the map is in globe mode).
  float x = (a_lngLat.x + 180.0) / 360.0;
  float yMerc = 0.5 - log(tan(0.25 * 3.14159265 + 0.5 * lat)) / (2.0 * 3.14159265);
  vec4 worldPos = vec4(x, yMerc, 0.0, 1.0);
  gl_Position = u_matrix * worldPos;

  v_unitNormal = vec3(cos(lat) * cos(lng), sin(lat), cos(lat) * sin(lng));
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

// Latitude is clamped to ±MAX_LAT_DEG to avoid the log(tan(...)) singularity
// at the poles in the mercator Y calculation. Polar caps (last ~5°) will not
// be shaded — acceptable trade-off given labels in that region are also sparse.
const MAX_LAT_DEG = 85;

function buildSphereMesh(
  lonSubs: number,
  latSubs: number,
): Float32Array {
  // Vertex format: vec2(lng, lat). Two triangles per quad.
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
  private uSunDirLoc: WebGLUniformLocation | null = null;
  private uSoftnessLoc: WebGLUniformLocation | null = null;
  private uMaxDarknessLoc: WebGLUniformLocation | null = null;
  private uTintLoc: WebGLUniformLocation | null = null;

  constructor(options: SunShadowLayerOptions = {}) {
    this.id = options.id ?? 'sun-shadow';
    this.softness = options.softness ?? 0.15;
    this.maxDarkness = options.maxDarkness ?? 0.65;
    this.tint = options.tint ?? [0.05, 0.08, 0.18];
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
    this.uSunDirLoc = gl.getUniformLocation(program, 'u_sunDir');
    this.uSoftnessLoc = gl.getUniformLocation(program, 'u_softness');
    this.uMaxDarknessLoc = gl.getUniformLocation(program, 'u_maxDarkness');
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

  render(gl: WebGL2RenderingContext, matrix: number[]): void {
    if (!this.program || !this.vao) return;
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.uniformMatrix4fv(this.uMatrixLoc, false, matrix);
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
