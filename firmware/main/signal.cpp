/*
 * signal.cpp — Rep detection state machine + velocity integration.
 *
 * The barbell moves vertically.  After subtracting the calibrated gravity
 * vector from az, we have az_net:
 *
 *   az_net ≈ 0        bar at rest
 *   az_net < 0        eccentric (bar accelerating downward)
 *   az_net > 0        concentric (bar being driven up)
 *
 * State machine:
 *
 *   IDLE ──► ECCENTRIC ──► CONCENTRIC ──► LOCKOUT ──► IDLE
 *
 * On LOCKOUT→IDLE: emit EVT_REP_COMPLETE with MCV and peak velocity.
 * After >SET_END_MS of IDLE following at least one rep: emit EVT_SET_COMPLETE.
 *
 * Velocity is integrated using the trapezoidal rule over the concentric window
 * only, which limits drift to <300 ms of integration — acceptable without
 * a position reference.  Values stored as mm/s in uint16_t (max ~3000 mm/s).
 */

#include "signal.h"
#include "imu.h"
#include "esp_log.h"
#include "esp_timer.h"
#include <string.h>
#include <math.h>
#include <stdint.h>

static const char *TAG = "signal";

// ── Thresholds ────────────────────────────────────────────────────────────────
#define STILLNESS_THRESH   0.30f    // m/s²: |az_net| below this → IDLE
#define ECCENTRIC_THRESH  -0.50f    // m/s²: az_net below this → ECCENTRIC
#define CONCENTRIC_THRESH  1.00f    // m/s²: az_net above this → CONCENTRIC
#define LOCKOUT_THRESH     0.30f    // m/s²: az_net below this after CONCENTRIC → rep done

// Time thresholds in microseconds
#define IDLE_CONFIRM_US    500000   //  500 ms of stillness confirms IDLE
#define SET_END_US        3000000   // 3000 ms of IDLE after reps → set over
#define MIN_CONCENTRIC_US   80000   //   80 ms minimum concentric phase (filter noise)

// Maximum concentric window to integrate (avoid runaway on slow eccentrics)
#define MAX_INTEGRATE_US  2000000   // 2 s

#define MAX_REPS_PER_SET  30
#define MAX_VEL_MM_S      3000      // clamp output to 3000 mm/s

// ── State ─────────────────────────────────────────────────────────────────────

typedef enum {
    STATE_IDLE,
    STATE_ECCENTRIC,
    STATE_CONCENTRIC,
    STATE_LOCKOUT,
} RepState;

static RepState  s_state;
static uint8_t   s_set_number;
static uint8_t   s_rep_number;
static int64_t   s_state_enter_us;   // when we entered the current state
static int64_t   s_last_rep_us;      // timestamp of last rep completion
static int64_t   s_set_start_us;     // timestamp of first rep in set
static bool      s_in_set;

// Velocity integration (concentric window)
static float     s_vel_acc;          // running velocity integral (m/s)
static float     s_prev_az_net;      // previous sample for trapezoid
static int64_t   s_prev_ts_us;
static float     s_peak_vel;         // peak velocity in concentric window

// Per-rep velocity (for set summary)
static float     s_rep_velocities[MAX_REPS_PER_SET];

// ── Internal helpers ──────────────────────────────────────────────────────────

static uint16_t clamp_vel_mm_s(float v_m_s)
{
    float mm_s = v_m_s * 1000.0f;
    if (mm_s < 0.0f)   mm_s = 0.0f;
    if (mm_s > (float)MAX_VEL_MM_S) mm_s = (float)MAX_VEL_MM_S;
    return (uint16_t)mm_s;
}

static uint8_t velocity_loss_pct(int n_reps)
{
    if (n_reps < 2) return 0;
    float first = s_rep_velocities[0];
    float last  = s_rep_velocities[n_reps - 1];
    if (first <= 0.0f) return 0;
    float loss = (first - last) / first * 100.0f;
    if (loss < 0.0f)   loss = 0.0f;
    if (loss > 100.0f) loss = 100.0f;
    return (uint8_t)loss;
}

static void enter_state(RepState new_state, int64_t now_us)
{
    s_state = new_state;
    s_state_enter_us = now_us;
}

static void begin_integration(float az_net, int64_t ts_us)
{
    s_vel_acc    = 0.0f;
    s_peak_vel   = 0.0f;
    s_prev_az_net = az_net;
    s_prev_ts_us  = ts_us;
}

static void integrate_sample(float az_net, int64_t ts_us)
{
    float dt = (float)(ts_us - s_prev_ts_us) * 1e-6f;
    // Trapezoidal rule: v += (a0 + a1) / 2 * dt
    s_vel_acc += (s_prev_az_net + az_net) * 0.5f * dt;
    if (s_vel_acc > s_peak_vel) s_peak_vel = s_vel_acc;
    s_prev_az_net = az_net;
    s_prev_ts_us  = ts_us;
}

// ── Public API ────────────────────────────────────────────────────────────────

