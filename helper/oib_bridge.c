/*
 * Copyright (c) 2026 OpenInputBridge-MCP Contributors
 * SPDX-License-Identifier: MIT
 *
 * oib_bridge.exe - minimal user-mode client for the OpenInputBridge driver.
 *
 * This talks directly to the \\.\interceptionNN control devices using the
 * IOCTL protocol documented in the OpenInputBridge repository's
 * docs/PROTOCOL.md. It does not use, link against, or embed any code from
 * oblitum/Interception (LGPL/commercial dual-licensed) - the protocol
 * itself (IOCTL numbers, KEYBOARD_INPUT_DATA/MOUSE_INPUT_DATA layout) is
 * reimplemented independently from that public documentation.
 *
 * Wire format with the parent process (openinputbridge-mcp, Node.js): one
 * JSON object per line on stdin, one JSON object per line on stdout.
 * There is no JSON library dependency - the command set is small and fixed,
 * so requests/responses are hand-parsed/hand-formatted. Most output lines
 * are responses (echo the request "id"); "exclusive mode" auto-disable is
 * the one case where an unsolicited line with no "id" (an "event" instead)
 * can appear, since the watchdog thread can act without a pending request.
 *
 * Exclusive input mode: sets every one of the 20 control devices' handle
 * to the highest chain precedence with a filter that captures every event,
 * and simply never releases what it captures (see docs/PROTOCOL.md's
 * precedence-chain semantics - a captured stroke that is never written
 * back never reaches lower-precedence instances or the real input stream).
 * The per-instance capture queue the driver holds those strokes in is a
 * fixed-size ring buffer (see the driver's own docs/DECISIONS.md-linked
 * source), so never draining it is a bounded, safe way to discard physical
 * input rather than a memory leak. Our own synthetic writes go out through
 * the same handles; because IOCTL_WRITE reinjects strictly *below* the
 * writer in the precedence chain (CallNextHookEx-style), a write from the
 * top-precedence handle bypasses that handle's own capture and reaches the
 * real input stream. A background watchdog thread auto-disables exclusive
 * mode if the parent process stops sending "heartbeat" commands, and the
 * driver itself unconditionally releases the chain/queue when this
 * process's handles close for any reason (normal exit, crash, or being
 * killed) - see README.md/SECURITY.md for the resulting safety model.
 */

#include <windows.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>

/* ---- Protocol constants (docs/PROTOCOL.md) ---- */

#define OIB_MAX_DEVICE 20

/* Fallback only, used if IOCTL_GET_KEYBOARD_SLOT_COUNT cannot be queried
 * (e.g. driver not installed) or returns an out-of-range value. The real
 * boundary is admin-configurable and must normally be queried at runtime -
 * see EnsureKeyboardSlotCount(). Matches the driver's own default. */
#define OIB_DEFAULT_KEYBOARD_SLOT_COUNT 10

#define OIB_FILTER_CAPTURE_ALL      0xFFFF
#define OIB_PRECEDENCE_EXCLUSIVE    0x7FFFFFFFL

#define OIB_DEFAULT_WATCHDOG_TIMEOUT_MS 5000
#define OIB_MIN_WATCHDOG_TIMEOUT_MS     1000
#define OIB_MAX_WATCHDOG_TIMEOUT_MS     300000

#define IOCTL_OIB_SET_PRECEDENCE \
    CTL_CODE(FILE_DEVICE_UNKNOWN, 0x801, METHOD_BUFFERED, FILE_ANY_ACCESS)
#define IOCTL_OIB_SET_FILTER \
    CTL_CODE(FILE_DEVICE_UNKNOWN, 0x804, METHOD_BUFFERED, FILE_ANY_ACCESS)
#define IOCTL_OIB_WRITE \
    CTL_CODE(FILE_DEVICE_UNKNOWN, 0x820, METHOD_BUFFERED, FILE_ANY_ACCESS)
#define IOCTL_OIB_GET_KEYBOARD_SLOT_COUNT \
    CTL_CODE(FILE_DEVICE_UNKNOWN, 0x900, METHOD_BUFFERED, FILE_ANY_ACCESS)
#define IOCTL_OIB_GET_DRIVER_IDENTITY \
    CTL_CODE(FILE_DEVICE_UNKNOWN, 0xA00, METHOD_BUFFERED, FILE_ANY_ACCESS)

