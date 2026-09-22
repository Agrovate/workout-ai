#pragma once
#include <stdint.h>

// ── BLE UUIDs ─────────────────────────────────────────────────────────────────
// Service: A0000001-0000-1000-8000-00805F9B34FB
// Characteristics:
//   REP_EVENT    A0000002-0000-1000-8000-00805F9B34FB  Notify      8 bytes
//   SET_SUMMARY  A0000003-0000-1000-8000-00805F9B34FB  Notify+Read 12 bytes
//   DEV_STATUS   A0000004-0000-1000-8000-00805F9B34FB  Read        5 bytes
//   CALIBRATE    A0000005-0000-1000-8000-00805F9B34FB  Write       1 byte
//   HR_STATUS    A0000006-0000-1000-8000-00805F9B34FB  Notify+Read 5 bytes

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

// Sent once when the set ends (arm at rest for >3 s of stillness).
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
    uint8_t  battery_pct;          // 0-100, from the VBAT divider (see battery.cpp)
    uint8_t  current_reps;         // reps counted so far in the current set
    uint8_t  firmware_rev;         // monotonic version counter
    uint8_t  flags;                // bit 0 = charging, bit 1 = battery_low
} DeviceStatusPacket;              // 5 bytes

#define DEV_STATUS_FLAG_CHARGING     0x01
#define DEV_STATUS_FLAG_BATTERY_LOW  0x02

// Published at most once every 4s from the onboard PPG sensor (see hr.cpp).
// bpm/hrv_rmssd_ms are 0 until enough beats have been seen; signal_quality
// tracks how many detected beats were rejected as physiologically implausible
// (falls fast under motion artifact from lifting — treat a low value as
// "don't trust this reading" rather than clamping/hiding it).
typedef struct __attribute__((packed)) {
    uint8_t  bpm;               // rolling average heart rate, 0 = no valid signal yet
    uint16_t hrv_rmssd_ms;      // RMSSD over the recent beat-to-beat interval window
    uint8_t  signal_quality;    // 0-100 confidence
    uint8_t  reserved;
} HrStatusPacket;               // 5 bytes

// CALIBRATE characteristic: phone writes 0x01 to trigger gravity recalibration.
// Wrist/arm must be stationary, hanging naturally at the side.
#define CALIBRATE_CMD_TRIGGER  0x01

// Firmware revision — bump on breaking BLE protocol changes.
// rev 2: DeviceStatusPacket grew a `flags` byte (charging/battery_low),
//        HR_STATUS characteristic added.
#define FIRMWARE_REV  2
