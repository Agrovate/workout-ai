#pragma once
#include "proto.h"
#include <stdbool.h>

// Initialise NimBLE, register the GATT table, and start advertising.
// Call once from app_main() after nvs_flash_init().
void ble_init(void);

// Send a REP_EVENT notification to the connected phone (no-op if not connected).
void ble_notify_rep(const RepEventPacket *pkt);

// Send a SET_SUMMARY notification to the connected phone (no-op if not connected).
void ble_notify_set(const SetSummaryPacket *pkt);

// Update the readable DEVICE_STATUS characteristic value.
void ble_update_status(const DeviceStatusPacket *pkt);

// Send an HR_STATUS notification to the connected phone and update the
// readable value (no-op if not connected).
void ble_notify_hr(const HrStatusPacket *pkt);

// Returns true if a phone is currently connected.
bool ble_is_connected(void);

// Returns true once (and only once) per CALIBRATE write received over BLE
// since the last call. imu_task polls this alongside power_check_short_press()
// to decide whether to recalibrate.
bool ble_check_calibrate_request(void);
