/*
 * ble.cpp — NimBLE GATT server for the WorkoutClip device.
 *
 * Service: A0000001-0000-1000-8000-00805F9B34FB
 * Characteristics (all in the same namespace, suffix changes):
 *   REP_EVENT    0002  Notify      8 bytes
 *   SET_SUMMARY  0003  Notify+Read 12 bytes
 *   DEV_STATUS   0004  Read        4 bytes
 *   CALIBRATE    0005  Write       1 byte
 */

#include "ble.h"
#include "proto.h"
#include "esp_log.h"
#include "nvs_flash.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "host/ble_hs.h"
#include "host/ble_uuid.h"
#include "host/util/util.h"
#include "nimble/nimble_port.h"
#include "nimble/nimble_port_freertos.h"
#include "services/gap/ble_svc_gap.h"
#include "services/gatt/ble_svc_gatt.h"
#include <string.h>

static const char *TAG = "ble";
static const char *DEVICE_NAME = "WorkoutClip";

// ── 128-bit UUIDs (16 bytes, little-endian as NimBLE expects) ─────────────────
// UUID format: A000xxxx-0000-1000-8000-00805F9B34FB
// LE byte order: FB 34 9B 5F 80 00  00 80  00 10  00 00  xx xx 00 A0

static const ble_uuid128_t s_svc_uuid = {
    .u     = { .type = BLE_UUID_TYPE_128 },
    .value = { 0xFB, 0x34, 0x9B, 0x5F, 0x80, 0x00,
               0x00, 0x80, 0x00, 0x10, 0x00, 0x00,
               0x01, 0x00, 0x00, 0xA0 },
};

static const ble_uuid128_t s_chr_rep_uuid = {
    .u     = { .type = BLE_UUID_TYPE_128 },
    .value = { 0xFB, 0x34, 0x9B, 0x5F, 0x80, 0x00,
               0x00, 0x80, 0x00, 0x10, 0x00, 0x00,
               0x02, 0x00, 0x00, 0xA0 },
};

static const ble_uuid128_t s_chr_set_uuid = {
    .u     = { .type = BLE_UUID_TYPE_128 },
    .value = { 0xFB, 0x34, 0x9B, 0x5F, 0x80, 0x00,
               0x00, 0x80, 0x00, 0x10, 0x00, 0x00,
               0x03, 0x00, 0x00, 0xA0 },
};

static const ble_uuid128_t s_chr_status_uuid = {
    .u     = { .type = BLE_UUID_TYPE_128 },
    .value = { 0xFB, 0x34, 0x9B, 0x5F, 0x80, 0x00,
               0x00, 0x80, 0x00, 0x10, 0x00, 0x00,
               0x04, 0x00, 0x00, 0xA0 },
};

static const ble_uuid128_t s_chr_cal_uuid = {
    .u     = { .type = BLE_UUID_TYPE_128 },
    .value = { 0xFB, 0x34, 0x9B, 0x5F, 0x80, 0x00,
               0x00, 0x80, 0x00, 0x10, 0x00, 0x00,
               0x05, 0x00, 0x00, 0xA0 },
};

// ── State ─────────────────────────────────────────────────────────────────────
static uint16_t s_conn_handle       = BLE_HS_CONN_HANDLE_NONE;
static uint16_t s_rep_val_handle    = 0;
static uint16_t s_set_val_handle    = 0;

static DeviceStatusPacket s_status  = { 0, 100, 0, FIRMWARE_REV };
static bool s_calibrate_requested   = false;

// ── GATT access callbacks ─────────────────────────────────────────────────────

static int cb_status_read(uint16_t conn_handle, uint16_t attr_handle,
                           struct ble_gatt_access_ctxt *ctxt, void *arg)
{
    (void)conn_handle; (void)attr_handle; (void)arg;
    int rc = os_mbuf_append(ctxt->om, &s_status, sizeof(s_status));
    return rc == 0 ? 0 : BLE_ATT_ERR_INSUFFICIENT_RES;
}