#pragma pack(push, 1)
typedef struct _OIB_KEYBOARD_INPUT_DATA {
    USHORT UnitId;
    USHORT MakeCode;
    USHORT Flags;
    USHORT Reserved;
    ULONG  ExtraInformation;
} OIB_KEYBOARD_INPUT_DATA;

typedef struct _OIB_MOUSE_INPUT_DATA {
    USHORT UnitId;
    USHORT Flags;
    USHORT ButtonFlags;
    USHORT ButtonData;
    ULONG  RawButtons;
    LONG   LastX;
    LONG   LastY;
    ULONG  ExtraInformation;
} OIB_MOUSE_INPUT_DATA;

typedef struct _OIB_DRIVER_IDENTITY {
    ULONG   Signature;
    ULONG   VersionMajor;
    ULONG   VersionMinor;
    BOOLEAN IsKeyboard;
} OIB_DRIVER_IDENTITY;
#pragma pack(pop)

#define OIB_IDENTITY_SIGNATURE 0x3142494Fu /* "OIB1" little-endian */

/* KEYBOARD_INPUT_DATA.Flags bits (standard NT DDK) */
#define OIB_KEY_BREAK 0x01
#define OIB_KEY_E0    0x02
#define OIB_KEY_E1    0x04

/* MOUSE_INPUT_DATA.ButtonFlags bits (standard NT DDK) */
#define OIB_MOUSE_LEFT_DOWN    0x0001
#define OIB_MOUSE_LEFT_UP      0x0002
#define OIB_MOUSE_RIGHT_DOWN   0x0004
#define OIB_MOUSE_RIGHT_UP     0x0008
#define OIB_MOUSE_MIDDLE_DOWN  0x0010
#define OIB_MOUSE_MIDDLE_UP    0x0020
#define OIB_MOUSE_BUTTON4_DOWN 0x0040
#define OIB_MOUSE_BUTTON4_UP   0x0080
#define OIB_MOUSE_BUTTON5_DOWN 0x0100
#define OIB_MOUSE_BUTTON5_UP   0x0200
#define OIB_MOUSE_WHEEL        0x0400
#define OIB_MOUSE_HWHEEL       0x0800

/* MOUSE_INPUT_DATA.Flags bits */
#define OIB_MOUSE_MOVE_RELATIVE 0x0000
#define OIB_MOUSE_MOVE_ABSOLUTE 0x0001

/* ---- Device handle cache ---- */

static HANDLE g_devices[OIB_MAX_DEVICE];

/* index: 0..(keyboardSlotCount-1) = keyboard slot, rest = mouse slot (see
 * docs/PROTOCOL.md; the boundary is admin-configurable, see
 * EnsureKeyboardSlotCount()) */
static HANDLE GetDeviceHandle(int index) {
    char path[32];
    if (index < 0 || index >= OIB_MAX_DEVICE) return NULL;
    if (g_devices[index] != NULL && g_devices[index] != INVALID_HANDLE_VALUE) {
        return g_devices[index];
    }
    sprintf_s(path, sizeof(path), "\\\\.\\interception%02d", index);
    g_devices[index] = CreateFileA(path, GENERIC_READ, 0, NULL, OPEN_EXISTING, 0, NULL);
    if (g_devices[index] == INVALID_HANDLE_VALUE) {
        return NULL;
    }
    return g_devices[index];
}

/* ---- Exclusive-mode / watchdog state ----
 * g_exclusiveLock guards every field below and the transition logic in
 * DisableExclusiveModeCore()/HandleEnableExclusiveMode(). g_stdoutLock
 * guards all stdout writes, since the watchdog thread and the main
 * (stdin-processing) thread can both produce output. */
static CRITICAL_SECTION g_stdoutLock;
static CRITICAL_SECTION g_exclusiveLock;
static BOOL g_exclusiveModeActive = FALSE;
static ULONGLONG g_lastHeartbeatTick = 0;
static DWORD g_watchdogTimeoutMs = OIB_DEFAULT_WATCHDOG_TIMEOUT_MS;

/* Cached result of IOCTL_GET_KEYBOARD_SLOT_COUNT; only touched from the
 * main thread (stdin command processing), so it needs no locking. */
static int g_keyboardSlotCount = -1; /* -1 = not yet queried / unknown */

/* ---- Minimal JSON helpers (hand-rolled; command schema is small/fixed) ---- */

