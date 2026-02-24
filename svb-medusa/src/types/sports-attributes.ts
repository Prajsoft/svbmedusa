// ─── Sports Enum ─────────────────────────────────────────────────────────────

/**
 * Supported sports. Cricket is the only sport in V1.
 * Add new values here when expanding to other sports.
 */
export enum Sport {
  Cricket = "Cricket",
}

// ─── Equipment Type Enum ─────────────────────────────────────────────────────

/**
 * Equipment types within a sport.
 * Add new values here when expanding to new product categories.
 */
export enum EquipmentType {
  Ball = "Ball",
  Bat = "Bat",
  Gloves = "Gloves",
  Pads = "Pads",
  Helmet = "Helmet",
  Bag = "Bag",
}

/** Ordered list of equipment types for dropdowns. */
export const EQUIPMENT_TYPES = [
  EquipmentType.Ball,
  EquipmentType.Bat,
  EquipmentType.Gloves,
  EquipmentType.Pads,
  EquipmentType.Helmet,
  EquipmentType.Bag,
] as const

// ─── Allowed Values (const arrays) ───────────────────────────────────────────
// Defined as const arrays (not enums) so they serve double duty:
// 1. TypeScript union types via `typeof ARRAY[number]`
// 2. Option lists rendered directly in the Admin UI widget

/** Skill level options shared across all equipment types. */
export const SKILL_LEVELS = [
  "Beginner",
  "Intermediate",
  "Advanced",
  "Professional",
] as const

/** Age group options shared across all equipment types. */
export const AGE_GROUPS = ["Junior", "Youth", "Adult"] as const

/** Activity intensity options shared across all equipment types. */
export const ACTIVITY_INTENSITIES = [
  "Recreational",
  "Training",
  "Competitive",
  "Professional",
] as const

/** Playing surface options shared across all equipment types. */
export const PLAYING_SURFACES = [
  "Indoor",
  "Outdoor",
  "Turf",
  "Grass",
  "Hard Court",
  "Clay",
] as const

/** Best-for audience options shared across all equipment types. */
export const BEST_FOR_OPTIONS = [
  "School",
  "Academy",
  "Club",
  "Professional",
] as const

/** Protection level options shared across all equipment types. */
export const PROTECTION_LEVELS = ["Basic", "Standard", "Premium"] as const

/** Ball type options. Supports "Other (specify)" — stored as free text string. */
export const BALL_TYPES = [
  "Leather",
  "Tennis",
  "Rubber",
  "Tape",
  "Synthetic",
] as const

/** Ball grade options. Supports "Other (specify)" — stored as free text string. */
export const BALL_GRADES = [
  "Match",
  "Practice",
  "Training",
  "Club",
] as const

/** Seam type options. Supports "Other (specify)" — stored as free text string. */
export const SEAM_TYPES = [
  "Machine Stitched",
  "Hand Stitched",
  "Reinforced",
] as const

/** Ball colour options. Multi-select. Supports "Other (specify)" — stored as free text string. */
export const BALL_COLORS = [
  "Red",
  "White",
  "Pink",
  "Orange",
  "Yellow",
] as const

/** Ball size options. Supports "Other (specify)" — stored as free text string. */
export const BALL_SIZES = [
  "Size 4 (Junior)",
  "Size 5 (Standard)",
] as const

// ─── Common Attributes ────────────────────────────────────────────────────────

/**
 * Fields shared across all sports and equipment types.
 * Stored under the `common` key in the `sports_attributes` jsonb column.
 */
export interface CommonAttributes {
  /** Multi-select. Values from SKILL_LEVELS, or custom string via "Other". */
  skill_level: string[]
  /** Multi-select. Values from AGE_GROUPS, or custom string via "Other". */
  age_group: string[]
  /** Multi-select. Values from ACTIVITY_INTENSITIES. */
  activity_intensity: string[]
  /** Multi-select. Values from PLAYING_SURFACES, or custom string via "Other". */
  playing_surface: string[]
  /** Free text. E.g. "MRF Approved", "SG Certified". */
  certification: string
  /** Multi-select. Values from BEST_FOR_OPTIONS. */
  best_for: string[]
  /** Free text. E.g. "Ball, Kit Bag, Instruction Booklet". */
  in_box_includes: string
  /** Boolean toggle. True if the product can be customised (embroidery, print, etc.). */
  customization_available: boolean
  /** Single select from PROTECTION_LEVELS. Empty string if not set. */
  protection_level: string
}

// ─── Sport-Specific Attributes ────────────────────────────────────────────────

/**
 * Cricket Ball specific attributes.
 * Stored under the `sport_specific` key in the `sports_attributes` jsonb column.
 *
 * String fields (ball_type, ball_grade, seam_type, ball_size) accept both
 * predefined option values and free-text custom values entered via "Other (specify)".
 * ball_color is multi-select and follows the same rule.
 */
export interface BallAttributes {
  /** Discriminator. Always "Ball" for this interface. */
  equipment_type: EquipmentType.Ball
  /** Predefined from BALL_TYPES or free text via "Other (specify)". */
  ball_type: string
  /** Multi-select. Values from BALL_GRADES. */
  ball_grade: string[]
  /** Predefined from SEAM_TYPES or free text via "Other (specify)". */
  seam_type: string
  /** Multi-select. Values from BALL_COLORS or free text via "Other (specify)". */
  ball_color: string[]
  /** Predefined from BALL_SIZES or free text via "Other (specify)". */
  ball_size: string
  /** Free text. E.g. "30–35 overs", "50+ overs". */
  overs_durability: string
}

// ─── Main Interface ───────────────────────────────────────────────────────────

/**
 * Generic attributes for non-ball equipment types (Bat, Gloves, Pads, etc.).
 * Only the discriminator is required; additional fields can be added per type later.
 */
export interface GenericEquipmentAttributes {
  equipment_type: Exclude<EquipmentType, EquipmentType.Ball>
}

/** Discriminated union of all sport-specific attribute shapes. */
export type SportSpecificAttributes = BallAttributes | GenericEquipmentAttributes

/**
 * The complete sports_attributes structure stored as jsonb on the product table.
 * `sport_specific` is a discriminated union keyed on `equipment_type`.
 */
export interface SportsAttributes {
  /** The sport this product belongs to. */
  sport: Sport
  /** Attributes common to all equipment types within the sport. */
  common: CommonAttributes
  /** Attributes specific to the equipment type (discriminated by equipment_type). */
  sport_specific: SportSpecificAttributes
}

// ─── Default / Empty State ────────────────────────────────────────────────────

/**
 * A clean empty SportsAttributes object.
 * Used to initialise the Admin UI widget form when no data has been saved yet.
 * All arrays are empty, all strings are empty string, boolean is false.
 */
export const DEFAULT_SPORTS_ATTRIBUTES: SportsAttributes = {
  sport: Sport.Cricket,
  common: {
    skill_level: [],
    age_group: [],
    activity_intensity: [],
    playing_surface: [],
    certification: "",
    best_for: [],
    in_box_includes: "",
    customization_available: false,
    protection_level: "",
  },
  sport_specific: {
    equipment_type: EquipmentType.Ball,
    ball_type: "",
    ball_grade: [],
    seam_type: "",
    ball_color: [],
    ball_size: "",
    overs_durability: "",
  },
}
