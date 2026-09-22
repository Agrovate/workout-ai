/*
 * hr.cpp — MAX30102 PPG driver + beat/HRV detection for WorkoutBand.
 *
 * WorkoutBand is worn on the wrist, not the fingertip, so the PPG signal is
 * weaker and far more motion-sensitive than a typical pulse-ox clip — the
 * `signal_quality` field on every reading exists specifically so the phone
 * and backend can discount or drop HR/HRV samples taken during a heavy
 * concentric rep rather than trusting a noisy number. Treat WorkoutBand's
 * HR/HRV as a best-effort supplement to Apple Watch HealthKit data, not a
 * clinical-grade replacement.
 *
 * Beat detection: single-channel (RED LED, HR-only mode) adaptive
 * threshold-crossing peak detector over an exponentially-smoothed AC
 * signal — intentionally simple, not a Pan-Tompkins-grade QRS-style
 * detector. Good enough for resting/inter-set HR and a rough RMSSD, not
 * for continuous in-rep HR.
 */

#include "hr.h"
#include "driver/i2c.h"
#include "esp_log.h"
#include "esp_timer.h"
#include <string.h>
#include <math.h>

static const char *TAG = "hr";
static const i2c_port_t I2C_PORT = I2C_NUM_0;

// ── MAX30102 register map ────────────────────────────────────────────────────
#define MAX30102_ADDR       0x57
#define REG_FIFO_WR_PTR     0x04
#define REG_OVF_COUNTER     0x05
#define REG_FIFO_RD_PTR     0x06
#define REG_FIFO_DATA       0x07
#define REG_FIFO_CONFIG     0x08
#define REG_MODE_CONFIG     0x09
#define REG_SPO2_CONFIG     0x0A
#define REG_LED1_PA         0x0C   // RED LED pulse amplitude
#define REG_PART_ID         0xFF
#define MAX30102_PART_ID    0x15

// FIFO_CONFIG: sample avg = 4, FIFO rolls over when full, almost-full = 15
#define FIFO_CONFIG_VAL     0x4F
// MODE_CONFIG: 0b010 = HR-only mode (RED LED, 1 sample = 3 bytes in FIFO)
#define MODE_CONFIG_VAL     0x02
// SPO2_CONFIG: ADC range 4096nA, sample rate 100Hz, pulse width 411us (18-bit)
#define SPO2_CONFIG_VAL     0x27
// LED current — higher than a fingertip module needs, to punch through more
// tissue/skin at the wrist. ~20mA.
#define LED1_PA_VAL         0x66

#define FIFO_SAMPLE_BYTES   3   // one channel (RED) per sample in HR-only mode

// ── Beat detection tuning ────────────────────────────────────────────────────
#define BASELINE_ALPHA        0.03f   // EMA smoothing factor for the DC baseline
#define AMPLITUDE_ALPHA        0.1f   // EMA smoothing factor for AC amplitude estimate
#define THRESHOLD_FRACTION     0.5f   // peak must exceed this fraction of recent AC amplitude
#define MIN_IBI_MS              300   // 200 bpm cap
#define MAX_IBI_MS              2000  // 30 bpm floor
#define REFRACTORY_MS            300  // ignore new peaks this soon after the last one

#define IBI_HISTORY_LEN           12  // beats kept for the rolling HR/RMSSD window
#define HR_UPDATE_PERIOD_US  4000000  // publish at most one reading every 4s

// ── State ─────────────────────────────────────────────────────────────────────
static bool     s_initialized     = false;

static float    s_baseline        = 0.0f;
static float    s_ac_amplitude    = 0.0f;
static float    s_prev_ac         = 0.0f;
static bool     s_rising          = false;
static int64_t  s_last_beat_us    = 0;
static bool     s_have_last_beat  = false;

static uint16_t s_ibi_ms[IBI_HISTORY_LEN];
static int      s_ibi_count       = 0;   // number of valid entries (caps at IBI_HISTORY_LEN)
static int      s_ibi_head        = 0;   // next write index (ring buffer)

static int      s_valid_beats     = 0;
static int      s_rejected_beats  = 0;

static int64_t  s_last_publish_us = 0;
static bool     s_fresh_reading   = false;
static HrReading s_latest         = {0, 0, 0};

// ── I2C helpers ───────────────────────────────────────────────────────────────

static esp_err_t i2c_write_reg(uint8_t reg, uint8_t val)
{
    uint8_t buf[2] = {reg, val};
    return i2c_master_write_to_device(I2C_PORT, MAX30102_ADDR, buf, 2, pdMS_TO_TICKS(10));
}

static esp_err_t i2c_read_regs(uint8_t reg, uint8_t *out, size_t len)
{
    return i2c_master_write_read_device(I2C_PORT, MAX30102_ADDR, &reg, 1, out, len, pdMS_TO_TICKS(10));
}

// ── Beat detection ────────────────────────────────────────────────────────────

static void record_ibi(uint16_t ibi_ms)
{
    s_ibi_ms[s_ibi_head] = ibi_ms;
    s_ibi_head = (s_ibi_head + 1) % IBI_HISTORY_LEN;
    if (s_ibi_count < IBI_HISTORY_LEN) s_ibi_count++;
}