static void JsonEscapeAndPrint(const char *s) {
    for (; *s; s++) {
        if (*s == '"' || *s == '\\') { putchar('\\'); putchar(*s); }
        else if (*s == '\n') { fputs("\\n", stdout); }
        else { putchar(*s); }
    }
}

static void RespondOk(long long id, const char *extraJsonFields /* may be NULL */) {
    EnterCriticalSection(&g_stdoutLock);
    printf("{\"id\":%lld,\"ok\":true", id);
    if (extraJsonFields && extraJsonFields[0]) {
        printf(",%s", extraJsonFields);
    }
    printf("}\n");
    fflush(stdout);
    LeaveCriticalSection(&g_stdoutLock);
}

static void RespondErr(long long id, const char *message) {
    EnterCriticalSection(&g_stdoutLock);
    printf("{\"id\":%lld,\"ok\":false,\"error\":\"", id);
    JsonEscapeAndPrint(message);
    printf("\"}\n");
    fflush(stdout);
    LeaveCriticalSection(&g_stdoutLock);
}

/* Unsolicited line (no "id"): only ever emitted by the watchdog thread when
 * it auto-disables exclusive mode because heartbeats stopped arriving. */
static void EmitAutoDisableEvent(const char *reason, int failCount) {
    EnterCriticalSection(&g_stdoutLock);
    printf("{\"event\":\"exclusive_mode_auto_disabled\",\"reason\":\"");
    JsonEscapeAndPrint(reason);
    printf("\",\"failedDeviceCount\":%d}\n", failCount);
    fflush(stdout);
    LeaveCriticalSection(&g_stdoutLock);
}

/* Extracts the integer value of "field":NUMBER from a flat JSON object line.
 * Returns 1 on success, 0 if the field is absent. Good enough for our
 * fixed, flat, non-nested command schema. */
static int JsonGetInt(const char *line, const char *field, long *out) {
    char pattern[64];
    const char *p;
    sprintf_s(pattern, sizeof(pattern), "\"%s\"", field);
    p = strstr(line, pattern);
    if (!p) return 0;
    p = strchr(p + strlen(pattern), ':');
    if (!p) return 0;
    p++;
    while (*p == ' ') p++;
    *out = strtol(p, NULL, 10);
    return 1;
}

/* ---- Keyboard/mouse slot boundary ----
 * The 10/10 keyboard/mouse split is only the driver's default; an admin
 * can reconfigure it (KeyboardSlotCount), so it must be queried, not
 * assumed. See docs/PROTOCOL.md "デバイス構成". */
static int EnsureKeyboardSlotCount(void) {
    HANDLE h;
    ULONG count;
    DWORD bytesReturned;

    if (g_keyboardSlotCount >= 0) return g_keyboardSlotCount;

    h = GetDeviceHandle(0);
    if (h == NULL) return -1;

    count = 0;
    bytesReturned = 0;
    if (!DeviceIoControl(h, IOCTL_OIB_GET_KEYBOARD_SLOT_COUNT, NULL, 0,
                          &count, sizeof(count), &bytesReturned, NULL)) {
        return -1;
    }
    if (count > OIB_MAX_DEVICE) {
        count = OIB_DEFAULT_KEYBOARD_SLOT_COUNT;
    }
    g_keyboardSlotCount = (int)count;
    return g_keyboardSlotCount;
}

/* ---- Command handlers ---- */

static void HandleStatus(long long id) {
    HANDLE h = GetDeviceHandle(0);
    OIB_DRIVER_IDENTITY identity;
    DWORD bytesReturned = 0;
    char fields[256];
    int kbCount;
    BOOL active;

    if (h == NULL) {
        RespondErr(id, "OpenInputBridge control device not found. Is the driver installed and running?");
        return;
    }

    ZeroMemory(&identity, sizeof(identity));
    if (!DeviceIoControl(h, IOCTL_OIB_GET_DRIVER_IDENTITY, NULL, 0,
                          &identity, sizeof(identity), &bytesReturned, NULL)) {
        RespondErr(id, "IOCTL_GET_DRIVER_IDENTITY failed. Driver may be a real Interception driver, not OpenInputBridge, or an unsupported version.");
        return;
    }

    if (identity.Signature != OIB_IDENTITY_SIGNATURE) {
        RespondErr(id, "Connected control device did not identify as OpenInputBridge (unexpected signature).");
        return;
    }

    kbCount = EnsureKeyboardSlotCount();

    EnterCriticalSection(&g_exclusiveLock);
    active = g_exclusiveModeActive;
    LeaveCriticalSection(&g_exclusiveLock);

    if (kbCount < 0) {
        sprintf_s(fields, sizeof(fields),
                  "\"installed\":true,\"versionMajor\":%lu,\"versionMinor\":%lu,\"exclusiveModeActive\":%s",
                  identity.VersionMajor, identity.VersionMinor, active ? "true" : "false");
    } else {
        sprintf_s(fields, sizeof(fields),
                  "\"installed\":true,\"versionMajor\":%lu,\"versionMinor\":%lu,"
                  "\"keyboardSlotCount\":%d,\"mouseSlotCount\":%d,\"exclusiveModeActive\":%s",
                  identity.VersionMajor, identity.VersionMinor,
                  kbCount, OIB_MAX_DEVICE - kbCount, active ? "true" : "false");
    }
    RespondOk(id, fields);
}

