/*
 * main.cpp — WorkoutBand firmware entry point.
 *
 * WorkoutBand is worn on the wrist or forearm during lifting (not
 * barbell-mounted) — see imu.cpp / signal.cpp for the IMU orientation and
 * rep-detection assumptions that follow from that.
 *
 * Architecture:
 *   imu_task  (core 1, priority 5) — samples IMU at 500Hz, runs signal
 *             processor, pushes events onto event_queue.
 *   ble_task  (core 0, priority 3) — drains event_queue, sends BLE
 *             notifications to the connected phone.
 *   hr_task   (core 0, priority 2) — polls the onboard MAX30102 PPG sensor,
 *             publishes an HR/HRV reading over BLE at most once every 4s.
 *             Lower priority than ble_task since HR updates are coarse and
 *             non-latency-critical, unlike rep/set events.
 *   power_task (core 0, priority 1, started by power_init()) — drives the
 *             status LED blink pattern and watches the button for a
 *             long-press power-off. Lowest priority — cosmetic/background.
 *
 * Separating tasks across cores keeps BLE interrupts (core 0) from adding
 * jitter to the IMU sampling loop (core 1). hr_task and power_task share
 * core 0 with ble_task — neither's workload is remotely close to the IMU's
 * 500Hz timing requirement, so they don't reintroduce the jitter problem
 * the core split exists to avoid.
 *
 * Build:  idf.py build
 * Flash:  idf.py -p /dev/ttyUSB0 flash monitor
 */

#include <cstring>

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include "nvs_flash.h"
#include "esp_log.h"
#include "esp_timer.h"

#include "imu.h"
#include "signal.h"
#include "hr.h"
#include "battery.h"
#include "power.h"
#include "ble.h"
#include "proto.h"

static const char *TAG = "main";

// GPIO pins — standard ESP32 devkit I2C pins
#define IMU_SDA_PIN  21
#define IMU_SCL_PIN  22
#define IMU_FREQ_HZ  400000

// IMU task: drain FIFO every 20ms (yields 10 samples at 500Hz ODR)
#define IMU_POLL_MS  20

// HR task: drain the MAX30102 FIFO every 20ms (~2 samples at 100Hz ODR)
#define HR_POLL_MS  20

// Queue depth: up to 8 events can buffer while BLE task is busy
#define EVENT_QUEUE_DEPTH  8

static QueueHandle_t s_event_queue;

// ── IMU task (core 1) ─────────────────────────────────────────────────────────

static void imu_task(void *arg)
{
    ImuSample buf[32];
    SignalEvent ev;

    // Wait for NimBLE to initialise before calibrating
    // (calibration takes ~200 samples = ~2s at 100Hz drain)
    vTaskDelay(pdMS_TO_TICKS(500));
    imu_calibrate();

    ESP_LOGI(TAG, "IMU task running on core %d", xPortGetCoreID());

    while (true) {
        // Recalibration can be requested either over BLE (CALIBRATE
        // characteristic) or via a short press of the physical button —
        // both funnel through here since imu_task owns the calibrated state.
        if (ble_check_calibrate_request() || power_check_short_press()) {
            ESP_LOGI(TAG, "Recalibration requested — keep wrist/arm stationary");
            imu_calibrate();
        }

        int n = imu_read_fifo(buf, 32);
        if (n > 0 && imu_is_calibrated()) {
            if (signal_process(buf, n, &ev)) {
                // Non-blocking send — drop event if queue is full (shouldn't happen)
                xQueueSend(s_event_queue, &ev, 0);
            }
        }
        vTaskDelay(pdMS_TO_TICKS(IMU_POLL_MS));
    }
}

// ── BLE task (core 0) ─────────────────────────────────────────────────────────

