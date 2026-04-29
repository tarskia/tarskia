export type AnimationSettings = {
  timelineMs: {
    right: number;
    pause: number;
    width: number;
    down: number;
    height: number;
    children: number;
  };
  fadeInMultiplier: number;
  transitionSpeedMultiplier: number;
  viewport: {
    padding: number;
    collapsePadding: number;
    cameraDuration: number;
    fitDuration: number;
  };
};

export const DEFAULT_VIEWPORT_FIT_PADDING = 0.3;
export const FOCUS_SCOPE_CAMERA_PAUSE_MS = 125;

export const DEFAULT_ANIMATION_SETTINGS: AnimationSettings = {
  timelineMs: {
    right: 220,
    pause: 75,
    width: 220,
    down: 220,
    height: 220,
    children: 180,
  },
  fadeInMultiplier: 0.7,
  transitionSpeedMultiplier: 0.52,
  viewport: {
    padding: 40,
    collapsePadding: 16,
    cameraDuration: 350,
    fitDuration: 300,
  },
};

export const ANIMATION_CONSTANTS = DEFAULT_ANIMATION_SETTINGS;

export function cloneAnimationSettings(): AnimationSettings {
  return {
    timelineMs: { ...DEFAULT_ANIMATION_SETTINGS.timelineMs },
    fadeInMultiplier: DEFAULT_ANIMATION_SETTINGS.fadeInMultiplier,
    transitionSpeedMultiplier: DEFAULT_ANIMATION_SETTINGS.transitionSpeedMultiplier,
    viewport: { ...DEFAULT_ANIMATION_SETTINGS.viewport },
  };
}