/* device: keyboard slot index (0..keyboardSlotCount-1) */
static void HandleWriteKey(long long id, int device, int makeCode, int down, int extended) {
    HANDLE h;
    OIB_KEYBOARD_INPUT_DATA data;
    DWORD bytesReturned = 0;
    int kbCount = EnsureKeyboardSlotCount();

    if (kbCount < 0) {
        RespondErr(id, "could not determine keyboard slot count. Is the driver installed and running?");
        return;
    }
    if (device < 0 || device >= kbCount) {
        RespondErr(id, "keyboard device index out of range");
        return;
    }
    h = GetDeviceHandle(device);
    if (h == NULL) {
        RespondErr(id, "keyboard control device not available");
        return;
    }

    ZeroMemory(&data, sizeof(data));
    data.UnitId = 0;
    data.MakeCode = (USHORT)makeCode;
    data.Flags = (USHORT)((down ? 0 : OIB_KEY_BREAK) | (extended ? OIB_KEY_E0 : 0));
    data.ExtraInformation = 0;

    if (!DeviceIoControl(h, IOCTL_OIB_WRITE, &data, sizeof(data), NULL, 0, &bytesReturned, NULL)) {
        RespondErr(id, "IOCTL_WRITE (keyboard) failed");
        return;
    }
    RespondOk(id, NULL);
}

/* device: mouse slot index (keyboardSlotCount..19) */
static void HandleWriteMouseButton(long long id, int device, int buttonFlags) {
    HANDLE h;
    OIB_MOUSE_INPUT_DATA data;
    DWORD bytesReturned = 0;
    int kbCount = EnsureKeyboardSlotCount();

    if (kbCount < 0) {
        RespondErr(id, "could not determine keyboard/mouse slot boundary. Is the driver installed and running?");
        return;
    }
    if (device < kbCount || device >= OIB_MAX_DEVICE) {
        RespondErr(id, "mouse device index out of range");
        return;
    }
    h = GetDeviceHandle(device);
    if (h == NULL) {
        RespondErr(id, "mouse control device not available");
        return;
    }

    ZeroMemory(&data, sizeof(data));
    data.Flags = OIB_MOUSE_MOVE_RELATIVE;
    data.ButtonFlags = (USHORT)buttonFlags;

    if (!DeviceIoControl(h, IOCTL_OIB_WRITE, &data, sizeof(data), NULL, 0, &bytesReturned, NULL)) {
        RespondErr(id, "IOCTL_WRITE (mouse button) failed");
        return;
    }
    RespondOk(id, NULL);
}

static void HandleWriteMouseMove(long long id, int device, int x, int y, int absolute) {
    HANDLE h;
    OIB_MOUSE_INPUT_DATA data;
    DWORD bytesReturned = 0;
    int kbCount = EnsureKeyboardSlotCount();

    if (kbCount < 0) {
        RespondErr(id, "could not determine keyboard/mouse slot boundary. Is the driver installed and running?");
        return;
    }
    if (device < kbCount || device >= OIB_MAX_DEVICE) {
        RespondErr(id, "mouse device index out of range");
        return;
    }
    h = GetDeviceHandle(device);
    if (h == NULL) {
        RespondErr(id, "mouse control device not available");
        return;
    }

    ZeroMemory(&data, sizeof(data));
    data.Flags = absolute ? OIB_MOUSE_MOVE_ABSOLUTE : OIB_MOUSE_MOVE_RELATIVE;
    data.LastX = x;
    data.LastY = y;

    if (!DeviceIoControl(h, IOCTL_OIB_WRITE, &data, sizeof(data), NULL, 0, &bytesReturned, NULL)) {
        RespondErr(id, "IOCTL_WRITE (mouse move) failed");
        return;
    }
    RespondOk(id, NULL);
}

