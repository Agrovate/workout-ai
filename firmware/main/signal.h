#pragma once
#include <stdint.h>
#include <stdbool.h>
#include "imu.h"

// ── Events produced by the signal processor ───────────────────────────────────

typedef enum {
    EVT_NONE = 0,
    EVT_REP_COMPLETE,    // a rep just finished
    EVT_SET_COMPLETE,    // bar racked — set is over
} SignalEventType;

typedef struct {
    SignalEventType type;
    uint8_t  set_number;
    uint8_t  rep_number;           // valid for EVT_REP_COMPLETE
    uint16_t peak_velocity_mm_s;   // valid for EVT_REP_COMPLETE
    uint16_t mean_velocity_mm_s;   // valid for EVT_REP_COMPLETE
    uint16_t avg_velocity_mm_s;    // valid for EVT_SET_COMPLETE
    uint16_t set_duration_s;       // valid for EVT_SET_COMPLETE
    uint8_t  velocity_loss_pct;    // valid for EVT_SET_COMPLETE
    uint8_t  total_reps;           // valid for EVT_SET_COMPLETE
    bool     velocity_valid;
} SignalEvent;

// ── Public API ────────────────────────────────────────────────────────────────

// Initialise internal state. Call once before signal_process().
void signal_init(void);

// Feed a batch of IMU samples into the state machine.
// If an event is produced, it is written to *out_event and true is returned.
// Returns false when no event is ready yet.
bool signal_process(const ImuSample *samples, int count, SignalEvent *out_event);
