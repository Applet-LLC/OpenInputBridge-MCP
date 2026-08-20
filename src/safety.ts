/**
 * Safety gate for input-injection tools: requires an explicit "arm" call
 * before any tool can send synthetic input, and enforces a sliding-window
 * rate limit so a runaway/prompt-injected agent cannot flood input.
 * See the "セーフティ設計" section of the project plan.
 */

export class NotArmedError extends Error {
  constructor() {
    super(
      "Input control is not armed. Call the 'enable_input_control' tool once per session before sending any key/mouse input.",
    );
    this.name = "NotArmedError";
  }
}

export class RateLimitError extends Error {
  constructor(maxEvents: number, windowMs: number) {
    super(`Rate limit exceeded: max ${maxEvents} input events per ${windowMs}ms. Slow down and retry.`);
    this.name = "RateLimitError";
  }
}

export interface SafetyGateOptions {
  /** Max input events allowed within the sliding window. */
  maxEventsPerWindow: number;
  /** Sliding window length in milliseconds. */
  windowMs: number;
}

export const DEFAULT_SAFETY_OPTIONS: SafetyGateOptions = {
  maxEventsPerWindow: 500,
  windowMs: 10_000,
};

export class SafetyGate {
  private armed = false;
  private timestamps: number[] = [];

  constructor(private readonly options: SafetyGateOptions = DEFAULT_SAFETY_OPTIONS) {}

  arm(): void {
    this.armed = true;
  }

  disarm(): void {
    this.armed = false;
    this.timestamps = [];
  }

  isArmed(): boolean {
    return this.armed;
  }

  /**
   * Must be called before every synthetic input event (or once with
   * `cost` = event count for a batch like type_text). Throws if the
   * session is not armed or the rate limit would be exceeded; otherwise
   * records the event(s).
   */
  checkAndConsume(cost = 1): void {
    if (!this.armed) {
      throw new NotArmedError();
    }
    const now = Date.now();
    const cutoff = now - this.options.windowMs;
    this.timestamps = this.timestamps.filter((t) => t > cutoff);
    if (this.timestamps.length + cost > this.options.maxEventsPerWindow) {
      throw new RateLimitError(this.options.maxEventsPerWindow, this.options.windowMs);
    }
    for (let i = 0; i < cost; i++) this.timestamps.push(now);
  }
}
