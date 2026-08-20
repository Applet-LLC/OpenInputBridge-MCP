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
 * so requests/responses are hand-parsed/hand-formatted.
 */

#include <windows.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>

/* ---- Protocol constants (docs/PROTOCOL.md) ---- */

#define OIB_MAX_KEYBOARD 10
#define OIB_MAX_MOUSE    10
#define OIB_MAX_DEVICE   (OIB_MAX_KEYBOARD + OIB_MAX_MOUSE)

#define IOCTL_OIB_WRITE \
    CTL_CODE(FILE_DEVICE_UNKNOWN, 0x820, METHOD_BUFFERED, FILE_ANY_ACCESS)
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

/* index: 0-9 = keyboard slot, 10-19 = mouse slot (see docs/PROTOCOL.md) */
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

/* ---- Minimal JSON helpers (hand-rolled; command schema is small/fixed) ---- */

static void JsonEscapeAndPrint(const char *s) {
    for (; *s; s++) {
        if (*s == '"' || *s == '\\') { putchar('\\'); putchar(*s); }
        else if (*s == '\n') { fputs("\\n", stdout); }
        else { putchar(*s); }
    }
}

static void RespondOk(long long id, const char *extraJsonFields /* may be NULL */) {
    printf("{\"id\":%lld,\"ok\":true", id);
    if (extraJsonFields && extraJsonFields[0]) {
        printf(",%s", extraJsonFields);
    }
    printf("}\n");
    fflush(stdout);
}

static void RespondErr(long long id, const char *message) {
    printf("{\"id\":%lld,\"ok\":false,\"error\":\"", id);
    JsonEscapeAndPrint(message);
    printf("\"}\n");
    fflush(stdout);
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

/* ---- Command handlers ---- */

static void HandleStatus(long long id) {
    HANDLE h = GetDeviceHandle(0);
    OIB_DRIVER_IDENTITY identity;
    DWORD bytesReturned = 0;
    char fields[256];

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

    sprintf_s(fields, sizeof(fields), "\"installed\":true,\"versionMajor\":%lu,\"versionMinor\":%lu",
              identity.VersionMajor, identity.VersionMinor);
    RespondOk(id, fields);
}

/* device: 0-9 keyboard slot index (maps to control device index directly) */
static void HandleWriteKey(long long id, int device, int makeCode, int down, int extended) {
    HANDLE h;
    OIB_KEYBOARD_INPUT_DATA data;
    DWORD bytesReturned = 0;

    if (device < 0 || device >= OIB_MAX_KEYBOARD) {
        RespondErr(id, "keyboard device index out of range (0-9)");
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

/* device: 10-19 mouse slot index (maps to control device index directly) */
static void HandleWriteMouseButton(long long id, int device, int buttonFlags) {
    HANDLE h;
    OIB_MOUSE_INPUT_DATA data;
    DWORD bytesReturned = 0;

    if (device < OIB_MAX_KEYBOARD || device >= OIB_MAX_DEVICE) {
        RespondErr(id, "mouse device index out of range (10-19)");
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

    if (device < OIB_MAX_KEYBOARD || device >= OIB_MAX_DEVICE) {
        RespondErr(id, "mouse device index out of range (10-19)");
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

    if (device < OIB_MAX_KEYBOARD || device >= OIB_MAX_DEVICE) {
        RespondErr(id, "mouse device index out of range (10-19)");
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
    } else {
        RespondErr(id, "unknown command");
    }
}

int main(void) {
    char line[4096];

    /* Unbuffered-ish line I/O: parent process reads/writes line by line.
     * MSVC's setvbuf treats a NULL buffer with size 0 as an invalid
     * parameter (it fastfails instead of returning an error), so a
     * nonzero size must be passed even though the CRT owns the buffer. */
    setvbuf(stdout, NULL, _IOLBF, 512);

    ZeroMemory(g_devices, sizeof(g_devices));

    while (fgets(line, sizeof(line), stdin) != NULL) {
        size_t len = strlen(line);
        if (len > 0 && line[len - 1] == '\n') line[len - 1] = '\0';
        if (line[0] == '\0') continue;
        HandleLine(line);
    }

    return 0;
}
