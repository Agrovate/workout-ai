#pragma once
#include <stdint.h>
#include <stdbool.h>

// A completed heart-rate / HRV reading, refreshed at most once every
// HR_UPDATE_PERIOD_MS (see hr.cpp).
typedef struct {
    uint8_t  bpm;             // rolling average heart rate; 0 if no valid beats yet
    uint16_t hrv_rmssd_ms;    // RMSSD over the recent beat-to-beat interval window
    uint8_t  signal_quality;  // 0-100 confidence — motion artifact drops this fast
} HrReading;

// Initialise the MAX30102 PPG sensor (I2C addr 0x57) in HR-only mode
// (red LED, ~100Hz). Assumes the I2C bus (I2C_NUM_0) is already configured
// by imu_init() — this does NOT call i2c_driver_install again, it just
// probes PART_ID and writes the sensor's own config registers.
// Returns true on success; false leaves the band in IMU-only mode (rep
// detection still works, HR/HRV telemetry is simply omitted).
bool hr_init(void);

// Drain the MAX30102 FIFO and feed new samples into the beat-detection
// state machine. Call periodically (~20ms) from hr_task. A no-op if
// hr_init() did not succeed.
void hr_poll(void);

// Returns true and fills *out with the latest HR/HRV reading if a fresh
// one became available since the last call. Returns false otherwise
// (caller should just skip publishing this cycle).
bool hr_get_reading(HrReading *out);
