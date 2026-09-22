/*
 * battery.cpp — VBAT monitoring + charge-IC status for WorkoutBand.
 *
 * VBAT is sampled through a 2:1 resistor divider (e.g. 100k/100k) into an
 * ADC1 input, so the raw reading is half the actual battery voltage —
 * adjust DIVIDER_RATIO if your board uses different divider resistors.
 *
 * Charging state comes from the charge IC's open-drain STAT pin (e.g.
 * TP4056 pin 7): pulled low while charging, released (pulled up here) when
 * done or not charging.
 */
#include "battery.h"
#include "driver/adc.h"
#include "driver/gpio.h"
#include "esp_log.h"

static const char *TAG = "battery";

// GPIO34 = ADC1_CH6, input-only pin — safe pick for a resistor-divider input
#define BATTERY_ADC_CHANNEL  ADC1_CHANNEL_6
#define DIVIDER_RATIO        2.0f     // VBAT = ADC reading * DIVIDER_RATIO
#define ADC_REF_MV           3300.0f  // approx. Vref for ADC_ATTEN_DB_11 @ 12-bit
#define ADC_MAX_RAW          4095.0f

#define CHARGE_STAT_PIN      GPIO_NUM_4   // active-low input from charge IC STAT pin

#define BATTERY_LOW_PCT      15

static uint8_t s_last_pct = 100;  // optimistic default until the first real read

// Single-cell LiPo discharge curve — piecewise-linear interpolation between
// these (millivolts, percent) points. Not a real fuel-gauge model, just
// enough to turn a voltage reading into something a user can glance at.
struct VoltPoint { int mv; int pct; };
static const VoltPoint kCurve[] = {
    {3300,   0}, {3500,  10}, {3600,  20}, {3700,  40},
    {3750,  55}, {3800,  70}, {3900,  85}, {4000,  95}, {4200, 100},
};
#define CURVE_LEN (sizeof(kCurve) / sizeof(kCurve[0]))

static uint8_t voltage_to_percent(int mv)
{
    if (mv <= kCurve[0].mv) return (uint8_t)kCurve[0].pct;
    if (mv >= kCurve[CURVE_LEN - 1].mv) return (uint8_t)kCurve[CURVE_LEN - 1].pct;

    for (size_t i = 1; i < CURVE_LEN; i++) {
        if (mv <= kCurve[i].mv) {
            const VoltPoint &lo = kCurve[i - 1];
            const VoltPoint &hi = kCurve[i];
            float t = (float)(mv - lo.mv) / (float)(hi.mv - lo.mv);
            return (uint8_t)(lo.pct + t * (float)(hi.pct - lo.pct));
        }
    }
    return 0;  // unreachable
}

void battery_init(void)
{
    adc1_config_width(ADC_WIDTH_BIT_12);
    adc1_config_channel_atten(BATTERY_ADC_CHANNEL, ADC_ATTEN_DB_11);

    gpio_config_t io_conf = {};
    io_conf.pin_bit_mask = 1ULL << CHARGE_STAT_PIN;
    io_conf.mode         = GPIO_MODE_INPUT;
    io_conf.pull_up_en   = GPIO_PULLUP_ENABLE;
    gpio_config(&io_conf);

    ESP_LOGI(TAG, "Battery monitor initialised (ADC1_CH6, STAT on GPIO%d)", CHARGE_STAT_PIN);
}

uint8_t battery_read_percent(void)
{
    int raw = adc1_get_raw(BATTERY_ADC_CHANNEL);
    if (raw < 0) return s_last_pct;  // read failed — keep last known value

    float adc_mv = ((float)raw / ADC_MAX_RAW) * ADC_REF_MV;
    int vbat_mv = (int)(adc_mv * DIVIDER_RATIO);

    s_last_pct = voltage_to_percent(vbat_mv);
    return s_last_pct;
}

bool battery_is_charging(void)
{
    return gpio_get_level(CHARGE_STAT_PIN) == 0;
}

bool battery_is_low(void)
{
    return s_last_pct < BATTERY_LOW_PCT;
}
