/** Thin WebGL 1 wrapper: compiles the shader, holds the two village textures, draws one triangle. */
import type { Celestial, SceneColors } from "./palette";
import { UNIFORMS, VERTEX_SHADER, fragmentShader, type ShaderFeatures, type UniformName } from "./shader";
import type { VillageTextures, Windmill } from "./village";

export type Vec4 = readonly [number, number, number, number];

export interface FrameUniforms {
  /** Scene unit in drawing-buffer pixels. */
  unit: number;
  /** Animation time in seconds. */
  time: number;
  colors: SceneColors;
  sun: Celestial;
  moon: Celestial;
  /** Horizontal offsets (scene units): hills, far, mid, near. */
  parallax: Vec4;
  /** Noise offsets: clouds, valley mist, low mist, ground mist. */
  drift: Vec4;
  /** rgb, strength. */
  pulse: Vec4;
  /** ring radius, ring strength, shape (0 edges .. 1 centre), windmill sail angle. */
  ring: Vec4;
}

export class SkyRenderer {
  readonly gl: WebGLRenderingContext;
  private readonly program: WebGLProgram;
  private readonly buffer: WebGLBuffer;
  private readonly locations: Record<UniformName, WebGLUniformLocation | null>;
  private textures: WebGLTexture[] = [];
  private width = 1;
  private height = 1;

  constructor(canvas: HTMLCanvasElement, features: ShaderFeatures, windmill: Windmill, options: { allowSlow: boolean }) {
    const attributes: WebGLContextAttributes = {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: "low-power",
      failIfMajorPerformanceCaveat: !options.allowSlow,
    };
    const gl = canvas.getContext("webgl", attributes);
    if (!gl) throw new Error("WebGL unavailable");
    this.gl = gl;

    const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentShader(features, windmill));
    const program = gl.createProgram();
    if (!program) throw new Error("Could not create a shader program");
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.bindAttribLocation(program, 0, "aPos");
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
      throw new Error(`Shader link failed: ${gl.getProgramInfoLog(program) ?? ""}`);
    }
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    this.program = program;

    // One triangle that covers the whole screen.
    const buffer = gl.createBuffer();
    if (!buffer) throw new Error("Could not create a buffer");
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.buffer = buffer;

    gl.useProgram(program);
    const locations = {} as Record<UniformName, WebGLUniformLocation | null>;
    for (const name of UNIFORMS) locations[name] = gl.getUniformLocation(program, name);
    this.locations = locations;
    gl.uniform1i(locations.uSil, 0);
    gl.uniform1i(locations.uLit, 1);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
  }

  /** Uploads the village layers (canvases from rasterizeVillage). */
  setTextures(textures: VillageTextures): void {
    const gl = this.gl;
    for (const texture of this.textures) gl.deleteTexture(texture);
    this.textures = [];
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    [textures.silhouettes, textures.lights].forEach((source, unit) => {
      const texture = gl.createTexture();
      if (!texture) throw new Error("Could not create a texture");
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.generateMipmap(gl.TEXTURE_2D);
      this.textures.push(texture);
    });
  }

  setSize(width: number, height: number): void {
    const canvas = this.gl.canvas as HTMLCanvasElement;
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    this.width = width;
    this.height = height;
    this.gl.viewport(0, 0, width, height);
  }

  draw(u: FrameUniforms): void {
    const gl = this.gl;
    const l = this.locations;
    const c = u.colors;
    const v4 = (name: UniformName, x: number, y: number, z: number, w: number) => gl.uniform4f(l[name], x, y, z, w);
    v4("uFrame", this.width, this.height, u.unit, u.time);
    v4("uZenith", c.zenith[0], c.zenith[1], c.zenith[2], c.stars);
    v4("uHorizon", c.horizon[0], c.horizon[1], c.horizon[2], c.lights);
    v4("uFarCol", c.far[0], c.far[1], c.far[2], c.fogAmount);
    v4("uMidCol", c.mid[0], c.mid[1], c.mid[2], c.dayAmount);
    v4("uNearCol", c.near[0], c.near[1], c.near[2], c.grain);
    v4("uFogCol", c.fog[0], c.fog[1], c.fog[2], c.vignette);
    v4("uSunCol", c.sun[0], c.sun[1], c.sun[2], c.clouds);
    v4("uMoonCol", c.moon[0], c.moon[1], c.moon[2], c.moonShadow);
    v4("uWinCol", c.window[0], c.window[1], c.window[2], 0);
    v4("uSun", u.sun.x, u.sun.y, u.sun.r, u.sun.w);
    v4("uMoon", u.moon.x, u.moon.y, u.moon.r, u.moon.w);
    v4("uParallax", ...u.parallax);
    v4("uDrift", ...u.drift);
    v4("uPulse", ...u.pulse);
    v4("uRing", ...u.ring);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Frees GPU memory now rather than whenever the browser collects the canvas. */
  dispose(): void {
    const gl = this.gl;
    if (!gl.isContextLost()) {
      for (const texture of this.textures) gl.deleteTexture(texture);
      gl.deleteBuffer(this.buffer);
      gl.deleteProgram(this.program);
    }
    this.textures = [];
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Could not create a shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    const log = gl.getShaderInfoLog(shader) ?? "";
    gl.deleteShader(shader);
    throw new Error(`Shader compile failed: ${log}`);
  }
  return shader;
}
