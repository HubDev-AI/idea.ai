/** Clamp a value to [0, 100]. */
export const clamp = (value: number): number => Math.min(100, Math.max(0, value));

/** Clamp a value to an arbitrary [min, max] range. */
export const clampRange = (v: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, v));

/** Round to 2 decimal places. */
export const round2 = (value: number): number => Math.round(value * 100) / 100;
