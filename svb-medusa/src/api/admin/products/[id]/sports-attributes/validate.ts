import {
  SKILL_LEVELS,
  AGE_GROUPS,
  ACTIVITY_INTENSITIES,
  PLAYING_SURFACES,
  BEST_FOR_OPTIONS,
  PROTECTION_LEVELS,
  BALL_GRADES,
  OVERS_DURABILITY,
  EquipmentType,
  EQUIPMENT_TYPES,
} from "../../../../../types/sports-attributes"

const ALLOWED_EQUIPMENT_TYPES = new Set<string>(EQUIPMENT_TYPES)

export type ValidationResult =
  | { valid: true }
  | { valid: false; errors: Record<string, string> }

/**
 * Validates the request body for POST /admin/products/:id/sports-attributes.
 * Pure validation logic — no database calls.
 *
 * Returns { valid: true } on success.
 * Returns { valid: false, errors } with field-level error messages on failure.
 */
export function validateSportsAttributes(body: unknown): ValidationResult {
  const errors: Record<string, string> = {}

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { valid: false, errors: { root: "Request body must be a JSON object" } }
  }

  const data = body as Record<string, unknown>

  // ── sport ────────────────────────────────────────────────────────────────
  if (data.sport !== "Cricket") {
    errors["sport"] = "Must be 'Cricket'"
  }

  // ── common ───────────────────────────────────────────────────────────────
  const common = data.common
  if (!common || typeof common !== "object" || Array.isArray(common)) {
    errors["common"] = "Must be an object"
  } else {
    const c = common as Record<string, unknown>

    // skill_level
    if (!Array.isArray(c.skill_level)) {
      errors["common.skill_level"] = "Must be an array"
    } else {
      const badItems = (c.skill_level as unknown[]).filter(
        (v) => !SKILL_LEVELS.includes(v as (typeof SKILL_LEVELS)[number])
      )
      if (badItems.length > 0) {
        errors["common.skill_level"] =
          `Invalid value: must be one of ${SKILL_LEVELS.join(", ")}`
      }
    }

    // age_group
    if (!Array.isArray(c.age_group)) {
      errors["common.age_group"] = "Must be an array"
    } else {
      const badItems = (c.age_group as unknown[]).filter(
        (v) => !AGE_GROUPS.includes(v as (typeof AGE_GROUPS)[number])
      )
      if (badItems.length > 0) {
        errors["common.age_group"] =
          `Invalid value: must be one of ${AGE_GROUPS.join(", ")}`
      }
    }

    // activity_intensity
    if (!Array.isArray(c.activity_intensity)) {
      errors["common.activity_intensity"] = "Must be an array"
    } else {
      const badItems = (c.activity_intensity as unknown[]).filter(
        (v) => !ACTIVITY_INTENSITIES.includes(v as (typeof ACTIVITY_INTENSITIES)[number])
      )
      if (badItems.length > 0) {
        errors["common.activity_intensity"] =
          `Invalid value: must be one of ${ACTIVITY_INTENSITIES.join(", ")}`
      }
    }

    // playing_surface
    if (!Array.isArray(c.playing_surface)) {
      errors["common.playing_surface"] = "Must be an array"
    } else {
      const badItems = (c.playing_surface as unknown[]).filter(
        (v) => !PLAYING_SURFACES.includes(v as (typeof PLAYING_SURFACES)[number])
      )
      if (badItems.length > 0) {
        errors["common.playing_surface"] =
          `Invalid value: must be one of ${PLAYING_SURFACES.join(", ")}`
      }
    }

    // certification
    if (typeof c.certification !== "string") {
      errors["common.certification"] = "Must be a string"
    } else if (c.certification.length > 500) {
      errors["common.certification"] = "Must be under 500 characters"
    }

    // best_for
    if (!Array.isArray(c.best_for)) {
      errors["common.best_for"] = "Must be an array"
    } else {
      const badItems = (c.best_for as unknown[]).filter(
        (v) => !BEST_FOR_OPTIONS.includes(v as (typeof BEST_FOR_OPTIONS)[number])
      )
      if (badItems.length > 0) {
        errors["common.best_for"] =
          `Invalid value: must be one of ${BEST_FOR_OPTIONS.join(", ")}`
      }
    }

    // in_box_includes
    if (typeof c.in_box_includes !== "string") {
      errors["common.in_box_includes"] = "Must be a string"
    } else if (c.in_box_includes.length > 500) {
      errors["common.in_box_includes"] = "Must be under 500 characters"
    }

    // customization_available
    if (typeof c.customization_available !== "boolean") {
      errors["common.customization_available"] = "Must be a boolean"
    }

    // protection_level
    if (
      c.protection_level !== "" &&
      !PROTECTION_LEVELS.includes(
        c.protection_level as (typeof PROTECTION_LEVELS)[number]
      )
    ) {
      errors["common.protection_level"] =
        `Invalid value: must be one of ${PROTECTION_LEVELS.join(", ")}`
    }
  }

  // ── sport_specific ───────────────────────────────────────────────────────
  const ss = data.sport_specific
  if (!ss || typeof ss !== "object" || Array.isArray(ss)) {
    errors["sport_specific"] = "Must be an object"
  } else {
    const s = ss as Record<string, unknown>

    // equipment_type
    if (!ALLOWED_EQUIPMENT_TYPES.has(s.equipment_type as string)) {
      errors["sport_specific.equipment_type"] =
        `Must be one of: ${EQUIPMENT_TYPES.join(", ")}`
    }

    // Ball-specific fields — only validated when equipment_type is Ball
    if (s.equipment_type === EquipmentType.Ball) {
      // ball_type
      if (typeof s.ball_type !== "string") {
        errors["sport_specific.ball_type"] = "Must be a string"
      } else if ((s.ball_type as string).length > 100) {
        errors["sport_specific.ball_type"] = "Must be a string under 100 characters"
      }

      // ball_grade
      if (!Array.isArray(s.ball_grade)) {
        errors["sport_specific.ball_grade"] = "Must be an array"
      } else {
        const badItems = (s.ball_grade as unknown[]).filter(
          (v) => !BALL_GRADES.includes(v as (typeof BALL_GRADES)[number])
        )
        if (badItems.length > 0) {
          errors["sport_specific.ball_grade"] =
            `Invalid value: must be one of ${BALL_GRADES.join(", ")}`
        }
      }

      // seam_type
      if (typeof s.seam_type !== "string") {
        errors["sport_specific.seam_type"] = "Must be a string"
      } else if ((s.seam_type as string).length > 100) {
        errors["sport_specific.seam_type"] = "Must be a string under 100 characters"
      }

      // ball_color
      if (!Array.isArray(s.ball_color)) {
        errors["sport_specific.ball_color"] = "Must be an array"
      } else if ((s.ball_color as unknown[]).length > 10) {
        errors["sport_specific.ball_color"] = "Must have 10 or fewer items"
      } else {
        const badItems = (s.ball_color as unknown[]).filter(
          (v) => typeof v !== "string" || (v as string).length > 50
        )
        if (badItems.length > 0) {
          errors["sport_specific.ball_color"] =
            "Each color must be a string under 50 characters"
        }
      }

      // ball_size
      if (typeof s.ball_size !== "string") {
        errors["sport_specific.ball_size"] = "Must be a string"
      } else if ((s.ball_size as string).length > 100) {
        errors["sport_specific.ball_size"] = "Must be a string under 100 characters"
      }

      // overs_durability
      if (s.overs_durability !== "" && !(OVERS_DURABILITY as readonly string[]).includes(String(s.overs_durability))) {
        errors["sport_specific.overs_durability"] = `Must be one of: ${OVERS_DURABILITY.join(", ")}`
      }
    }
  }

  if (Object.keys(errors).length > 0) {
    return { valid: false, errors }
  }

  return { valid: true }
}
