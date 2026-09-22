#pragma once
#include <stdint.h>
#include <stdbool.h>

typedef enum {
    LED_MODE_OFF,
    LED_MODE_ADVERTISING,  // slow blink — BLE not connected yet
    LED_MODE_CONNECTED,    // solid on
    LED_MODE_CHARGING,     // mostly-on, brief periodic blip
    LED_MODE_LOW_BATTERY,  // fast blink — should take priority over the above
} LedMode;

// Configure the status LED and user button GPIOs, and start the internal
// task that drives the LED blink pattern and watches for a long-press power
// off. Call once from app_main().
void power_init(void);

// Set the status LED's current blink pattern. Cheap — just updates a mode
// variable consumed by the internal blink loop. Call whenever connection/
// battery/charging state changes.
void power_led_set(LedMode mode);

// Returns true once (and only once) per completed short press-and-release
// (below the long-press threshold). Intended to trigger an IMU
// recalibration from the button, alongside the existing BLE CALIBRATE
// characteristic.
bool power_check_short_press(void);

// Configures EXT0 wake on the button pin and enters deep sleep. Does not
// return — the next button press resets the device (there's no state to
// restore; wake behaves like a cold boot). Called automatically by the
// internal power task on a long press — most callers won't need this
// directly.
void power_enter_deep_sleep(void);
