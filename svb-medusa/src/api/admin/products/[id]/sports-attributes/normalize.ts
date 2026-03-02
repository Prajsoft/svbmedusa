const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value)

// Backward compatibility: older data stored some multi-select fields as strings.
const coerceLegacyMultiSelect = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value
  }

  if (typeof value !== "string") {
    return value
  }

  const trimmed = value.trim()
  return trimmed ? [trimmed] : []
}

/**
 * Normalizes sports_attributes payloads from legacy shapes to the current
 * schema expected by validators and the Admin widget.
 */
export const normalizeSportsAttributes = (input: unknown): unknown => {
  if (!isObject(input)) {
    return input
  }

  const common = input.common
  const sportSpecific = input.sport_specific

  const normalizedCommon = isObject(common)
    ? {
        ...common,
        skill_level: coerceLegacyMultiSelect(common.skill_level),
        age_group: coerceLegacyMultiSelect(common.age_group),
        activity_intensity: coerceLegacyMultiSelect(common.activity_intensity),
        playing_surface: coerceLegacyMultiSelect(common.playing_surface),
        best_for: coerceLegacyMultiSelect(common.best_for),
      }
    : common

  const normalizedSportSpecific = isObject(sportSpecific)
    ? {
        ...sportSpecific,
        ball_grade: coerceLegacyMultiSelect(sportSpecific.ball_grade),
        ball_color: coerceLegacyMultiSelect(sportSpecific.ball_color),
      }
    : sportSpecific

  return {
    ...input,
    common: normalizedCommon,
    sport_specific: normalizedSportSpecific,
  }
}
