/**
 * Manages the oib_bridge.exe child process and speaks its JSON-Lines
 * request/response protocol over stdin/stdout (one JSON object per line,
 * matched by numeric "id"; lines with no "id" are unsolicited events -
 * currently only the watchdog's exclusive-mode auto-disable notice). See
 * helper/oib_bridge.c for the protocol.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createInterface, type Interface as ReadlineInterface } from "node:readline";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export class OibBridgeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OibBridgeError";
  }
}

interface BridgeResponse {
  id: number;
  ok: boolean;
  error?: string;
  [key: string]: unknown;
}

interface BridgeEvent {
  event: string;
  [key: string]: unknown;
}

interface PendingRequest {
  resolve: (value: BridgeResponse) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface ExclusiveModeInfo {
  keyboardSlotCount: number;
  mouseSlotCount: number;
  watchdogTimeoutMs: number;
}

export interface ExclusiveModeAutoDisabledEvent {
  reason: string;
  failedDeviceCount: number;
}

/** Locates the compiled helper executable: packaged (bin/) first, then a local source build (helper/). */
export function resolveHelperExePath(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(moduleDir, "..", "bin", "oib_bridge.exe"),
    join(moduleDir, "..", "helper", "oib_bridge.exe"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new OibBridgeError(
    `oib_bridge.exe not found. Looked in:\n  ${candidates.join("\n  ")}\n` +
      "Build it from helper/oib_bridge.c (see README.md) or install a packaged release.",
  );
}

const DEFAULT_REQUEST_TIMEOUT_MS = 3000;
/** Heartbeats are sent at roughly a third of the watchdog timeout, never below this. */
const MIN_HEARTBEAT_INTERVAL_MS = 500;

export declare interface OibBridge {
  on(event: "exclusiveModeAutoDisabled", listener: (info: ExclusiveModeAutoDisabledEvent) => void): this;
}

export class OibBridge extends EventEmitter {
  private readonly exePath: string;
  private child: ChildProcess | null = null;
  private rl: ReadlineInterface | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(exePath: string = resolveHelperExePath()) {
    super();
    this.exePath = exePath;
  }

  private ensureStarted(): ChildProcess {
    if (this.child) return this.child;

    const child = spawn(this.exePath, [], { stdio: ["pipe", "pipe", "pipe"] });
    this.child = child;

    const rl = createInterface({ input: child.stdout! });
    rl.on("line", (line) => this.handleLine(line));
    this.rl = rl;

    child.on("exit", (code, signal) => this.handleTermination(code, signal));
    child.on("error", (err) => this.handleTermination(null, null, err));

    return child;
  }

  private handleLine(line: string): void {
    if (!line) return;
    let msg: BridgeResponse | BridgeEvent;
    try {
      msg = JSON.parse(line) as BridgeResponse | BridgeEvent;
    } catch {
      return; // malformed line from the helper; ignore rather than crash the server
    }

    if (typeof (msg as BridgeEvent).event === "string") {
      this.handleEvent(msg as BridgeEvent);
      return;
    }

    const response = msg as BridgeResponse;
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);
    clearTimeout(pending.timer);
    pending.resolve(response);
  }

  private handleEvent(evt: BridgeEvent): void {
    if (evt.event === "exclusive_mode_auto_disabled") {
      this.stopHeartbeat();
      this.emit("exclusiveModeAutoDisabled", {
        reason: String(evt.reason ?? "unknown"),
        failedDeviceCount: Number(evt.failedDeviceCount ?? 0),
      } satisfies ExclusiveModeAutoDisabledEvent);
    }
  }

  private handleTermination(code: number | null, signal: string | null, spawnError?: Error): void {
    this.stopHeartbeat();
    const reason = spawnError
      ? `failed to launch oib_bridge.exe: ${spawnError.message}`
      : `oib_bridge.exe exited unexpectedly (code=${code ?? "null"}, signal=${signal ?? "null"})`;
    const err = new OibBridgeError(reason);
    for (const req of this.pending.values()) {
      clearTimeout(req.timer);
      req.reject(err);
    }
    this.pending.clear();
    this.rl?.close();
    this.rl = null;
    this.child = null;
  }

  private request(
    cmd: string,
    fields: Record<string, unknown> = {},
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  ): Promise<BridgeResponse> {
    const child = this.ensureStarted();
    const id = this.nextId++;
    const line = JSON.stringify({ id, cmd, ...fields }) + "\n";

    return new Promise<BridgeResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new OibBridgeError(`bridge request timed out: ${cmd}`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });

      child.stdin!.write(line, (err) => {
        if (err) {
          this.pending.delete(id);
          clearTimeout(timer);
          reject(new OibBridgeError(`failed to write to oib_bridge.exe: ${err.message}`));
        }
      });
    }).then((msg) => {
      if (!msg.ok) {
        throw new OibBridgeError(msg.error ?? `${cmd} failed with no error message`);
      }
      return msg;
    });
  }

  async status(): Promise<{
    installed: true;
    versionMajor: number;
    versionMinor: number;
    keyboardSlotCount?: number;
    mouseSlotCount?: number;
    exclusiveModeActive: boolean;
  }> {
    const msg = await this.request("status");
    return {
      installed: true,
      versionMajor: Number(msg.versionMajor),
      versionMinor: Number(msg.versionMinor),
      keyboardSlotCount: msg.keyboardSlotCount !== undefined ? Number(msg.keyboardSlotCount) : undefined,
      mouseSlotCount: msg.mouseSlotCount !== undefined ? Number(msg.mouseSlotCount) : undefined,
      exclusiveModeActive: Boolean(msg.exclusiveModeActive),
    };
  }

  async writeKey(device: number, makeCode: number, down: boolean, extended: boolean): Promise<void> {
    await this.request("write_key", {
      device,
      makeCode,
      down: down ? 1 : 0,
      extended: extended ? 1 : 0,
    });
  }

  async writeMouseButton(device: number, buttonFlags: number): Promise<void> {
    await this.request("write_mouse_button", { device, buttonFlags });
  }

  async writeMouseMove(device: number, x: number, y: number, absolute: boolean): Promise<void> {
    await this.request("write_mouse_move", { device, x, y, absolute: absolute ? 1 : 0 });
  }

  async writeMouseWheel(device: number, rolling: number, horizontal: boolean): Promise<void> {
    await this.request("write_mouse_wheel", { device, rolling, horizontal: horizontal ? 1 : 0 });
  }

  /**
   * Arms exclusive input mode: every physical keyboard/mouse slot captures
   * and discards real input, while this bridge's own write* calls still
   * reach the real input stream. Starts sending periodic heartbeats so the
   * helper's watchdog doesn't auto-disable it. See helper/oib_bridge.c.
   */
  async enableExclusiveMode(watchdogTimeoutMs: number): Promise<ExclusiveModeInfo> {
    const msg = await this.request("enable_exclusive_input_mode", { watchdogTimeoutMs }, 5000);
    const info: ExclusiveModeInfo = {
      keyboardSlotCount: Number(msg.keyboardSlotCount),
      mouseSlotCount: Number(msg.mouseSlotCount),
      watchdogTimeoutMs: Number(msg.watchdogTimeoutMs),
    };
    this.startHeartbeat(info.watchdogTimeoutMs);
    return info;
  }

  async disableExclusiveMode(): Promise<{ wasActive: boolean; failedDeviceCount: number }> {
    this.stopHeartbeat();
    const msg = await this.request("disable_exclusive_input_mode", {}, 5000);
    return {
      wasActive: Boolean(msg.wasActive),
      failedDeviceCount: Number(msg.failedDeviceCount ?? 0),
    };
  }

  /** Sends one heartbeat and returns the helper's authoritative exclusive-mode state. */
  async heartbeat(): Promise<boolean> {
    const msg = await this.request("heartbeat");
    return Boolean(msg.exclusiveModeActive);
  }

  private startHeartbeat(watchdogTimeoutMs: number): void {
    this.stopHeartbeat();
    const intervalMs = Math.max(MIN_HEARTBEAT_INTERVAL_MS, Math.floor(watchdogTimeoutMs / 3));
    this.heartbeatTimer = setInterval(() => {
      this.request("heartbeat").catch(() => {
        // Best-effort; if the bridge is gone, handleTermination() already
        // stopped this timer and rejected everything else.
      });
    }, intervalMs);
    this.heartbeatTimer.unref?.();
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /** Terminates the helper process, if running. Safe to call multiple times. */
  dispose(): void {
    this.stopHeartbeat();
    if (!this.child) return;
    this.child.stdin?.end();
    this.child.kill();
  }
}