void signal_init(void)
{
    memset(s_rep_velocities, 0, sizeof(s_rep_velocities));
    s_state         = STATE_IDLE;
    s_set_number    = 1;
    s_rep_number    = 0;
    s_state_enter_us = esp_timer_get_time();
    s_last_rep_us   = 0;
    s_set_start_us  = 0;
    s_in_set        = false;
    s_vel_acc       = 0.0f;
    s_peak_vel      = 0.0f;
}

bool signal_process(const ImuSample *samples, int count, SignalEvent *out_event)
{
    extern float g_gravity_z;

    for (int i = 0; i < count; i++) {
        float az_net = samples[i].az - g_gravity_z;
        int64_t now  = samples[i].ts_us;

        switch (s_state) {

        case STATE_IDLE:
            if (az_net < ECCENTRIC_THRESH) {
                // Bar moving down — start of a rep
                if (!s_in_set) {
                    s_in_set       = true;
                    s_set_start_us = now;
                    s_rep_number   = 0;
                    ESP_LOGI(TAG, "Set %d started", s_set_number);
                }
                enter_state(STATE_ECCENTRIC, now);
            } else if (s_in_set && (now - s_last_rep_us) > SET_END_US) {
                // Long stillness after reps — set is over
                int n = s_rep_number;
                float avg = 0.0f;
                for (int r = 0; r < n; r++) avg += s_rep_velocities[r];
                if (n > 0) avg /= n;

                SignalEvent ev = {};
                ev.type              = EVT_SET_COMPLETE;
                ev.set_number        = s_set_number;
                ev.total_reps        = n;
                ev.avg_velocity_mm_s = clamp_vel_mm_s(avg);
                ev.peak_velocity_mm_s = clamp_vel_mm_s(s_rep_velocities[0]); // first rep usually fastest
                for (int r = 0; r < n; r++) {
                    if (s_rep_velocities[r] > (float)ev.peak_velocity_mm_s / 1000.0f)
                        ev.peak_velocity_mm_s = clamp_vel_mm_s(s_rep_velocities[r]);
                }
                ev.set_duration_s    = (uint16_t)((now - s_set_start_us) / 1000000ULL);
                ev.velocity_loss_pct = velocity_loss_pct(n);
                ev.velocity_valid    = true;

                ESP_LOGI(TAG, "Set %d complete: %d reps, avg %.0f mm/s, loss %d%%",
                         s_set_number, n,
                         (double)ev.avg_velocity_mm_s,
                         ev.velocity_loss_pct);

                // Reset for next set
                s_set_number++;
                s_rep_number = 0;
                s_in_set     = false;
                memset(s_rep_velocities, 0, sizeof(s_rep_velocities));

                *out_event = ev;
                return true;
            }
            break;

        case STATE_ECCENTRIC:
            if (az_net > CONCENTRIC_THRESH) {
                // Bar bouncing up — concentric phase starts
                enter_state(STATE_CONCENTRIC, now);
                begin_integration(az_net, now);
            } else if (az_net > STILLNESS_THRESH &&
                       (now - s_state_enter_us) > IDLE_CONFIRM_US) {
                // Didn't go concentric — false eccentric, return to IDLE
                enter_state(STATE_IDLE, now);
            }
            break;

        case STATE_CONCENTRIC:
            integrate_sample(az_net, now);

            // Guard against runaway integration
            if ((now - s_state_enter_us) > MAX_INTEGRATE_US) {
                enter_state(STATE_IDLE, now);
                break;
            }

            if (az_net < LOCKOUT_THRESH &&
                (now - s_state_enter_us) > MIN_CONCENTRIC_US) {
                // Bar has decelerated — entering lockout
                enter_state(STATE_LOCKOUT, now);
            }
            break;

        case STATE_LOCKOUT:
            if (fabsf(az_net) < STILLNESS_THRESH &&
                (now - s_state_enter_us) > IDLE_CONFIRM_US) {
                // Confirmed still — rep complete
                s_rep_number++;
                s_last_rep_us = now;

                float mcv = s_vel_acc;   // mean concentric velocity proxy
                if (s_rep_number <= MAX_REPS_PER_SET) {
                    s_rep_velocities[s_rep_number - 1] = mcv;
                }

                SignalEvent ev = {};
                ev.type               = EVT_REP_COMPLETE;
                ev.set_number         = s_set_number;
                ev.rep_number         = s_rep_number;
                ev.mean_velocity_mm_s = clamp_vel_mm_s(mcv);
                ev.peak_velocity_mm_s = clamp_vel_mm_s(s_peak_vel);
                ev.velocity_valid     = true;

                ESP_LOGI(TAG, "Rep %d: MCV=%.0fmm/s peak=%.0fmm/s",
                         s_rep_number,
                         (double)ev.mean_velocity_mm_s,
                         (double)ev.peak_velocity_mm_s);

                enter_state(STATE_IDLE, now);
                *out_event = ev;
                return true;
            } else if (az_net > CONCENTRIC_THRESH) {
                // Bounced back up without stopping — treat as eccentric of next rep
                enter_state(STATE_ECCENTRIC, now);
            }
            break;
        }
    }

    return false;
}