static int cb_calibrate_write(uint16_t conn_handle, uint16_t attr_handle,
                               struct ble_gatt_access_ctxt *ctxt, void *arg)
{
    (void)conn_handle; (void)attr_handle; (void)arg;
    uint8_t cmd = 0;
    if (OS_MBUF_PKTLEN(ctxt->om) >= 1) {
        ble_hs_mbuf_to_flat(ctxt->om, &cmd, 1, NULL);
        if (cmd == CALIBRATE_CMD_TRIGGER) {
            s_calibrate_requested = true;
            ESP_LOGI(TAG, "Calibration requested via BLE");
        }
    }
    return 0;
}

// ── GATT table ────────────────────────────────────────────────────────────────
// All fields of ble_gatt_chr_def in declaration order:
//   uuid, access_cb, arg, descriptors, flags, min_key_size, val_handle, cpfd
// All fields of ble_gatt_svc_def in declaration order:
//   type, uuid, includes, characteristics

static const struct ble_gatt_chr_def s_chrs[] = {
    // REP_EVENT — notify only
    {
        .uuid         = &s_chr_rep_uuid.u,
        .access_cb    = nullptr,
        .arg          = nullptr,
        .descriptors  = nullptr,
        .flags        = BLE_GATT_CHR_F_NOTIFY,
        .min_key_size = 0,
        .val_handle   = &s_rep_val_handle,
        .cpfd         = nullptr,
    },
    // SET_SUMMARY — notify + read
    {
        .uuid         = &s_chr_set_uuid.u,
        .access_cb    = nullptr,
        .arg          = nullptr,
        .descriptors  = nullptr,
        .flags        = BLE_GATT_CHR_F_NOTIFY | BLE_GATT_CHR_F_READ,
        .min_key_size = 0,
        .val_handle   = &s_set_val_handle,
        .cpfd         = nullptr,
    },
    // DEVICE_STATUS — read
    {
        .uuid         = &s_chr_status_uuid.u,
        .access_cb    = cb_status_read,
        .arg          = nullptr,
        .descriptors  = nullptr,
        .flags        = BLE_GATT_CHR_F_READ,
        .min_key_size = 0,
        .val_handle   = nullptr,
        .cpfd         = nullptr,
    },
    // CALIBRATE_CMD — write
    {
        .uuid         = &s_chr_cal_uuid.u,
        .access_cb    = cb_calibrate_write,
        .arg          = nullptr,
        .descriptors  = nullptr,
        .flags        = BLE_GATT_CHR_F_WRITE,
        .min_key_size = 0,
        .val_handle   = nullptr,
        .cpfd         = nullptr,
    },
    // Terminator — uuid == NULL signals end of characteristic list
    {
        .uuid         = nullptr,
        .access_cb    = nullptr,
        .arg          = nullptr,
        .descriptors  = nullptr,
        .flags        = 0,
        .min_key_size = 0,
        .val_handle   = nullptr,
        .cpfd         = nullptr,
    },
};

static const struct ble_gatt_svc_def s_svcs[] = {
    {
        .type            = BLE_GATT_SVC_TYPE_PRIMARY,
        .uuid            = &s_svc_uuid.u,
        .includes        = nullptr,
        .characteristics = s_chrs,
    },
    // Terminator — type == 0 signals end of service list
    {
        .type            = 0,
        .uuid            = nullptr,
        .includes        = nullptr,
        .characteristics = nullptr,
    },
};

// ── GAP event handler ─────────────────────────────────────────────────────────

static void ble_advertise(void);

static int gap_event_cb(struct ble_gap_event *event, void *arg)
{
    switch (event->type) {
    case BLE_GAP_EVENT_CONNECT:
        if (event->connect.status == 0) {
            s_conn_handle = event->connect.conn_handle;
            ESP_LOGI(TAG, "Phone connected (handle %d)", s_conn_handle);
        } else {
            s_conn_handle = BLE_HS_CONN_HANDLE_NONE;
            ble_advertise();
        }
        break;

    case BLE_GAP_EVENT_DISCONNECT:
        ESP_LOGI(TAG, "Phone disconnected (reason %d)", event->disconnect.reason);
        s_conn_handle = BLE_HS_CONN_HANDLE_NONE;
        ble_advertise();
        break;

    case BLE_GAP_EVENT_ADV_COMPLETE:
        ble_advertise();
        break;

    default:
        break;
    }
    return 0;
}

