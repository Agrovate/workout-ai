/*
 * imu.cpp — ICM-42688-P driver via ESP-IDF I2C master.
 *
 * MPU-6050 fallback: swap the register map constants at the bottom of this
 * file (marked MPU-6050 REGISTER MAP).  The rest of the codebase is unchanged.
 *
 * Wiring:  SDA → GPIO21   SCL → GPIO22   (configurable via imu_init args)
 *          VCC → 3.3V      GND → GND      AD0 → GND (I2C addr 0x68)
 */

#include "imu.h"
#include "driver/i2c.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include <string.h>
#include <math.h>

static const char *TAG = "imu";
static const i2c_port_t I2C_PORT = I2C_NUM_0;

// ── ICM-42688-P register map ──────────────────────────────────────────────────
#define ICM_ADDR          0x68
#define REG_DEVICE_CONFIG 0x11
#define REG_PWR_MGMT0     0x4E
#define REG_ACCEL_CONFIG0 0x50
#define REG_GYRO_CONFIG0  0x4F
#define REG_FIFO_CONFIG   0x16
#define REG_FIFO_CONFIG1  0x5F
#define REG_FIFO_COUNTH   0x2E
#define REG_FIFO_COUNTL   0x2F
#define REG_FIFO_DATA     0x30
#define REG_WHO_AM_I      0x75
#define ICM_WHO_AM_I_VAL  0x47   // ICM-42688-P

// ACCEL_FS_SEL=±8g (0b01 << 5), ODR=500Hz (0b0110)
#define ACCEL_CONFIG_VAL  ((0x01 << 5) | 0x06)
// GYRO_FS_SEL=±500dps (0b010 << 5), ODR=500Hz (0b0110)
#define GYRO_CONFIG_VAL   ((0x02 << 5) | 0x06)
// Enable accel + gyro in low-noise mode
#define PWR_MGMT0_VAL     0x0F
// FIFO stream mode, accel+gyro packet
#define FIFO_CONFIG1_VAL  0x07

// Scale factors for ±8g and ±500dps at 16-bit resolution
#define ACCEL_SCALE  (8.0f * 9.81f / 32768.0f)   // m/s² per LSB
#define GYRO_SCALE   (500.0f / 32768.0f * (3.14159265f / 180.0f))  // rad/s per LSB

// FIFO packet: 12 bytes (accel xyz + gyro xyz, each 2 bytes big-endian)
#define FIFO_PACKET_BYTES 12

// ── State ─────────────────────────────────────────────────────────────────────
float g_gravity_z = 9.81f;
static bool s_calibrated = false;
static bool s_initialized = false;

// ── I2C helpers ───────────────────────────────────────────────────────────────

static esp_err_t i2c_write_reg(uint8_t addr, uint8_t reg, uint8_t val)
{
    uint8_t buf[2] = {reg, val};
    return i2c_master_write_to_device(I2C_PORT, addr, buf, 2, pdMS_TO_TICKS(10));
}

static esp_err_t i2c_read_reg(uint8_t addr, uint8_t reg, uint8_t *out, size_t len)
{
    return i2c_master_write_read_device(I2C_PORT, addr, &reg, 1, out, len, pdMS_TO_TICKS(10));
}

static int16_t be16(const uint8_t *p) {
    return (int16_t)((p[0] << 8) | p[1]);
}

// ── Public API ────────────────────────────────────────────────────────────────

bool imu_init(int sda_pin, int scl_pin, uint32_t freq_hz)
{
    i2c_config_t cfg = {};
    cfg.mode = I2C_MODE_MASTER;
    cfg.sda_io_num = (gpio_num_t)sda_pin;
    cfg.scl_io_num = (gpio_num_t)scl_pin;
    cfg.sda_pullup_en = GPIO_PULLUP_ENABLE;
    cfg.scl_pullup_en = GPIO_PULLUP_ENABLE;
    cfg.master.clk_speed = freq_hz;
    cfg.clk_flags = 0;

    ESP_ERROR_CHECK(i2c_param_config(I2C_PORT, &cfg));
    ESP_ERROR_CHECK(i2c_driver_install(I2C_PORT, cfg.mode, 0, 0, 0));

    // Verify chip identity
    uint8_t who = 0;
    if (i2c_read_reg(ICM_ADDR, REG_WHO_AM_I, &who, 1) != ESP_OK || who != ICM_WHO_AM_I_VAL) {
        ESP_LOGE(TAG, "WHO_AM_I mismatch: got 0x%02X (expected 0x%02X)", who, ICM_WHO_AM_I_VAL);
        return false;
    }

    // Soft reset, then wait for it to clear
    i2c_write_reg(ICM_ADDR, REG_DEVICE_CONFIG, 0x01);
    vTaskDelay(pdMS_TO_TICKS(10));

    // Configure sensor
    i2c_write_reg(ICM_ADDR, REG_PWR_MGMT0,     PWR_MGMT0_VAL);
    vTaskDelay(pdMS_TO_TICKS(1));
    i2c_write_reg(ICM_ADDR, REG_ACCEL_CONFIG0,  ACCEL_CONFIG_VAL);
    i2c_write_reg(ICM_ADDR, REG_GYRO_CONFIG0,   GYRO_CONFIG_VAL);

    // Enable FIFO: stream mode, accel + gyro
    i2c_write_reg(ICM_ADDR, REG_FIFO_CONFIG,    0x40);   // stream-to-FIFO mode
    i2c_write_reg(ICM_ADDR, REG_FIFO_CONFIG1,   FIFO_CONFIG1_VAL);

    s_initialized = true;
    ESP_LOGI(TAG, "ICM-42688-P initialised (accel ±8g, gyro ±500dps, ODR 500Hz)");
    return true;
}

