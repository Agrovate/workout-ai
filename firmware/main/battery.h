#pragma once
#include <stdint.h>
#include <stdbool.h>

// Configure the ADC channel used to sample VBAT (through a resistor divider)
// and the charge-IC STAT input. Call once from app_main().
void battery_init(void);

// Sample VBAT and return an estimated charge percentage (0-100) from a
// single-cell LiPo discharge-curve lookup. Approximate — this is a simple
// voltage-divider read, not a fuel-gauge IC — treat it as a rough indicator,
// not a precise mAh count. Also updates the cached value battery_is_low()
// reads, so call this before checking battery_is_low() each cycle.
uint8_t battery_read_percent(void);

// True while the charge IC's STAT pin reports an active charge cycle.
bool battery_is_charging(void);

// True if the last battery_read_percent() result was below BATTERY_LOW_PCT.
bool battery_is_low(void);
