import { StepError, ERROR_CODES } from '../errors.js';

export function assertNormalizedPoint(point, label = 'point') {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new StepError(ERROR_CODES.INVALID_ARGS, 'desktop-geometry', `${label} must contain numeric x/y values.`);
  }
  if (point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) {
    throw new StepError(ERROR_CODES.INVALID_ARGS, 'desktop-geometry', `${label} must be normalized to the range [0, 1].`);
  }
  return { x: point.x, y: point.y };
}

export function normalizePoint(point, bounds) {
  assertBounds(bounds);
  if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) {
    throw new StepError(ERROR_CODES.INVALID_ARGS, 'desktop-geometry', 'Absolute point must contain numeric x/y values.');
  }
  return {
    x: round(point.x / bounds.width),
    y: round(point.y / bounds.height)
  };
}

export function denormalizePoint(point, bounds) {
  const safePoint = assertNormalizedPoint(point);
  assertBounds(bounds);
  return {
    x: Math.round(bounds.x + (safePoint.x * bounds.width)),
    y: Math.round(bounds.y + (safePoint.y * bounds.height))
  };
}

export function resolveAnchorPoint(profile, anchorName, windowBounds) {
  const point = profile?.anchors?.[anchorName];
  if (!point) {
    throw new StepError(ERROR_CODES.INVALID_ARGS, 'desktop-geometry', `Missing anchor: ${anchorName}`);
  }
  return denormalizePoint(point, windowBounds);
}

export function getStandardWindowBounds(profile) {
  const bounds = profile?.window?.targetBounds;
  assertBounds(bounds);
  return { ...bounds };
}

function assertBounds(bounds) {
  if (!bounds || !Number.isFinite(bounds.x) || !Number.isFinite(bounds.y) || !Number.isFinite(bounds.width) || !Number.isFinite(bounds.height)) {
    throw new StepError(ERROR_CODES.INVALID_ARGS, 'desktop-geometry', 'Window bounds must contain numeric x/y/width/height values.');
  }
  if (bounds.width <= 0 || bounds.height <= 0) {
    throw new StepError(ERROR_CODES.INVALID_ARGS, 'desktop-geometry', 'Window bounds width/height must be positive.');
  }
}

function round(value) {
  return Math.round(value * 1000000) / 1000000;
}
