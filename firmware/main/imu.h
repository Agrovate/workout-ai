#pragma once
#include <stdint.h>
#include <stdbool.h>

// ── IMU sample ────────────────────────────────────────────────────────────────

typedef struct {
    float ax, ay, az;   // acceleration m/s²  (gravity NOT yet subtracted)
    float gx, gy, gz;   // angular velocity rad/s
    int64_t ts_us;      // esp_timer_get_time() at sample time
} ImuSample;

// ── Public API ────────────────────────────────────────────────────────────────

// Initialise the I2C bus and configure the ICM-42688-P (or MPU-6050).
// sda_pin / scl_pin: GPIO numbers.  freq_hz: typically 400000.
// Returns true on success.
bool imu_init(int sda_pin, int scl_pin, uint32_t freq_hz);

// Collect ~200 samples at rest and compute the gravity offset for each axis.
// Call once after imu_init() with the bar stationary.
void imu_calibrate(void);

// Drain the FIFO and write up to max_samples into buf.
// Returns the number of samples written (may be 0 if FIFO empty).
int imu_read_fifo(ImuSample *buf, int max_samples);

// Return true once imu_calibrate() has completed successfully.
bool imu_is_calibrated(void);

// The calibrated gravity vector (set after imu_calibrate).
// Subtract this from az to get az_net.
extern float g_gravity_z;   // m/s², typically ~9.81
