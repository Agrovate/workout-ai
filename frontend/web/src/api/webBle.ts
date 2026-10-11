/**
 * WorkoutBand Web Bluetooth integration.
 *
 * Talks to the ESP32-based WorkoutBand firmware (firmware/main/ble.cpp +
 * proto.h) via the browser's native Web Bluetooth API — only supported in
 * Chromium-based browsers (Chrome/Edge/Brave), not Safari or Firefox. Always
 * check isBluetoothSupported() before calling anything else here.
 *
 * Unlike the React Native version (src/api/ble.ts in frontend/mobile), there's
 * no native module/dev-client requirement and no base64 decoding step — the
 * browser hands characteristic values back as a plain DataView directly.
 */

// ── UUIDs — must match firmware/main/proto.h exactly ────────────────────────

const SERVICE_UUID       = 'a0000001-0000-1000-8000-00805f9b34fb';
const CHR_REP_EVENT      = 'a0000002-0000-1000-8000-00805f9b34fb';
const CHR_SET_SUMMARY    = 'a0000003-0000-1000-8000-00805f9b34fb';
const CHR_DEVICE_STATUS  = 'a0000004-0000-1000-8000-00805f9b34fb';
const CHR_CALIBRATE      = 'a0000005-0000-1000-8000-00805f9b34fb';
const CHR_HR_STATUS      = 'a0000006-0000-1000-8000-00805f9b34fb';

const CALIBRATE_CMD_TRIGGER = 0x01;

// ── Types (plain, camelCase — raw Bluetooth types never leak past this file) ─

export interface RepEvent {
  setNumber: number;
  repNumber: number;
  peakVelocityMmS: number;
  meanVelocityMmS: number;
  velocityValid: boolean;
}

export interface SetSummary {
  setNumber: number;
  totalReps: number;
  avgVelocityMmS: number;
  peakVelocityMmS: number;
  setDurationS: number;
  velocityLossPct: number;
}

export interface DeviceStatus {
  state: 'idle' | 'in_set' | 'calibrating' | 'unknown';
  batteryPct: number;
  currentReps: number;
  firmwareRev: number;
  charging: boolean;
  batteryLow: boolean;
}

export interface HrStatus {
  bpm: number;
  hrvRmssdMs: number;
  signalQuality: number;
}

export interface WorkoutBandConnection {
  device: BluetoothDevice;
  server: BluetoothRemoteGATTServer;
  service: BluetoothRemoteGATTService;
}

// ── Support check ─────────────────────────────────────────────────────────────

export function isBluetoothSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.bluetooth;
}

// ── Packet parsing — little-endian, matches proto.h byte-for-byte ───────────

function parseRepEvent(v: DataView): RepEvent {
  return {
    setNumber: v.getUint8(0),
    repNumber: v.getUint8(1),
    peakVelocityMmS: v.getUint16(2, true),
    meanVelocityMmS: v.getUint16(4, true),
    velocityValid: (v.getUint8(6) & 0x01) !== 0,
  };
}

function parseSetSummary(v: DataView): SetSummary {
  return {
    setNumber: v.getUint8(0),
    totalReps: v.getUint8(1),
    avgVelocityMmS: v.getUint16(2, true),
    peakVelocityMmS: v.getUint16(4, true),
    setDurationS: v.getUint16(6, true),
    velocityLossPct: v.getUint8(8),
  };
}

const DEVICE_STATES = ['idle', 'in_set', 'calibrating'] as const;

function parseDeviceStatus(v: DataView): DeviceStatus {
  const stateByte = v.getUint8(0);
  const flags = v.getUint8(4);
  return {
    state: DEVICE_STATES[stateByte] ?? 'unknown',
    batteryPct: v.getUint8(1),
    currentReps: v.getUint8(2),
    firmwareRev: v.getUint8(3),
    charging: (flags & 0x01) !== 0,
    batteryLow: (flags & 0x02) !== 0,
  };
}

function parseHrStatus(v: DataView): HrStatus {
  return {
    bpm: v.getUint8(0),
    hrvRmssdMs: v.getUint16(1, true),
    signalQuality: v.getUint8(3),
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function connectToWorkoutBand(): Promise<WorkoutBandConnection> {
  if (!isBluetoothSupported()) {
    throw new Error('Web Bluetooth is not supported in this browser. Use Chrome, Edge, or Brave.');
  }
  // Filtering by service UUID would require the browser to match against
  // the scan response packet (the firmware's advertising payload hits the
  // 31-byte legacy BLE limit, so the service UUID lives in the scan
  // response, not the primary advertisement — see ble.cpp's ble_advertise()).
  // Chromium's Linux Web Bluetooth backend (explicitly "without official
  // support" per its flag description) isn't reliable about that, so scan
  // unfiltered instead and let the user pick "WorkoutBand" by name.
  const device = await navigator.bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: [SERVICE_UUID],
  });
  if (!device.gatt) throw new Error('Device does not support GATT.');
  const server = await device.gatt.connect();
  const service = await server.getPrimaryService(SERVICE_UUID);
  return { device, server, service };
}

export function disconnect(device: BluetoothDevice): void {
  if (device.gatt?.connected) device.gatt.disconnect();
}

export async function readDeviceStatus(service: BluetoothRemoteGATTService): Promise<DeviceStatus> {
  const chr = await service.getCharacteristic(CHR_DEVICE_STATUS);
  const value = await chr.readValue();
  return parseDeviceStatus(value);
}

export async function writeCalibrate(service: BluetoothRemoteGATTService): Promise<void> {
  const chr = await service.getCharacteristic(CHR_CALIBRATE);
  await chr.writeValueWithResponse(Uint8Array.of(CALIBRATE_CMD_TRIGGER));
}

async function subscribe<T>(
  service: BluetoothRemoteGATTService,
  uuid: string,
  parse: (v: DataView) => T,
  cb: (value: T) => void,
): Promise<() => void> {
  const chr = await service.getCharacteristic(uuid);
  await chr.startNotifications();
  const handler = (event: Event) => {
    const target = event.target as BluetoothRemoteGATTCharacteristic;
    if (target.value) cb(parse(target.value));
  };
  chr.addEventListener('characteristicvaluechanged', handler);
  return () => {
    chr.removeEventListener('characteristicvaluechanged', handler);
    chr.stopNotifications().catch(() => {});
  };
}

export function subscribeRepEvents(
  service: BluetoothRemoteGATTService,
  cb: (event: RepEvent) => void,
): Promise<() => void> {
  return subscribe(service, CHR_REP_EVENT, parseRepEvent, cb);
}

export function subscribeSetSummaries(
  service: BluetoothRemoteGATTService,
  cb: (summary: SetSummary) => void,
): Promise<() => void> {
  return subscribe(service, CHR_SET_SUMMARY, parseSetSummary, cb);
}

export function subscribeHrStatus(
  service: BluetoothRemoteGATTService,
  cb: (status: HrStatus) => void,
): Promise<() => void> {
  return subscribe(service, CHR_HR_STATUS, parseHrStatus, cb);
}
