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

// Returns true if a phone is currently connected.
bool ble_is_connected(void);