static void HandleWriteMouseWheel(long long id, int device, int rolling, int horizontal) {
    HANDLE h;
    OIB_MOUSE_INPUT_DATA data;
    DWORD bytesReturned = 0;
    int kbCount = EnsureKeyboardSlotCount();

    if (kbCount < 0) {
        RespondErr(id, "could not determine keyboard/mouse slot boundary. Is the driver installed and running?");
        return;
    }
    if (device < kbCount || device >= OIB_MAX_DEVICE) {
        RespondErr(id, "mouse device index out of range");
        return;
    }
    h = GetDeviceHandle(device);
    if (h == NULL) {
        RespondErr(id, "mouse control device not available");
        return;
    }

    ZeroMemory(&data, sizeof(data));
    data.Flags = OIB_MOUSE_MOVE_RELATIVE;
    data.ButtonFlags = (USHORT)(horizontal ? OIB_MOUSE_HWHEEL : OIB_MOUSE_WHEEL);
    data.ButtonData = (USHORT)rolling;

    if (!DeviceIoControl(h, IOCTL_OIB_WRITE, &data, sizeof(data), NULL, 0, &bytesReturned, NULL)) {
        RespondErr(id, "IOCTL_WRITE (mouse wheel) failed");
        return;
    }
    RespondOk(id, NULL);
}

/* ---- Exclusive input mode ----
 * See the file header comment for the mechanism. Callers of
 * DisableExclusiveModeCore() must hold g_exclusiveLock. Returns -1 if
 * exclusive mode was not active (nothing to do), otherwise the number of
 * devices (0..OIB_MAX_DEVICE) whose filter/precedence reset IOCTL failed -
 * best-effort: every device is attempted regardless of earlier failures,
 * since leaving any device still capturing is worse than reporting a
 * partial failure and letting the caller decide what to do next
 * (README/SECURITY.md: killing this process is the guaranteed fallback,
 * since only a device's own open handle can change its filter). */
static int DisableExclusiveModeCore(void) {
    int i;
    int failCount;
    LONG zeroPrecedence;
    USHORT zeroFilter;
    DWORD bytesReturned;
    HANDLE h;
    BOOL ok1, ok2;

    if (!g_exclusiveModeActive) return -1;

    failCount = 0;
    zeroPrecedence = 0;
    zeroFilter = 0;
    bytesReturned = 0;

    for (i = 0; i < OIB_MAX_DEVICE; i++) {
        h = g_devices[i];
        if (h == NULL || h == INVALID_HANDLE_VALUE) continue;
        ok1 = DeviceIoControl(h, IOCTL_OIB_SET_FILTER, &zeroFilter, sizeof(zeroFilter), NULL, 0, &bytesReturned, NULL);
        ok2 = DeviceIoControl(h, IOCTL_OIB_SET_PRECEDENCE, &zeroPrecedence, sizeof(zeroPrecedence), NULL, 0, &bytesReturned, NULL);
        if (!ok1 || !ok2) failCount++;
    }

    g_exclusiveModeActive = FALSE;
    return failCount;
}

