/**
 * MCP tool surface (v1, send-only). Registers every tool onto the given
 * McpServer. See the project plan for the rationale behind the tool list
 * and the arm/rate-limit safety gate.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OibBridge, OibBridgeError } from "./bridge.js";
import { SafetyGate, NotArmedError, RateLimitError } from "./safety.js";
import { KEY_TABLE, MODIFIER_KEYS, charToKeyEvent, type KeyName, type ModifierKey } from "./keycodes.js";

const KEY_NAMES = Object.keys(KEY_TABLE) as [KeyName, ...KeyName[]];

/*
 * The keyboard/mouse slot boundary is admin-configurable at driver install
 * time (KeyboardSlotCount), not fixed at 10/10 - see docs/PROTOCOL.md and
 * helper/oib_bridge.c's EnsureKeyboardSlotCount(). These schemas only
 * enforce the outer 0-19 device range; the helper checks the real
 * (queried) boundary and rejects a keyboard call routed at a mouse slot
 * or vice versa. Callers who need a non-default slot should look at
 * get_driver_status's keyboardSlotCount/mouseSlotCount fields first.
 */
const KEYBOARD_DEVICE_SCHEMA = z
  .number()
  .int()
  .min(0)
  .max(19)
  .default(0)
  .describe(
    "Keyboard slot index. Defaults to 0 (always a keyboard slot). The keyboard/mouse boundary is " +
      "admin-configurable - check get_driver_status's keyboardSlotCount if targeting a specific slot.",
  );

const MOUSE_DEVICE_SCHEMA = z
  .number()
  .int()
  .min(0)
  .max(19)
  .default(10)
  .describe(
    "Mouse slot index. Defaults to 10 (the first mouse slot under the default 10/10 split). The keyboard/mouse " +
      "boundary is admin-configurable - check get_driver_status's keyboardSlotCount/mouseSlotCount first if unsure.",
  );

const TAP_HOLD_MS = 25;
/**
 * Minimum gap enforced after every individual key/modifier transition
 * (not just within a tap). Confirmed necessary by real-hardware testing:
 * our own DeviceIoControl calls are strictly sequential and each
 * synchronous down to the class driver hand-off, but the OS's downstream
 * raw-input pipeline (kbdclass -> raw input thread -> TranslateMessage/
 * ToUnicode's modifier-state lookup -> WM_CHAR delivery) processes events
 * asynchronously relative to that; firing events back to back with no gap
 * measurably dropped characters on real hardware even though every
 * IOCTL_WRITE call succeeded. This alone was not enough to fix rapid
 * same-scancode modifier repeats though (see the ShiftLeft/ShiftRight
 * alternation in type_text below) - see test/REALWORLD_TESTING.md.
 */
const KEY_EVENT_SETTLE_MS = 30;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function textResult(text: string, isError = false): CallToolResult {
  return { content: [{ type: "text", text }], isError };
}

function errorResult(err: unknown): CallToolResult {
  if (err instanceof NotArmedError || err instanceof RateLimitError) {
    return textResult(err.message, true);
  }
  if (err instanceof OibBridgeError) {
    return textResult(`OpenInputBridge error: ${err.message}`, true);
  }
  const message = err instanceof Error ? err.message : String(err);
  return textResult(`Unexpected error: ${message}`, true);
}

const MOUSE_BUTTON_FLAGS = {
  left: { down: 0x0001, up: 0x0002 },
  right: { down: 0x0004, up: 0x0008 },
  middle: { down: 0x0010, up: 0x0020 },
  x1: { down: 0x0040, up: 0x0080 },
  x2: { down: 0x0100, up: 0x0200 },
} as const;

async function tapKey(bridge: OibBridge, device: number, key: KeyName): Promise<void> {
  const code = KEY_TABLE[key];
  await bridge.writeKey(device, code.makeCode, true, code.extended);
  await sleep(TAP_HOLD_MS);
  await bridge.writeKey(device, code.makeCode, false, code.extended);
  await sleep(KEY_EVENT_SETTLE_MS);
}

async function setKeyState(bridge: OibBridge, device: number, key: KeyName, down: boolean): Promise<void> {
  const code = KEY_TABLE[key];
  await bridge.writeKey(device, code.makeCode, down, code.extended);
  await sleep(KEY_EVENT_SETTLE_MS);
}

