#pragma once
#include <stdint.h>

// ── BLE UUIDs ─────────────────────────────────────────────────────────────────
// Service: A0000001-0000-1000-8000-00805F9B34FB
// Characteristics:
//   REP_EVENT    A0000002-0000-1000-8000-00805F9B34FB  Notify      8 bytes
//   SET_SUMMARY  A0000003-0000-1000-8000-00805F9B34FB  Notify+Read 12 bytes
//   DEV_STATUS   A0000004-0000-1000-8000-00805F9B34FB  Read        4 bytes
//   CALIBRATE    A0000005-0000-1000-8000-00805F9B34FB  Write       1 byte

// ── Packet layouts (little-endian, packed, no padding) ────────────────────────

// Sent on every completed rep.
typedef struct __attribute__((packed)) {
    uint8_t  set_number;           // 1-based
    uint8_t  rep_number;           // 1-based within the set
    uint16_t peak_velocity_mm_s;   // peak concentric velocity in mm/s
    uint16_t mean_velocity_mm_s;   // mean concentric velocity (MCV) in mm/s
    uint8_t  flags;                // bit 0 = velocity_valid (0 if calibration failed)
    uint8_t  reserved;
} RepEventPacket;                  // 8 bytes — fits in one BLE 4.2 notification

// Sent once when the set ends (bar racked for >3 s of stillness).
typedef struct __attribute__((packed)) {
    uint8_t  set_number;
    uint8_t  total_reps;
    uint16_t avg_velocity_mm_s;
    uint16_t peak_velocity_mm_s;   // best rep of the set
    uint16_t set_duration_s;
    uint8_t  velocity_loss_pct;    // drop from rep 1 to last rep, 0-100
    uint8_t  reserved[3];
} SetSummaryPacket;                // 12 bytes — fits in one BLE 4.2 notification

// Readable at any time by the phone.
typedef struct __attribute__((packed)) {
    uint8_t  state;                // 0=idle, 1=in_set, 2=calibrating
    uint8_t  battery_pct;          // 0-100 (requires ADC on VBAT pin)
    uint8_t  current_reps;         // reps counted so far in the current set
    uint8_t  firmware_rev;         // monotonic version counter
} DeviceStatusPacket;              // 4 bytes

// CALIBRATE characteristic: phone writes 0x01 to trigger gravity recalibration.
// Bar must be stationary and horizontal.
#define CALIBRATE_CMD_TRIGGER  0x01

// Firmware revision — bump on breaking BLE protocol changes.
#define FIRMWARE_REV  1
