/*
 * main.cpp — WorkoutClip firmware entry point.
 *
 * Architecture:
 *   imu_task  (core 1, priority 5) — samples IMU at 500Hz, runs signal
 *             processor, pushes events onto event_queue.
 *   ble_task  (core 0, priority 3) — drains event_queue, sends BLE
 *             notifications to the connected phone.
 *
 * Separating tasks across cores keeps BLE interrupts (core 0) from adding
 * jitter to the IMU sampling loop (core 1).
 *
 * Build:  idf.py build
 * Flash:  idf.py -p /dev/ttyUSB0 flash monitor
 */

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include "nvs_flash.h"
#include "esp_log.h"
#include "esp_timer.h"

#include "imu.h"
#include "signal.h"
#include "ble.h"
#include "proto.h"

static const char *TAG = "main";

// GPIO pins — standard ESP32 devkit I2C pins
#define IMU_SDA_PIN  21
#define IMU_SCL_PIN  22
#define IMU_FREQ_HZ  400000

// IMU task: drain FIFO every 20ms (yields 10 samples at 500Hz ODR)
#define IMU_POLL_MS  20

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

    ESP_LOGI(TAG, "BLE task running on core %d", xPortGetCoreID());

    while (true) {
        // Block up to 100ms waiting for an event
        if (xQueueReceive(s_event_queue, &ev, pdMS_TO_TICKS(100)) == pdTRUE) {

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

            // Refresh the readable status characteristic
            DeviceStatusPacket status = {};
            status.state         = ev.type == EVT_SET_COMPLETE ? 0 : 1; // 0=idle, 1=in_set
            status.battery_pct   = 100;  // TODO: read ADC VBAT divider
            status.current_reps  = current_reps;
            status.firmware_rev  = FIRMWARE_REV;
            ble_update_status(&status);
        }
    }
}

// ── Entry point ───────────────────────────────────────────────────────────────

extern "C" void app_main(void)
{
    ESP_LOGI(TAG, "WorkoutClip firmware v%d starting", FIRMWARE_REV);

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

    // Initialise BLE (starts advertising as "WorkoutClip")
    ble_init();

    // Create event queue
    s_event_queue = xQueueCreate(EVENT_QUEUE_DEPTH, sizeof(SignalEvent));
    assert(s_event_queue != NULL);

    // Pin imu_task to core 1 to isolate it from BLE interrupts on core 0
    xTaskCreatePinnedToCore(imu_task, "imu_task", 4096, NULL, 5, NULL, 1);
    xTaskCreatePinnedToCore(ble_task, "ble_task", 4096, NULL, 3, NULL, 0);

    ESP_LOGI(TAG, "Tasks started. Waiting for phone connection...");
    // app_main returns — FreeRTOS scheduler takes over
}