static void maybe_publish_reading(int64_t now_us)
{
    if (s_ibi_count < 3) return;
    if (s_last_publish_us != 0 && (now_us - s_last_publish_us) < HR_UPDATE_PERIOD_US) return;

    // Mean IBI -> bpm
    float sum = 0.0f;
    for (int i = 0; i < s_ibi_count; i++) sum += (float)s_ibi_ms[i];
    float mean_ibi = sum / (float)s_ibi_count;
    uint8_t bpm = (uint8_t)roundf(60000.0f / mean_ibi);

    // RMSSD over successive differences (oldest-to-newest order doesn't
    // matter for RMSSD, only adjacency within the ring buffer does — good
    // enough for a rolling estimate over ~10-12 beats).
    float sq_sum = 0.0f;
    int n_diffs = 0;
    for (int i = 1; i < s_ibi_count; i++) {
        float d = (float)s_ibi_ms[i] - (float)s_ibi_ms[i - 1];
        sq_sum += d * d;
        n_diffs++;
    }
    uint16_t rmssd = n_diffs > 0 ? (uint16_t)roundf(sqrtf(sq_sum / (float)n_diffs)) : 0;

    int total_beats = s_valid_beats + s_rejected_beats;
    uint8_t quality = total_beats > 0
        ? (uint8_t)((100 * s_valid_beats) / total_beats)
        : 0;

    s_latest.bpm             = bpm;
    s_latest.hrv_rmssd_ms    = rmssd;
    s_latest.signal_quality  = quality;
    s_fresh_reading          = true;
    s_last_publish_us        = now_us;

    // Reset the quality window so it reflects only the beats since the last publish.
    s_valid_beats    = 0;
    s_rejected_beats = 0;

    ESP_LOGI(TAG, "HR update: %d bpm, RMSSD %d ms, quality %d%%", bpm, rmssd, quality);
}

static void process_sample(uint32_t raw, int64_t ts_us)
{
    float sample = (float)raw;

    // Track a slow-moving baseline (DC component) and a smoothed AC amplitude
    // estimate, both via simple exponential moving averages.
    if (s_baseline == 0.0f) s_baseline = sample;  // seed on first sample
    s_baseline += BASELINE_ALPHA * (sample - s_baseline);

    float ac = sample - s_baseline;
    float abs_ac = fabsf(ac);
    s_ac_amplitude += AMPLITUDE_ALPHA * (abs_ac - s_ac_amplitude);

    float threshold = s_ac_amplitude * THRESHOLD_FRACTION;

    // Simple rising-then-falling peak detector: a peak is confirmed the
    // sample after ac stops increasing, provided it cleared the dynamic
    // threshold and we're past the refractory period.
    bool now_rising = ac > s_prev_ac;

    if (s_rising && !now_rising && s_prev_ac > threshold) {
        bool refractory_ok = !s_have_last_beat ||
            (ts_us - s_last_beat_us) / 1000 >= REFRACTORY_MS;

        if (refractory_ok) {
            if (s_have_last_beat) {
                int64_t ibi_ms64 = (ts_us - s_last_beat_us) / 1000;
                if (ibi_ms64 >= MIN_IBI_MS && ibi_ms64 <= MAX_IBI_MS) {
                    record_ibi((uint16_t)ibi_ms64);
                    s_valid_beats++;
                } else {
                    s_rejected_beats++;
                }
            }
            s_last_beat_us   = ts_us;
            s_have_last_beat = true;
        }
    }

    s_rising  = now_rising;
    s_prev_ac = ac;

    maybe_publish_reading(ts_us);
}

// ── Public API ────────────────────────────────────────────────────────────────

bool hr_init(void)
{
    uint8_t part_id = 0;
    if (i2c_read_regs(REG_PART_ID, &part_id, 1) != ESP_OK || part_id != MAX30102_PART_ID) {
        ESP_LOGW(TAG, "MAX30102 not found (PART_ID 0x%02X) — HR/HRV disabled", part_id);
        return false;
    }

    i2c_write_reg(REG_FIFO_WR_PTR, 0x00);
    i2c_write_reg(REG_OVF_COUNTER, 0x00);
    i2c_write_reg(REG_FIFO_RD_PTR, 0x00);
    i2c_write_reg(REG_FIFO_CONFIG, FIFO_CONFIG_VAL);
    i2c_write_reg(REG_SPO2_CONFIG, SPO2_CONFIG_VAL);
    i2c_write_reg(REG_LED1_PA, LED1_PA_VAL);
    i2c_write_reg(REG_MODE_CONFIG, MODE_CONFIG_VAL);

    s_initialized = true;
    ESP_LOGI(TAG, "MAX30102 initialised (HR-only mode, ~100Hz)");
    return true;
}

void hr_poll(void)
{
    if (!s_initialized) return;

    uint8_t wr_ptr = 0, rd_ptr = 0;
    if (i2c_read_regs(REG_FIFO_WR_PTR, &wr_ptr, 1) != ESP_OK) return;
    if (i2c_read_regs(REG_FIFO_RD_PTR, &rd_ptr, 1) != ESP_OK) return;

    int available = (wr_ptr - rd_ptr) & 0x1F;  // 32-slot FIFO, ptrs wrap at 32
    if (available == 0) return;

    int64_t now = esp_timer_get_time();
    uint8_t raw[FIFO_SAMPLE_BYTES];
    for (int i = 0; i < available; i++) {
        if (i2c_read_regs(REG_FIFO_DATA, raw, FIFO_SAMPLE_BYTES) != ESP_OK) break;
        uint32_t sample = ((uint32_t)(raw[0] & 0x03) << 16) | ((uint32_t)raw[1] << 8) | raw[2];
        // Distribute timestamps evenly across the drained batch (~10ms/sample at 100Hz)
        int64_t ts = now - (int64_t)(available - 1 - i) * 10000;
        process_sample(sample, ts);
    }
}

bool hr_get_reading(HrReading *out)
{
    if (!s_fresh_reading) return false;
    *out = s_latest;
    s_fresh_reading = false;
    return true;
}