static void HandleEnableExclusiveMode(long long id, long watchdogTimeoutMsIn) {
    int i, j;
    int kbCount;
    HANDLE h;
    LONG precedence, zeroPrecedence;
    USHORT filterAll, zeroFilter;
    DWORD bytesReturned;
    DWORD timeoutMs;
    char fields[128];

    precedence = OIB_PRECEDENCE_EXCLUSIVE;
    filterAll = OIB_FILTER_CAPTURE_ALL;
    zeroPrecedence = 0;
    zeroFilter = 0;
    bytesReturned = 0;
    timeoutMs = OIB_DEFAULT_WATCHDOG_TIMEOUT_MS;
    if (watchdogTimeoutMsIn >= OIB_MIN_WATCHDOG_TIMEOUT_MS && watchdogTimeoutMsIn <= OIB_MAX_WATCHDOG_TIMEOUT_MS) {
        timeoutMs = (DWORD)watchdogTimeoutMsIn;
    }

    EnterCriticalSection(&g_exclusiveLock);

    kbCount = EnsureKeyboardSlotCount();
    if (kbCount < 0) {
        LeaveCriticalSection(&g_exclusiveLock);
        RespondErr(id, "could not determine keyboard/mouse slot boundary (IOCTL_GET_KEYBOARD_SLOT_COUNT failed); is the driver installed and running?");
        return;
    }

    /* Open every control device up front; abort without touching any
     * filter/precedence if even one is unavailable. */
    for (i = 0; i < OIB_MAX_DEVICE; i++) {
        if (GetDeviceHandle(i) == NULL) {
            LeaveCriticalSection(&g_exclusiveLock);
            RespondErr(id, "could not open all 20 control devices; exclusive mode requires every \\\\.\\interceptionNN device to be available");
            return;
        }
    }

    /* Arm every device to top precedence + capture-all filter. If any
     * IOCTL fails partway through, roll back the devices already armed so
     * we never leave a partial lockout (some devices capturing, some
     * not). */
    for (i = 0; i < OIB_MAX_DEVICE; i++) {
        h = g_devices[i];
        if (!DeviceIoControl(h, IOCTL_OIB_SET_PRECEDENCE, &precedence, sizeof(precedence), NULL, 0, &bytesReturned, NULL) ||
            !DeviceIoControl(h, IOCTL_OIB_SET_FILTER, &filterAll, sizeof(filterAll), NULL, 0, &bytesReturned, NULL)) {
            for (j = 0; j < i; j++) {
                DeviceIoControl(g_devices[j], IOCTL_OIB_SET_FILTER, &zeroFilter, sizeof(zeroFilter), NULL, 0, &bytesReturned, NULL);
                DeviceIoControl(g_devices[j], IOCTL_OIB_SET_PRECEDENCE, &zeroPrecedence, sizeof(zeroPrecedence), NULL, 0, &bytesReturned, NULL);
            }
            LeaveCriticalSection(&g_exclusiveLock);
            RespondErr(id, "failed to arm exclusive mode on all devices; rolled back to a safe (non-capturing) state");
            return;
        }
    }

    g_exclusiveModeActive = TRUE;
    g_watchdogTimeoutMs = timeoutMs;
    g_lastHeartbeatTick = GetTickCount64();

    LeaveCriticalSection(&g_exclusiveLock);

    sprintf_s(fields, sizeof(fields),
              "\"keyboardSlotCount\":%d,\"mouseSlotCount\":%d,\"watchdogTimeoutMs\":%lu",
              kbCount, OIB_MAX_DEVICE - kbCount, (unsigned long)timeoutMs);
    RespondOk(id, fields);
}

static void HandleDisableExclusiveMode(long long id) {
    int failCount;
    char fields[64];

    EnterCriticalSection(&g_exclusiveLock);
    failCount = DisableExclusiveModeCore();
    LeaveCriticalSection(&g_exclusiveLock);

    if (failCount < 0) {
        RespondOk(id, "\"wasActive\":false");
        return;
    }

    sprintf_s(fields, sizeof(fields), "\"wasActive\":true,\"failedDeviceCount\":%d", failCount);
    RespondOk(id, fields);
}

/* Refreshes the watchdog deadline. The parent process must call this
 * periodically (well under watchdogTimeoutMs) while exclusive mode is
 * active, or the watchdog thread will auto-disable it. */
static void HandleHeartbeat(long long id) {
    BOOL active;
    char fields[48];

    EnterCriticalSection(&g_exclusiveLock);
    if (g_exclusiveModeActive) {
        g_lastHeartbeatTick = GetTickCount64();
    }
    active = g_exclusiveModeActive;
    LeaveCriticalSection(&g_exclusiveLock);

    sprintf_s(fields, sizeof(fields), "\"exclusiveModeActive\":%s", active ? "true" : "false");
    RespondOk(id, fields);
}

/* The loop below never exits while the process is alive, so the trailing
 * `return 0;` (required to satisfy the WINAPI thread-proc signature) is
 * unreachable; disabled for this function rather than worked around, since
 * MSVC's flow analysis flags it at the closing brace, not the statement. */