static void ble_task(void *arg)
{
    SignalEvent ev;
    uint8_t current_reps = 0;
    uint8_t state = 0;  // 0=idle, 1=in_set — persists across ticks with no event

    ESP_LOGI(TAG, "BLE task running on core %d", xPortGetCoreID());

    while (true) {
        // Block up to 100ms waiting for an event
        if (xQueueReceive(s_event_queue, &ev, pdMS_TO_TICKS(100)) == pdTRUE) {
            state = ev.type == EVT_SET_COMPLETE ? 0 : 1;

            if (ev.type == EVT_REP_COMPLETE) {
                current_reps = ev.rep_number;

                RepEventPacket pkt = {};
                pkt.set_number        = ev.set_number;
                pkt.rep_number        = ev.rep_number;
                pkt.peak_velocity_mm_s = ev.peak_velocity_mm_s;
                pkt.mean_velocity_mm_s = ev.mean_velocity_mm_s;
                pkt.flags             = ev.velocity_valid ? 0x01 : 0x00;
                pkt.reserved          = 0;

                ble_notify_rep(&pkt);

            } else if (ev.type == EVT_SET_COMPLETE) {
                current_reps = 0;

                SetSummaryPacket pkt = {};
                pkt.set_number        = ev.set_number;
                pkt.total_reps        = ev.total_reps;
                pkt.avg_velocity_mm_s = ev.avg_velocity_mm_s;
                pkt.peak_velocity_mm_s = ev.peak_velocity_mm_s;
                pkt.set_duration_s    = ev.set_duration_s;
                pkt.velocity_loss_pct = ev.velocity_loss_pct;
                memset(pkt.reserved, 0, sizeof(pkt.reserved));

                ble_notify_set(&pkt);
            }
        }

        // Runs every ~100ms tick regardless of whether an event arrived, so
        // battery/charging/connection state (which change independently of
        // rep/set activity) stay current on both the readable characteristic
        // and the status LED.
        uint8_t battery_pct = battery_read_percent();
        bool charging = battery_is_charging();
        bool low_batt = battery_is_low();

        DeviceStatusPacket status = {};
        status.state         = state;
        status.battery_pct   = battery_pct;
        status.current_reps  = current_reps;
        status.firmware_rev  = FIRMWARE_REV;
        status.flags         = (charging ? DEV_STATUS_FLAG_CHARGING    : 0)
                              | (low_batt ? DEV_STATUS_FLAG_BATTERY_LOW : 0);
        ble_update_status(&status);

        if (low_batt)             power_led_set(LED_MODE_LOW_BATTERY);
        else if (charging)        power_led_set(LED_MODE_CHARGING);
        else if (ble_is_connected()) power_led_set(LED_MODE_CONNECTED);
        else                      power_led_set(LED_MODE_ADVERTISING);
    }
}

// ── HR task (core 0) ──────────────────────────────────────────────────────────

static void hr_task(void *arg)
{
    ESP_LOGI(TAG, "HR task running on core %d", xPortGetCoreID());

    while (true) {
        hr_poll();

        HrReading reading;
        if (hr_get_reading(&reading)) {
            HrStatusPacket pkt = {};
            pkt.bpm            = reading.bpm;
            pkt.hrv_rmssd_ms   = reading.hrv_rmssd_ms;
            pkt.signal_quality = reading.signal_quality;
            pkt.reserved       = 0;

            ble_notify_hr(&pkt);
        }

        vTaskDelay(pdMS_TO_TICKS(HR_POLL_MS));
    }
}

// ── Entry point ───────────────────────────────────────────────────────────────

extern "C" void app_main(void)
{
    ESP_LOGI(TAG, "WorkoutBand firmware v%d starting", FIRMWARE_REV);

    // NVS is required by NimBLE for bond storage
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ret = nvs_flash_init();
    }
    ESP_ERROR_CHECK(ret);

    // Initialise IMU
    if (!imu_init(IMU_SDA_PIN, IMU_SCL_PIN, IMU_FREQ_HZ)) {
        ESP_LOGE(TAG, "IMU init failed — check wiring. Halting.");
        while (true) vTaskDelay(portMAX_DELAY);
    }

    signal_init();

    // Initialise the onboard PPG heart-rate sensor. Optional — if it's not
    // present or fails to probe, the band keeps working in IMU-only mode
    // (rep/set detection is unaffected, HR/HRV telemetry is just omitted).
    if (!hr_init()) {
        ESP_LOGW(TAG, "HR sensor init failed — continuing without heart-rate/HRV");
    }

    // Battery/charging monitoring and the status LED + power button. Neither
    // is required for rep detection to work, but both should be up before
    // BLE starts advertising so the LED reflects "advertising" immediately.
    battery_init();
    power_init();

    // Initialise BLE (starts advertising as "WorkoutBand")
    ble_init();

    // Create event queue
    s_event_queue = xQueueCreate(EVENT_QUEUE_DEPTH, sizeof(SignalEvent));
    assert(s_event_queue != NULL);

    // Pin imu_task to core 1 to isolate it from BLE interrupts on core 0
    xTaskCreatePinnedToCore(imu_task, "imu_task", 4096, NULL, 5, NULL, 1);
    xTaskCreatePinnedToCore(ble_task, "ble_task", 4096, NULL, 3, NULL, 0);
    xTaskCreatePinnedToCore(hr_task, "hr_task", 4096, NULL, 2, NULL, 0);
    // power_task is started internally by power_init() above.

    ESP_LOGI(TAG, "Tasks started. Waiting for phone connection...");
    // app_main returns — FreeRTOS scheduler takes over
}