static void ble_advertise(void)
{
    // AD fields: flags + complete name + 128-bit service UUID
    struct ble_hs_adv_fields fields = {};
    fields.flags                = BLE_HS_ADV_F_DISC_GEN | BLE_HS_ADV_F_BREDR_UNSUP;
    fields.name                 = (const uint8_t *)DEVICE_NAME;
    fields.name_len             = (uint8_t)strlen(DEVICE_NAME);
    fields.name_is_complete     = 1;
    fields.uuids128             = &s_svc_uuid;
    fields.num_uuids128         = 1;
    fields.uuids128_is_complete = 1;

    int rc = ble_gap_adv_set_fields(&fields);
    if (rc != 0) {
        ESP_LOGE(TAG, "adv_set_fields error %d", rc);
        return;
    }

    struct ble_gap_adv_params params = {};
    params.conn_mode = BLE_GAP_CONN_MODE_UND;
    params.disc_mode = BLE_GAP_DISC_MODE_GEN;
    params.itvl_min  = BLE_GAP_ADV_ITVL_MS(100);
    params.itvl_max  = BLE_GAP_ADV_ITVL_MS(150);

    ble_gap_adv_start(BLE_OWN_ADDR_PUBLIC, NULL, BLE_HS_FOREVER,
                      &params, gap_event_cb, NULL);
    ESP_LOGI(TAG, "Advertising as \"%s\"", DEVICE_NAME);
}

// ── NimBLE host task ──────────────────────────────────────────────────────────

static void ble_on_sync(void)
{
    uint8_t own_addr_type;
    ble_hs_id_infer_auto(0, &own_addr_type);
    ble_advertise();
}

static void ble_on_reset(int reason)
{
    ESP_LOGE(TAG, "BLE reset, reason %d", reason);
}

static void nimble_host_task(void *param)
{
    nimble_port_run();
    nimble_port_freertos_deinit();
}

// ── Public API ────────────────────────────────────────────────────────────────

void ble_init(void)
{
    nimble_port_init();

    ble_hs_cfg.sync_cb  = ble_on_sync;
    ble_hs_cfg.reset_cb = ble_on_reset;

    ble_svc_gap_init();
    ble_svc_gatt_init();
    ble_svc_gap_device_name_set(DEVICE_NAME);

    int rc = ble_gatts_count_cfg(s_svcs);
    assert(rc == 0);
    rc = ble_gatts_add_svcs(s_svcs);
    assert(rc == 0);

    nimble_port_freertos_init(nimble_host_task);
    ESP_LOGI(TAG, "NimBLE initialised");
}

bool ble_is_connected(void)
{
    return s_conn_handle != BLE_HS_CONN_HANDLE_NONE;
}

void ble_notify_rep(const RepEventPacket *pkt)
{
    if (!ble_is_connected() || s_rep_val_handle == 0) return;
    struct os_mbuf *om = ble_hs_mbuf_from_flat(pkt, sizeof(RepEventPacket));
    if (om) ble_gatts_notify_custom(s_conn_handle, s_rep_val_handle, om);
}

void ble_notify_set(const SetSummaryPacket *pkt)
{
    if (!ble_is_connected() || s_set_val_handle == 0) return;
    struct os_mbuf *om = ble_hs_mbuf_from_flat(pkt, sizeof(SetSummaryPacket));
    if (om) ble_gatts_notify_custom(s_conn_handle, s_set_val_handle, om);
}

void ble_update_status(const DeviceStatusPacket *pkt)
{
    memcpy(&s_status, pkt, sizeof(DeviceStatusPacket));
}
