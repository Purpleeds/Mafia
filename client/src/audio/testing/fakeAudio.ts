/**
 * A stand-in for the Web Audio API, so the sound code can be tested without a
 * browser. It records what gets scheduled, and it throws what real browsers
 * throw (a value that isn't a finite number, a negative time, an exponential
 * ramp to zero, stopping a source that never started), so a mistake that would
 * break the sound in a real page fails a test instead.
 */

export interface ParamEvent {
  method: string;
  value: number;
  time: number;
}

export class FakeParam {
  value: number;
  readonly events: ParamEvent[] = [];

  constructor(initial = 0) {
    this.value = initial;
  }

  private record(method: string, value: number, time: number): this {
    if (!Number.isFinite(value)) throw new TypeError(`${method}: ${value} is not a finite number`);
    if (!Number.isFinite(time) || time < 0) throw new RangeError(`${method}: ${time} is not a valid time`);
    this.events.push({ method, value, time });
    return this;
  }

  setValueAtTime(value: number, time: number): this {
    return this.record("setValueAtTime", value, time);
  }

  linearRampToValueAtTime(value: number, time: number): this {
    return this.record("linearRampToValueAtTime", value, time);
  }

  exponentialRampToValueAtTime(value: number, time: number): this {
    if (value <= 0) throw new RangeError(`exponentialRampToValueAtTime: ${value} must be above zero`);
    return this.record("exponentialRampToValueAtTime", value, time);
  }

  setTargetAtTime(target: number, time: number, timeConstant: number): this {
    if (!(timeConstant >= 0)) throw new RangeError(`setTargetAtTime: ${timeConstant} is not a valid time constant`);
    return this.record("setTargetAtTime", target, time);
  }

  cancelScheduledValues(time: number): this {
    if (!Number.isFinite(time) || time < 0) throw new RangeError(`cancelScheduledValues: ${time} is not a valid time`);
    return this;
  }
}

export type FakeNodeKind = "oscillator" | "gain" | "filter" | "buffer" | "delay" | "panner" | "compressor" | "destination";

const PARAMS: Record<FakeNodeKind, Record<string, number>> = {
  oscillator: { frequency: 440, detune: 0 },
  gain: { gain: 1 },
  filter: { frequency: 350, Q: 1, gain: 0, detune: 0 },
  buffer: { playbackRate: 1, detune: 0 },
  delay: { delayTime: 0 },
  panner: { pan: 0 },
  compressor: { threshold: -24, knee: 30, ratio: 12, attack: 0.003, release: 0.25 },
  destination: {},
};

/** One audio node. Parameters are plain properties (`osc.frequency`, `gain.gain`...), as on the real ones. */
export class FakeNode {
  readonly outputs: Array<FakeNode | FakeParam> = [];
  startedAt: number | null = null;
  stoppedAt: number | null = null;
  type = "";
  loop = false;
  buffer: unknown = null;

  declare frequency: FakeParam;
  declare detune: FakeParam;
  declare gain: FakeParam;
  declare Q: FakeParam;
  declare pan: FakeParam;
  declare delayTime: FakeParam;
  declare playbackRate: FakeParam;

  constructor(
    readonly kind: FakeNodeKind,
    readonly context: FakeAudioContext,
  ) {
    for (const [name, initial] of Object.entries(PARAMS[kind])) Object.assign(this, { [name]: new FakeParam(initial) });
  }

  connect<T extends FakeNode | FakeParam>(destination: T): T {
    if (!(destination instanceof FakeNode) && !(destination instanceof FakeParam)) {
      throw new TypeError("connect: the destination is not an audio node or parameter");
    }
    this.outputs.push(destination);
    return destination;
  }

  disconnect(): void {
    this.outputs.length = 0;
  }

  start(when = 0): void {
    if (this.startedAt !== null) throw new Error("InvalidStateError: start() was already called");
    if (!Number.isFinite(when) || when < 0) throw new RangeError(`start: ${when} is not a valid time`);
    this.startedAt = when;
  }

  stop(when = 0): void {
    if (this.startedAt === null) throw new Error("InvalidStateError: stop() was called before start()");
    if (!Number.isFinite(when) || when < 0) throw new RangeError(`stop: ${when} is not a valid time`);
    this.stoppedAt = when;
  }
}

export interface FakeBuffer {
  length: number;
  sampleRate: number;
  numberOfChannels: number;
  getChannelData(channel: number): Float32Array;
}

export class FakeAudioContext {
  /** Whether new contexts start running, as they do when made during a tap. */
  static startsRunning = true;
  /** Every context made, newest last. */
  static readonly instances: FakeAudioContext[] = [];

  state: "suspended" | "running" | "closed" = FakeAudioContext.startsRunning ? "running" : "suspended";
  currentTime = 0;
  readonly sampleRate = 44100;
  readonly destination: FakeNode;
  readonly nodes: FakeNode[] = [];
  readonly options: unknown;

  constructor(options?: unknown) {
    this.options = options;
    this.destination = new FakeNode("destination", this);
    FakeAudioContext.instances.push(this);
  }

  private make(kind: FakeNodeKind): FakeNode {
    const node = new FakeNode(kind, this);
    this.nodes.push(node);
    return node;
  }

  createOscillator = () => this.make("oscillator");
  createGain = () => this.make("gain");
  createBiquadFilter = () => this.make("filter");
  createBufferSource = () => this.make("buffer");
  createDelay = (_maxDelayTime?: number) => this.make("delay");
  createStereoPanner = () => this.make("panner");
  createDynamicsCompressor = () => this.make("compressor");

  createBuffer(channels: number, length: number, sampleRate: number): FakeBuffer {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return {
      length,
      sampleRate,
      numberOfChannels: channels,
      getChannelData: (channel) => data[channel] ?? new Float32Array(length),
    };
  }

  // Like the real ones, these take effect a moment after they are called.
  async resume(): Promise<void> {
    await Promise.resolve();
    if (this.state !== "closed") this.state = "running";
  }

  async suspend(): Promise<void> {
    await Promise.resolve();
    if (this.state !== "closed") this.state = "suspended";
  }

  async close(): Promise<void> {
    this.state = "closed";
  }

  /** Nodes of one kind, in the order they were made. */
  all(kind: FakeNodeKind): FakeNode[] {
    return this.nodes.filter((n) => n.kind === kind);
  }

  /** A new context to test with. */
  static make(): FakeAudioContext {
    return new FakeAudioContext();
  }

  /** What the code under test receives where it asks for a BaseAudioContext. */
  get asContext(): BaseAudioContext {
    return this as unknown as BaseAudioContext;
  }
}

/** A node to send sounds into, typed as the real thing. */
export function fakeOutput(ctx: FakeAudioContext): { node: FakeNode; asNode: AudioNode } {
  const node = ctx.createGain();
  return { node, asNode: node as unknown as AudioNode };
}

/** Everything that eventually receives the sound of `from` (its outputs, and theirs, and so on). */
export function reachable(from: FakeNode): Set<FakeNode> {
  const seen = new Set<FakeNode>();
  const queue: FakeNode[] = [from];
  while (queue.length > 0) {
    const node = queue.pop();
    if (!node) break;
    for (const out of node.outputs) {
      if (out instanceof FakeNode && !seen.has(out)) {
        seen.add(out);
        queue.push(out);
      }
    }
  }
  return seen;
}