#pragma warning(push)
#pragma warning(disable: 4702)
static DWORD WINAPI WatchdogThreadProc(LPVOID unused) {
    int timedOut;
    int failCount;
    ULONGLONG now;

    (void)unused;

    for (;;) {
        timedOut = 0;
        failCount = 0;

        Sleep(500);

        EnterCriticalSection(&g_exclusiveLock);
        if (g_exclusiveModeActive) {
            now = GetTickCount64();
            if (now - g_lastHeartbeatTick > (ULONGLONG)g_watchdogTimeoutMs) {
                failCount = DisableExclusiveModeCore();
                timedOut = 1;
            }
        }
        LeaveCriticalSection(&g_exclusiveLock);

        if (timedOut) {
            EmitAutoDisableEvent("heartbeat_timeout", failCount);
        }
    }

    return 0;
}
#pragma warning(pop)

/* ---- Command dispatch ---- */

static int LineStartsWithCmd(const char *line, const char *cmd) {
    char pattern[64];
    sprintf_s(pattern, sizeof(pattern), "\"cmd\":\"%s\"", cmd);
    return strstr(line, pattern) != NULL;
}

static void HandleLine(char *line) {
    long id = 0;
    long device = 0, makeCode = 0, down = 1, extended = 0;
    long buttonFlags = 0, x = 0, y = 0, absolute = 0, rolling = 0, horizontal = 0;
    long watchdogTimeoutMs = OIB_DEFAULT_WATCHDOG_TIMEOUT_MS;

    JsonGetInt(line, "id", &id);

    if (LineStartsWithCmd(line, "status")) {
        HandleStatus(id);
    } else if (LineStartsWithCmd(line, "write_key")) {
        JsonGetInt(line, "device", &device);
        JsonGetInt(line, "makeCode", &makeCode);
        JsonGetInt(line, "down", &down);
        JsonGetInt(line, "extended", &extended);
        HandleWriteKey(id, (int)device, (int)makeCode, (int)down, (int)extended);
    } else if (LineStartsWithCmd(line, "write_mouse_button")) {
        JsonGetInt(line, "device", &device);
        JsonGetInt(line, "buttonFlags", &buttonFlags);
        HandleWriteMouseButton(id, (int)device, (int)buttonFlags);
    } else if (LineStartsWithCmd(line, "write_mouse_move")) {
        JsonGetInt(line, "device", &device);
        JsonGetInt(line, "x", &x);
        JsonGetInt(line, "y", &y);
        JsonGetInt(line, "absolute", &absolute);
        HandleWriteMouseMove(id, (int)device, (int)x, (int)y, (int)absolute);
    } else if (LineStartsWithCmd(line, "write_mouse_wheel")) {
        JsonGetInt(line, "device", &device);
        JsonGetInt(line, "rolling", &rolling);
        JsonGetInt(line, "horizontal", &horizontal);
        HandleWriteMouseWheel(id, (int)device, (int)rolling, (int)horizontal);
    } else if (LineStartsWithCmd(line, "enable_exclusive_input_mode")) {
        JsonGetInt(line, "watchdogTimeoutMs", &watchdogTimeoutMs);
        HandleEnableExclusiveMode(id, watchdogTimeoutMs);
    } else if (LineStartsWithCmd(line, "disable_exclusive_input_mode")) {
        HandleDisableExclusiveMode(id);
    } else if (LineStartsWithCmd(line, "heartbeat")) {
        HandleHeartbeat(id);
    } else {
        RespondErr(id, "unknown command");
    }
}

int main(void) {
    char line[4096];
    HANDLE watchdogThread;

    /* Unbuffered-ish line I/O: parent process reads/writes line by line.
     * MSVC's setvbuf treats a NULL buffer with size 0 as an invalid
     * parameter (it fastfails instead of returning an error), so a
     * nonzero size must be passed even though the CRT owns the buffer. */
    setvbuf(stdout, NULL, _IOLBF, 512);

    ZeroMemory(g_devices, sizeof(g_devices));
    InitializeCriticalSection(&g_stdoutLock);
    InitializeCriticalSection(&g_exclusiveLock);

    watchdogThread = CreateThread(NULL, 0, WatchdogThreadProc, NULL, 0, NULL);
    if (watchdogThread != NULL) {
        CloseHandle(watchdogThread); /* detach; the thread runs for the process lifetime */
    } else {
        fprintf(stderr, "oib_bridge: warning: failed to start exclusive-mode watchdog thread\n");
    }

    while (fgets(line, sizeof(line), stdin) != NULL) {
        size_t len = strlen(line);
        if (len > 0 && line[len - 1] == '\n') line[len - 1] = '\0';
        if (line[0] == '\0') continue;
        HandleLine(line);
    }

    return 0;
}
