/*
 * imu.cpp — MPU-6500 driver via ESP-IDF I2C master.
 *
 * Wiring:  SDA → GPIO21   SCL → GPIO22   (configurable via imu_init args)
 *          VCC → 3.3V      GND → GND      AD0 → GND (I2C addr 0x68)
 *          NCS → 3.3V (forces I2C mode on breakout boards that also expose SPI)
 *
 * Mounting: worn on the wrist/forearm (band strap), oriented so the
 * accelerometer's Z axis is vertical with the arm relaxed at the side —
 * that's the orientation imu_calibrate() assumes when it samples gravity.
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

// ── MPU-6500 register map ──────────────────────────────────────────────────
#define MPU_ADDR          0x68
#define REG_SMPLRT_DIV    0x19
#define REG_CONFIG        0x1A
#define REG_GYRO_CONFIG   0x1B
#define REG_ACCEL_CONFIG  0x1C
#define REG_FIFO_EN       0x23
#define REG_USER_CTRL     0x6A
#define REG_PWR_MGMT_1    0x6B
#define REG_FIFO_COUNTH   0x72
#define REG_FIFO_COUNTL   0x73
#define REG_FIFO_R_W      0x74
#define REG_WHO_AM_I      0x75
#define MPU_WHO_AM_I_VAL  0x70   // MPU-6500

// AFS_SEL=2 → ±8g
#define ACCEL_CONFIG_VAL  0x10
// FS_SEL=1 → ±500dps
#define GYRO_CONFIG_VAL   0x08
// DLPF_CFG=3 (~44Hz accel / 42Hz gyro bandwidth) — also enables the 1kHz
// internal sample base so SMPLRT_DIV takes effect
#define CONFIG_VAL        0x03
// SMPLRT_DIV=1 → 1kHz / (1+1) = 500Hz
#define SMPLRT_DIV_VAL    0x01
// FIFO_EN: ACCEL + GYRO X/Y/Z, no temperature → 12-byte packet
#define FIFO_EN_VAL       0x78

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
    if (i2c_read_reg(MPU_ADDR, REG_WHO_AM_I, &who, 1) != ESP_OK || who != MPU_WHO_AM_I_VAL) {
        ESP_LOGE(TAG, "WHO_AM_I mismatch: got 0x%02X (expected 0x%02X)", who, MPU_WHO_AM_I_VAL);
        return false;
    }

    // Reset, then wake with PLL clock source
    i2c_write_reg(MPU_ADDR, REG_PWR_MGMT_1, 0x80);
    vTaskDelay(pdMS_TO_TICKS(100));
    i2c_write_reg(MPU_ADDR, REG_PWR_MGMT_1, 0x01);
    vTaskDelay(pdMS_TO_TICKS(10));

    // Configure DLPF/sample rate and full-scale ranges
    i2c_write_reg(MPU_ADDR, REG_CONFIG,       CONFIG_VAL);
    i2c_write_reg(MPU_ADDR, REG_SMPLRT_DIV,   SMPLRT_DIV_VAL);
    i2c_write_reg(MPU_ADDR, REG_GYRO_CONFIG,  GYRO_CONFIG_VAL);
    i2c_write_reg(MPU_ADDR, REG_ACCEL_CONFIG, ACCEL_CONFIG_VAL);

    // Reset FIFO, select accel+gyro streams, then enable FIFO operation
    i2c_write_reg(MPU_ADDR, REG_USER_CTRL, 0x04);
    vTaskDelay(pdMS_TO_TICKS(1));
    i2c_write_reg(MPU_ADDR, REG_FIFO_EN,   FIFO_EN_VAL);
    i2c_write_reg(MPU_ADDR, REG_USER_CTRL, 0x40);

    s_initialized = true;
    ESP_LOGI(TAG, "MPU-6500 initialised (accel ±8g, gyro ±500dps, ODR 500Hz)");
    return true;
}

void imu_calibrate(void)
{
    if (!s_initialized) return;

    ESP_LOGI(TAG, "Calibrating gravity — keep wrist/arm stationary...");
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

    // Read FIFO count (13-bit: 5 bits in COUNTH, 8 bits in COUNTL)
    uint8_t cnt_bytes[2];
    if (i2c_read_reg(MPU_ADDR, REG_FIFO_COUNTH, cnt_bytes, 2) != ESP_OK) return 0;
    int count = ((cnt_bytes[0] & 0x1F) << 8) | cnt_bytes[1];
    int packets = count / FIFO_PACKET_BYTES;
    if (packets > max_samples) packets = max_samples;
    if (packets == 0) return 0;

    int64_t ts = esp_timer_get_time();
    uint8_t raw[FIFO_PACKET_BYTES];
    int read = 0;
    for (int i = 0; i < packets; i++) {
        if (i2c_read_reg(MPU_ADDR, REG_FIFO_R_W, raw, FIFO_PACKET_BYTES) != ESP_OK) break;
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
