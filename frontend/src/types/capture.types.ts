/**
 * ARKI — Capture module public types.
 * Kept in sync with frontend/electron/capture-manager.ts (DisplayInfo, CaptureResult).
 */

export interface DisplayInfo {
  id: number;
  label: string;
  bounds:      { x: number; y: number; width: number; height: number };
  workArea:    { x: number; y: number; width: number; height: number };
  scaleFactor: number;
  rotation:    number;
  isPrimary:   boolean;
}

export interface CaptureRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  displayId: number;
}

export interface CaptureResult {
  imageBase64: string;
  mimeType:    'image/png';
  region:      CaptureRegion;
  displayId:   number;
  scaleFactor: number;
  captureMs:   number;
  width:       number;
  height:      number;
}

export type CaptureMode      = 'fullscreen' | 'region';
export type PermissionStatus = 'granted' | 'denied' | 'not-determined' | 'restricted' | 'unknown';

/** Payload pushed from main → CaptureSelector window */
export interface SelectorInitPayload {
  screenshot:    string;   // base64 PNG — full display at native res
  displayBounds: { x: number; y: number; width: number; height: number };
  scaleFactor:   number;
}
