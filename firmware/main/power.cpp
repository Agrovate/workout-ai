/*
 * power.cpp — status LED + user button + deep sleep for WorkoutBand.
 *
 * Single button (active-low, internal pull-up): short press requests an
 * IMU recalibration (same effect as the BLE CALIBRATE characteristic); a
 * long press (>= POWER_OFF_HOLD_MS) powers the device off via deep sleep.
 * The next press wakes it via EXT0 wake, which re-runs app_main from a
 * cold boot — there's no session state to restore.
 *
 * Uses the devkit's BOOT button (GPIO0) as the user button and the
 * devkit's onboard LED (GPIO2) for status — convenient for development,
 * but GPIO0 is a boot-mode strapping pin. A production PCB should route
 * the user button to a GPIO that isn't tied to boot-mode selection.
 *
 * Single LED, no RGB — pattern communicates state instead of color:
 *   solid              connected to phone
 *   slow blink (1Hz)   advertising, not yet connected
 *   mostly-on blip     charging
 *   fast blink (4Hz)   low battery (should take priority over the above —
 *                      set by whichever caller computes LED mode, e.g. main.cpp)
 */
#include "power.h"
#include "driver/gpio.h"
#include "esp_log.h"
#include "esp_sleep.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static const char *TAG = "power";

#define BUTTON_PIN            GPIO_NUM_0   // devkit BOOT button — active low
#define LED_PIN               GPIO_NUM_2   // devkit onboard LED

#define POWER_OFF_HOLD_MS     3000         // hold this long to power off
#define DEBOUNCE_MS              30
#define POWER_TASK_TICK_MS       50

static volatile int64_t s_press_start_us   = 0;
static volatile bool    s_button_down      = false;
static volatile bool    s_long_press_flag  = false;
static volatile bool    s_short_press_flag = false;

static LedMode s_led_mode = LED_MODE_OFF;

static void IRAM_ATTR button_isr(void *arg)
{
    int64_t now = esp_timer_get_time();
    bool pressed = gpio_get_level(BUTTON_PIN) == 0;

    if (pressed && !s_button_down) {
        s_button_down    = true;
        s_press_start_us = now;
    } else if (!pressed && s_button_down) {
        s_button_down = false;
        int64_t held_ms = (now - s_press_start_us) / 1000;
        if (held_ms >= DEBOUNCE_MS) {
            if (held_ms >= POWER_OFF_HOLD_MS) {
                s_long_press_flag = true;
            } else {
                s_short_press_flag = true;
            }
        }
    }
}

void power_enter_deep_sleep(void)
{
    ESP_LOGI(TAG, "Powering off — press the button to wake");
    gpio_set_level(LED_PIN, 0);
    esp_sleep_enable_ext0_wakeup(BUTTON_PIN, 0);  // wake when button held low
    esp_deep_sleep_start();
}

// ── LED blink + long-press watchdog task ────────────────────────────────────
// Its own small task (rather than piggybacking on ble_task/hr_task) so blink
// timing stays smooth and the power-off check runs regardless of what else
// those tasks are doing.

static void power_task(void *arg)
{
    bool led_on = false;
    int64_t last_toggle_us = 0;

    ESP_LOGI(TAG, "Power task running on core %d", xPortGetCoreID());

    while (true) {
        if (s_long_press_flag) {
            s_long_press_flag = false;
            power_enter_deep_sleep();  // does not return
        }

        int64_t now = esp_timer_get_time();
        int period_ms = 1000;
        bool solid_on = false, solid_off = false;

        switch (s_led_mode) {
            case LED_MODE_CONNECTED:   solid_on  = true;  break;
            case LED_MODE_OFF:         solid_off = true;  break;
            case LED_MODE_ADVERTISING: period_ms = 1000;  break;
            case LED_MODE_CHARGING:    period_ms = 2000;  break;  // mostly-on, brief blip
            case LED_MODE_LOW_BATTERY: period_ms = 250;   break;  // fast, highest priority
        }

        if (solid_on) {
            gpio_set_level(LED_PIN, 1);
        } else if (solid_off) {
            gpio_set_level(LED_PIN, 0);
        } else if ((now - last_toggle_us) / 1000 >= period_ms / 2) {
            led_on = !led_on;
            gpio_set_level(LED_PIN, led_on ? 1 : 0);
            last_toggle_us = now;
        }

        vTaskDelay(pdMS_TO_TICKS(POWER_TASK_TICK_MS));
    }
}

// ── Public API ────────────────────────────────────────────────────────────────

void power_init(void)
{
    gpio_config_t led_conf = {};
    led_conf.pin_bit_mask = 1ULL << LED_PIN;
    led_conf.mode         = GPIO_MODE_OUTPUT;
    gpio_config(&led_conf);
    gpio_set_level(LED_PIN, 0);

    gpio_config_t btn_conf = {};
    btn_conf.pin_bit_mask = 1ULL << BUTTON_PIN;
    btn_conf.mode         = GPIO_MODE_INPUT;
    btn_conf.pull_up_en   = GPIO_PULLUP_ENABLE;
    btn_conf.intr_type    = GPIO_INTR_ANYEDGE;
    gpio_config(&btn_conf);

    gpio_install_isr_service(0);
    gpio_isr_handler_add(BUTTON_PIN, button_isr, NULL);

    xTaskCreatePinnedToCore(power_task, "power_task", 2048, NULL, 1, NULL, 0);

    ESP_LOGI(TAG, "Power management initialised (button GPIO%d, LED GPIO%d)", BUTTON_PIN, LED_PIN);
}

void power_led_set(LedMode mode)
{
    s_led_mode = mode;
}

bool power_check_short_press(void)
{
    if (!s_short_press_flag) return false;
    s_short_press_flag = false;
    return true;
}