export function registerTools(server: McpServer, bridge: OibBridge, safety: SafetyGate): void {
  server.registerTool(
    "enable_input_control",
    {
      title: "Enable input control",
      description:
        "Arms the session for synthetic key/mouse input. Must be called once before any of press_key, " +
        "key_down, key_up, type_text, mouse_move, mouse_click, or mouse_wheel will work. This is a deliberate " +
        "extra confirmation step, separate from the MCP client's own tool-permission UI, given how powerful " +
        "unattended input injection is.",
      inputSchema: {},
    },
    async () => {
      safety.arm();
      return textResult("Input control armed. Synthetic key/mouse tools are now enabled for this session.");
    },
  );

  server.registerTool(
    "disable_input_control",
    {
      title: "Disable input control",
      description: "Disarms the session. All synthetic input tools will be rejected until enable_input_control is called again.",
      inputSchema: {},
    },
    async () => {
      safety.disarm();
      return textResult("Input control disarmed.");
    },
  );

  server.registerTool(
    "get_driver_status",
    {
      title: "Get OpenInputBridge driver status",
      description:
        "Diagnostic tool: checks whether the OpenInputBridge driver is installed and running, and returns its " +
        "version. Does not require enable_input_control (it sends no input). Call this first if other tools fail.",
      inputSchema: {},
    },
    async () => {
      try {
        const status = await bridge.status();
        return textResult(JSON.stringify(status));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return textResult(JSON.stringify({ installed: false, error: message }));
      }
    },
  );

  server.registerTool(
    "press_key",
    {
      title: "Press a key (tap)",
      description:
        "Presses and releases a single key, optionally held with modifiers (e.g. key='KeyA', modifiers=['ControlLeft'] " +
        "for Ctrl+A). Key names follow the DOM KeyboardEvent.code vocabulary (KeyA-KeyZ, Digit0-Digit9, Enter, " +
        "ArrowUp, F1-F12, etc.). US QWERTY layout only.",
      inputSchema: {
        key: z.enum(KEY_NAMES).describe("Physical key to press, e.g. 'KeyA', 'Enter', 'F5', 'ArrowLeft'."),
        modifiers: z
          .array(z.enum(MODIFIER_KEYS))
          .default([])
          .describe("Modifier keys to hold down for the duration of the tap, e.g. ['ControlLeft', 'ShiftLeft']."),
        device: KEYBOARD_DEVICE_SCHEMA,
      },
    },
    async ({ key, modifiers, device }: { key: KeyName; modifiers: ModifierKey[]; device: number }) => {
      try {
        safety.checkAndConsume((modifiers.length + 1) * 2);
        for (const mod of modifiers) {
          await setKeyState(bridge, device, mod, true);
        }
        await tapKey(bridge, device, key);
        for (const mod of [...modifiers].reverse()) {
          await setKeyState(bridge, device, mod, false);
        }
        return textResult(`Pressed ${modifiers.length ? modifiers.join("+") + "+" : ""}${key}.`);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "key_down",
    {
      title: "Hold a key down",
      description:
        "Presses a key without releasing it. Pair with key_up for composite gestures (e.g. holding Shift while " +
        "clicking). Remember to release every key you hold down.",
      inputSchema: {
        key: z.enum(KEY_NAMES),
        device: KEYBOARD_DEVICE_SCHEMA,
      },
    },
    async ({ key, device }: { key: KeyName; device: number }) => {
      try {
        safety.checkAndConsume(1);
        await setKeyState(bridge, device, key, true);
        return textResult(`${key} is now held down.`);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "key_up",
    {
      title: "Release a held key",
      description: "Releases a key previously pressed with key_down.",
      inputSchema: {
        key: z.enum(KEY_NAMES),
        device: KEYBOARD_DEVICE_SCHEMA,
      },
    },
    async ({ key, device }: { key: KeyName; device: number }) => {
      try {
        safety.checkAndConsume(1);
        await setKeyState(bridge, device, key, false);
        return textResult(`${key} released.`);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "type_text",
    {
      title: "Type a text string",
      description:
        "Types a string as a sequence of keystrokes (US QWERTY layout only; no IME/non-ASCII support). " +
        "Supports letters, digits, common punctuation, space, tab, and newline (sent as Enter). The whole " +
        "string is validated before anything is sent, so a call either types in full or is rejected with no " +
        "partial side effects.",
      inputSchema: {
        text: z.string().min(1).max(4000),
        delayMs: z
          .number()
          .int()
          .min(0)
          .max(1000)
          .default(20)
          .describe("Delay in milliseconds between characters, to mimic natural typing pace."),
        device: KEYBOARD_DEVICE_SCHEMA,
      },
    },
    async ({ text, delayMs, device }: { text: string; delayMs: number; device: number }) => {
      const events: { key: KeyName; shift: boolean }[] = [];
      const unsupported = new Set<string>();
      for (const ch of text) {
        const ev = charToKeyEvent(ch);
        if (!ev) {
          unsupported.add(ch);
        } else {
          events.push(ev);
        }
      }
      if (unsupported.size > 0) {
        return textResult(
          `Cannot type this text: unsupported character(s) ${[...unsupported].map((c) => JSON.stringify(c)).join(", ")}. ` +
            "Only US QWERTY letters/digits/punctuation, space, tab, and newline are supported.",
          true,
        );
      }

      try {
        const cost = events.reduce((sum, ev) => sum + (ev.shift ? 4 : 2), 0);
        safety.checkAndConsume(cost);
        // Alternate ShiftLeft/ShiftRight across consecutive shifted
        // characters rather than always reusing ShiftLeft. Confirmed by
        // real-hardware testing: rapidly toggling the *same* scancode
        // down/up/down/up (e.g. every shifted char in "MiXeD") is
        // unreliable - Windows' input pipeline silently drops some of the
        // repeated transitions even with generous settle delays. Using a
        // different physical key each time avoids same-scancode repeat
        // entirely and was reliable even at the tool's normal (non-slowed)
        // timing. See test/REALWORLD_TESTING.md.
        let nextShiftKey: "ShiftLeft" | "ShiftRight" = "ShiftLeft";
        for (const ev of events) {
          const shiftKey: "ShiftLeft" | "ShiftRight" = nextShiftKey;
          if (ev.shift) {
            await setKeyState(bridge, device, shiftKey, true);
            nextShiftKey = shiftKey === "ShiftLeft" ? "ShiftRight" : "ShiftLeft";
          }
          await tapKey(bridge, device, ev.key);
          if (ev.shift) await setKeyState(bridge, device, shiftKey, false);
          if (delayMs > 0) await sleep(delayMs);
        }
        return textResult(`Typed ${events.length} character(s).`);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "mouse_move",
    {
      title: "Move the mouse",
      description:
        "Moves the mouse, either relative to its current position (default) or to absolute coordinates " +
        "(same semantics as a raw MOUSE_INPUT_DATA record with MOUSE_MOVE_ABSOLUTE).",
      inputSchema: {
        x: z.number().int(),
        y: z.number().int(),
        absolute: z.boolean().default(false),
        device: MOUSE_DEVICE_SCHEMA,
      },
    },
    async ({ x, y, absolute, device }: { x: number; y: number; absolute: boolean; device: number }) => {
      try {
        safety.checkAndConsume(1);
        await bridge.writeMouseMove(device, x, y, absolute);
        return textResult(`Moved mouse ${absolute ? "to" : "by"} (${x}, ${y}).`);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "mouse_click",
    {
      title: "Click a mouse button",
      description: "Clicks (or presses/releases) a mouse button: left, right, middle, x1 (back), or x2 (forward).",
      inputSchema: {
        button: z.enum(["left", "right", "middle", "x1", "x2"]),
        action: z.enum(["click", "down", "up"]).default("click"),
        device: MOUSE_DEVICE_SCHEMA,
      },
    },
    async ({
      button,
      action,
      device,
    }: {
      button: keyof typeof MOUSE_BUTTON_FLAGS;
      action: "click" | "down" | "up";
      device: number;
    }) => {
      try {
        const flags = MOUSE_BUTTON_FLAGS[button];
        safety.checkAndConsume(action === "click" ? 2 : 1);
        if (action === "click") {
          await bridge.writeMouseButton(device, flags.down);
          await sleep(TAP_HOLD_MS);
          await bridge.writeMouseButton(device, flags.up);
        } else if (action === "down") {
          await bridge.writeMouseButton(device, flags.down);
        } else {
          await bridge.writeMouseButton(device, flags.up);
        }
        return textResult(`${button} button: ${action}.`);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "mouse_wheel",
    {
      title: "Scroll the mouse wheel",
      description:
        "Scrolls the vertical (default) or horizontal wheel. Delta is in the same units as Windows wheel " +
        "messages, where +/-120 is one notch.",
      inputSchema: {
        delta: z.number().int().min(-32768).max(32767).describe("Positive scrolls up/right, negative scrolls down/left. +/-120 = one notch."),
        horizontal: z.boolean().default(false),
        device: MOUSE_DEVICE_SCHEMA,
      },
    },
    async ({ delta, horizontal, device }: { delta: number; horizontal: boolean; device: number }) => {
      try {
        safety.checkAndConsume(1);
        await bridge.writeMouseWheel(device, delta, horizontal);
        return textResult(`Scrolled ${horizontal ? "horizontal" : "vertical"} wheel by ${delta}.`);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "enable_exclusive_input_mode",
    {
      title: "Enable exclusive input mode",
      description:
        "TESTING/CI USE ONLY - this makes the physical keyboard and mouse stop working for the whole machine. " +
        "Captures every physical key/mouse event on every slot and discards it, so only this MCP session's own " +
        "tool calls (press_key, mouse_move, etc.) reach the target application - useful for deterministic test " +
        "runs where an operator's stray physical input would otherwise flake the test. Requires " +
        "enable_input_control to have been called first. A background watchdog auto-disables this if the MCP " +
        "server stops sending heartbeats for watchdogTimeoutMs, and the OS itself restores physical input the " +
        "instant this process exits for any reason (crash, kill, normal shutdown) - killing the oib_bridge.exe " +
        "process is always a working manual escape hatch, even if this MCP server is unresponsive. Secure " +
        "attention sequences (Ctrl+Alt+Del) are handled by Windows below this driver and are not affected.",
      inputSchema: {
        watchdogTimeoutMs: z
          .number()
          .int()
          .min(1000)
          .max(300000)
          .default(5000)
          .describe("Auto-disable if no heartbeat is received for this many milliseconds (1000-300000, default 5000)."),
      },
    },
    async ({ watchdogTimeoutMs }: { watchdogTimeoutMs: number }) => {
      try {
        safety.checkAndConsume(1);
        const info = await bridge.enableExclusiveMode(watchdogTimeoutMs);
        return textResult(
          `Exclusive input mode enabled. Physical input is now captured and discarded on all ` +
            `${info.keyboardSlotCount} keyboard + ${info.mouseSlotCount} mouse slot(s); only this session's ` +
            `synthetic input reaches the target application. Watchdog timeout: ${info.watchdogTimeoutMs}ms. ` +
            `Call disable_exclusive_input_mode to restore physical input.`,
        );
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "disable_exclusive_input_mode",
    {
      title: "Disable exclusive input mode",
      description:
        "Restores physical keyboard/mouse input. Safe to call any time, including when exclusive mode is " +
        "already off, and deliberately bypasses the arm/rate-limit gate so it always works as an escape hatch.",
      inputSchema: {},
    },
    async () => {
      try {
        const result = await bridge.disableExclusiveMode();
        if (!result.wasActive) {
          return textResult("Exclusive input mode was already off.");
        }
        const warning = result.failedDeviceCount > 0
          ? ` Warning: ${result.failedDeviceCount} device(s) failed to reset - if physical input still seems ` +
            "unresponsive, kill the oib_bridge.exe process (this always restores it)."
          : "";
        return textResult(`Exclusive input mode disabled; physical input restored.${warning}`, result.failedDeviceCount > 0);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "get_exclusive_mode_status",
    {
      title: "Get exclusive input mode status",
      description:
        "Reports whether exclusive input mode is currently active (authoritative, queried live from the " +
        "helper process). Does not require enable_input_control. Note: calling this also refreshes the " +
        "watchdog heartbeat, same as the automatic background heartbeat does.",
      inputSchema: {},
    },
    async () => {
      try {
        const active = await bridge.heartbeat();
        return textResult(JSON.stringify({ exclusiveModeActive: active }));
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