void imu_calibrate(void)
{
    if (!s_initialized) return;

    ESP_LOGI(TAG, "Calibrating gravity — keep bar stationary...");
    const int N = 200;
    float sum_az = 0.0f;
    ImuSample buf[16];

    int collected = 0;
    while (collected < N) {
        int got = imu_read_fifo(buf, 16);
        for (int i = 0; i < got && collected < N; i++, collected++) {
            sum_az += buf[i].az;
        }
        vTaskDelay(pdMS_TO_TICKS(10));
    }

    g_gravity_z = sum_az / N;
    s_calibrated = true;
    ESP_LOGI(TAG, "Gravity calibrated: %.4f m/s²", g_gravity_z);
}

bool imu_is_calibrated(void) { return s_calibrated; }

int imu_read_fifo(ImuSample *buf, int max_samples)
{
    if (!s_initialized) return 0;

    // Read FIFO count
    uint8_t cnt_bytes[2];
    if (i2c_read_reg(ICM_ADDR, REG_FIFO_COUNTH, cnt_bytes, 2) != ESP_OK) return 0;
    int count = ((cnt_bytes[0] & 0x0F) << 8) | cnt_bytes[1];
    int packets = count / FIFO_PACKET_BYTES;
    if (packets > max_samples) packets = max_samples;
    if (packets == 0) return 0;

    int64_t ts = esp_timer_get_time();
    uint8_t raw[FIFO_PACKET_BYTES];
    int read = 0;
    for (int i = 0; i < packets; i++) {
        if (i2c_read_reg(ICM_ADDR, REG_FIFO_DATA, raw, FIFO_PACKET_BYTES) != ESP_OK) break;
        buf[read].ax = be16(&raw[0]) * ACCEL_SCALE;
        buf[read].ay = be16(&raw[2]) * ACCEL_SCALE;
        buf[read].az = be16(&raw[4]) * ACCEL_SCALE;
        buf[read].gx = be16(&raw[6]) * GYRO_SCALE;
        buf[read].gy = be16(&raw[8]) * GYRO_SCALE;
        buf[read].gz = be16(&raw[10]) * GYRO_SCALE;
        // Distribute timestamps evenly across the batch (2ms per sample at 500Hz)
        buf[read].ts_us = ts - (int64_t)(packets - 1 - i) * 2000;
        read++;
    }
    return read;
}

/*
 * ── MPU-6050 REGISTER MAP (swap these if using MPU-6050 instead) ─────────────
 *
 * #undef  ICM_ADDR
 * #define ICM_ADDR          0x68
 * #undef  REG_WHO_AM_I
 * #define REG_WHO_AM_I      0x75
 * #undef  ICM_WHO_AM_I_VAL
 * #define ICM_WHO_AM_I_VAL  0x68
 *
 * MPU-6050 config sequence (replace the ICM config block in imu_init):
 *   i2c_write_reg(0x68, 0x6B, 0x00);  // PWR_MGMT_1: wake up
 *   i2c_write_reg(0x68, 0x19, 0x00);  // SMPLRT_DIV: 0 → 1kHz / (1+0) = 1kHz
 *   i2c_write_reg(0x68, 0x1C, 0x10);  // ACCEL_CONFIG: ±8g
 *   i2c_write_reg(0x68, 0x1B, 0x08);  // GYRO_CONFIG: ±500dps
 *
 * MPU-6050 FIFO registers: 0x23 (FIFO_EN), 0x72 (FIFO_COUNTH), 0x74 (FIFO_R_W)
 * ACCEL_SCALE same (±8g, 16-bit) = 8*9.81/32768
 * GYRO_SCALE  same (±500dps, 16-bit)
 *
 * Note: MPU-6050 has no FIFO stream mode; use FIFO_EN register instead.
 * ────────────────────────────────────────────────────────────────────────────
 */
