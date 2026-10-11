/**
 * WorkoutBand BLE integration.
 *
 * Talks to the ESP32-based WorkoutBand firmware (firmware/main/ble.cpp +
 * proto.h) over Bluetooth LE via react-native-ble-plx.
 *
 * react-native-ble-plx is a native module — it cannot run under Expo Go, only
 * in a custom dev client build (expo prebuild + expo run:ios/android). Rather
 * than gate this whole module behind a dummy-data flag (the pattern
 * healthkit.ts uses for react-native-health), the BleManager is constructed
 * lazily on first use and guarded with try/catch, so merely importing this
 * file — which happens at app startup via navigation's eager screen imports —
 * stays safe under Expo Go. Only actually tapping "Scan" requires the dev
 * client build; see getManager() below.
 */
import { BleManager, type Device, type Characteristic } from 'react-native-ble-plx';
import { Buffer } from 'buffer';

// ── UUIDs — must match firmware/main/proto.h exactly ────────────────────────

const SERVICE_UUID       = 'a0000001-0000-1000-8000-00805f9b34fb';
const CHR_REP_EVENT      = 'a0000002-0000-1000-8000-00805f9b34fb';
const CHR_SET_SUMMARY    = 'a0000003-0000-1000-8000-00805f9b34fb';
const CHR_DEVICE_STATUS  = 'a0000004-0000-1000-8000-00805f9b34fb';
const CHR_CALIBRATE      = 'a0000005-0000-1000-8000-00805f9b34fb';
const CHR_HR_STATUS      = 'a0000006-0000-1000-8000-00805f9b34fb';

const DEVICE_NAME = 'WorkoutBand';
const CALIBRATE_CMD_TRIGGER = 0x01;

// ── Types (plain, camelCase — BLE/native shapes never leak past this file) ──

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

// ── Lazy, guarded BleManager ─────────────────────────────────────────────────

let manager: BleManager | null = null;
let managerError: string | null = null;

function getManager(): BleManager {
  if (manager) return manager;
  if (managerError) throw new Error(managerError);
  try {
    manager = new BleManager();
    return manager;
  } catch {
    managerError =
      'Bluetooth is not available in this build. WorkoutBand requires a custom ' +
      'dev client (expo prebuild + expo run:ios/android) — it cannot run in Expo Go.';
    throw new Error(managerError);
  }
}

// ── Packet parsing — little-endian, matches proto.h byte-for-byte ───────────

function decode(base64Value: string): Buffer {
  return Buffer.from(base64Value, 'base64');
}

function parseRepEvent(base64Value: string): RepEvent {
  const b = decode(base64Value);
  return {
    setNumber: b.readUInt8(0),
    repNumber: b.readUInt8(1),
    peakVelocityMmS: b.readUInt16LE(2),
    meanVelocityMmS: b.readUInt16LE(4),
    velocityValid: (b.readUInt8(6) & 0x01) !== 0,
  };
}

function parseSetSummary(base64Value: string): SetSummary {
  const b = decode(base64Value);
  return {
    setNumber: b.readUInt8(0),
    totalReps: b.readUInt8(1),
    avgVelocityMmS: b.readUInt16LE(2),
    peakVelocityMmS: b.readUInt16LE(4),
    setDurationS: b.readUInt16LE(6),
    velocityLossPct: b.readUInt8(8),
  };
}

const DEVICE_STATES = ['idle', 'in_set', 'calibrating'] as const;

function parseDeviceStatus(base64Value: string): DeviceStatus {
  const b = decode(base64Value);
  const stateByte = b.readUInt8(0);
  const flags = b.readUInt8(4);
  return {
    state: DEVICE_STATES[stateByte] ?? 'unknown',
    batteryPct: b.readUInt8(1),
    currentReps: b.readUInt8(2),
    firmwareRev: b.readUInt8(3),
    charging: (flags & 0x01) !== 0,
    batteryLow: (flags & 0x02) !== 0,
  };
}

function parseHrStatus(base64Value: string): HrStatus {
  const b = decode(base64Value);
  return {
    bpm: b.readUInt8(0),
    hrvRmssdMs: b.readUInt16LE(1),
    signalQuality: b.readUInt8(3),
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

export function scanForWorkoutBand(
  onFound: (device: Device) => void,
  timeoutMs = 10000,
): () => void {
  const mgr = getManager();
  mgr.startDeviceScan([SERVICE_UUID], null, (error, device) => {
    if (error) return;
    if (device && device.name === DEVICE_NAME) {
      onFound(device);
    }
  });

  const timer = setTimeout(() => mgr.stopDeviceScan(), timeoutMs);
  return () => {
    clearTimeout(timer);
    mgr.stopDeviceScan();
  };
}

export async function connectToDevice(deviceId: string): Promise<Device> {
  const mgr = getManager();
  const device = await mgr.connectToDevice(deviceId);
  await device.discoverAllServicesAndCharacteristics();
  return device;
}

export async function disconnectDevice(device: Device): Promise<void> {
  try {
    await device.cancelConnection();
  } catch {
    // already disconnected — fine
  }
}

export async function readDeviceStatus(device: Device): Promise<DeviceStatus> {
  const chr: Characteristic = await device.readCharacteristicForService(
    SERVICE_UUID,
    CHR_DEVICE_STATUS,
  );
  if (!chr.value) throw new Error('Empty DEVICE_STATUS read');
  return parseDeviceStatus(chr.value);
}

export async function writeCalibrate(device: Device): Promise<void> {
  const byte = Buffer.from([CALIBRATE_CMD_TRIGGER]).toString('base64');
  await device.writeCharacteristicWithResponseForService(SERVICE_UUID, CHR_CALIBRATE, byte);
}

export function subscribeRepEvents(
  device: Device,
  cb: (event: RepEvent) => void,
): () => void {
  const sub = device.monitorCharacteristicForService(SERVICE_UUID, CHR_REP_EVENT, (error, chr) => {
    if (error || !chr?.value) return;
    cb(parseRepEvent(chr.value));
  });
  return () => sub.remove();
}

export function subscribeSetSummaries(
  device: Device,
  cb: (summary: SetSummary) => void,
): () => void {
  const sub = device.monitorCharacteristicForService(SERVICE_UUID, CHR_SET_SUMMARY, (error, chr) => {
    if (error || !chr?.value) return;
    cb(parseSetSummary(chr.value));
  });
  return () => sub.remove();
}

export function subscribeHrStatus(
  device: Device,
  cb: (status: HrStatus) => void,
): () => void {
  const sub = device.monitorCharacteristicForService(SERVICE_UUID, CHR_HR_STATUS, (error, chr) => {
    if (error || !chr?.value) return;
    cb(parseHrStatus(chr.value));
  });
  return () => sub.remove();
}
