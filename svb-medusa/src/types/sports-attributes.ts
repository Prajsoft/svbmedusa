// ─── Sports Enum ─────────────────────────────────────────────────────────────

/**
 * Supported sports. Cricket is the only sport in V1.
 * Add new values here when expanding to other sports.
 */
export enum Sport {
  Cricket = "Cricket",
  Football = "Football",
  Basketball = "Basketball",
  Volleyball = "Volleyball",
}

// ─── Equipment Type Enum ─────────────────────────────────────────────────────

/**
 * Equipment types within a sport.
 * Add new values here when expanding to new product categories.
 */
export enum EquipmentType {
  // ── Balls ──
  Ball = "Ball",
  // ── Bats ──
  Bat = "Bat",
  // ── Hand Protection ──
  BattingGloves = "BattingGloves",
  WicketKeepingGloves = "WicketKeepingGloves",
  InnerGloves = "InnerGloves",
  // ── Leg Protection ──
  BattingPads = "BattingPads",
  WicketKeepingPads = "WicketKeepingPads",
  // ── Head Protection ──
  Helmet = "Helmet",
  // ── Body Protection ──
  AbdominalGuard = "AbdominalGuard",
  ThighGuard = "ThighGuard",
  ArmGuard = "ArmGuard",
  ChestGuard = "ChestGuard",
  // ── Footwear ──
  Footwear = "Footwear",
  // ── Clothing ──
  Clothing = "Clothing",
  // ── Bags ──
  Bag = "Bag",
  // ── Bat Accessories ──
  BatAccessory = "BatAccessory",
  // ── Training Equipment ──
  TrainingEquipment = "TrainingEquipment",

  // ── Football ──
  FootballBall = "FootballBall",
  FootballBoots = "FootballBoots",
  FootballShinGuards = "FootballShinGuards",
  GoalkeeperGloves = "GoalkeeperGloves",

  // ── Basketball ──
  BasketballBall = "BasketballBall",
  BasketballShoes = "BasketballShoes",

  // ── Volleyball ──
  VolleyballBall = "VolleyballBall",
  VolleyballShoes = "VolleyballShoes",
  VolleyballKneePads = "VolleyballKneePads",
}

/** Ordered list of equipment types for dropdowns. */
export const EQUIPMENT_TYPES = Object.values(EquipmentType) as EquipmentType[]

// ─── Shared Allowed Values ────────────────────────────────────────────────────
// Defined as const arrays (not enums) so they serve double duty:
// 1. TypeScript union types via `typeof ARRAY[number]`
// 2. Option lists rendered directly in the Admin UI widget

export const SKILL_LEVELS = [
  "Beginner",
  "Intermediate",
  "Advanced",
  "Professional",
] as const

export const AGE_GROUPS = ["Junior", "Youth", "Adult"] as const

export const ACTIVITY_INTENSITIES = [
  "Recreational",
  "Training",
  "Competitive",
  "Professional",
] as const

export const PLAYING_SURFACES = [
  "Indoor",
  "Outdoor",
  "Turf",
  "Grass",
  "Hard Court",
  "Clay",
] as const

export const BEST_FOR_OPTIONS = [
  "School",
  "Academy",
  "Club",
  "Professional",
] as const

export const PROTECTION_LEVELS = ["Basic", "Standard", "Premium"] as const

export const GENDER_OPTIONS = ["Male", "Female", "Unisex"] as const

export const HAND_OPTIONS = ["Left", "Right", "Pair"] as const

// ── Ball ─────────────────────────────────────────────────────────────────────

export const BALL_TYPES = [
  "Leather",
  "Tennis",
  "Rubber",
  "Tape",
  "Synthetic",
] as const

export const BALL_GRADES = ["Match", "Practice", "Training", "Club"] as const

export const SEAM_TYPES = [
  "Machine Stitched",
  "Hand Stitched",
  "Reinforced",
] as const

export const BALL_COLORS = [
  "Red",
  "White",
  "Pink",
  "Orange",
  "Yellow",
] as const

export const BALL_SIZES = ["Size 4 (Junior)", "Size 5 (Standard)"] as const

// ── Bat ──────────────────────────────────────────────────────────────────────

export const WOOD_TYPES = ["English Willow", "Kashmir Willow"] as const

export const BLADE_GRADES = [
  "Grade 1",
  "Grade 2",
  "Grade 3",
  "Grade 4",
  "Grade 5",
] as const

export const BLADE_PROFILES = ["Thin", "Standard", "Thick"] as const

export const BLADE_EDGES = ["Low", "Medium", "High", "Jumbo"] as const

export const BLADE_SPINES = ["Low", "Medium", "High"] as const

export const HANDLE_TYPES = ["Round", "Oval", "Semi-Oval"] as const

export const HANDLE_LENGTHS = ["Short", "Standard", "Long"] as const

// ── Gloves ───────────────────────────────────────────────────────────────────

export const PALM_MATERIALS = ["Leather", "Synthetic", "Chamois"] as const

export const GLOVE_VENTILATION_TYPES = [
  "Mesh",
  "Perforated",
  "Full Cover",
] as const

export const WRIST_CLOSURE_TYPES = ["Velcro", "Button", "None"] as const

export const WK_WEBBING_TYPES = [
  "Single Web",
  "Double Web",
  "Butterfly",
] as const

// ── Pads ─────────────────────────────────────────────────────────────────────

export const PAD_MATERIALS = ["Cane", "Foam", "Hybrid"] as const

export const KNEE_ROLL_TYPES = ["Floating", "Fixed"] as const

export const STRAP_COUNTS = ["2", "3"] as const

export const WK_PAD_STYLES = ["Traditional", "Wrap-Around"] as const

// ── Helmet ───────────────────────────────────────────────────────────────────

export const HELMET_STANDARDS = [
  "BS 7928:2013",
  "ECB",
  "Other",
] as const

export const GRILL_TYPES = [
  "Steel",
  "Titanium",
  "Carbon Fiber",
  "Stemguard",
] as const

export const PEAK_TYPES = ["Standard", "Long"] as const

// ── Body Protection ──────────────────────────────────────────────────────────

export const BODY_GUARD_TYPES = [
  "Abdominal",
  "Thigh",
  "Arm",
  "Chest",
  "Rib",
] as const

export const BODY_GUARD_MATERIALS = [
  "EVA",
  "Foam",
  "Hard Shell",
  "Hybrid",
] as const

// ── Footwear ─────────────────────────────────────────────────────────────────

export const SOLE_TYPES = [
  "Metal Spikes",
  "Rubber Spikes",
  "Rubber Studs",
  "Multi-Stud",
  "Flat",
] as const

export const UPPER_MATERIALS = ["Leather", "Synthetic", "Mesh"] as const

export const SHOE_SURFACES = [
  "Grass",
  "Turf",
  "Indoor",
  "All-Purpose",
] as const

export const CLOSURE_TYPES = ["Lace", "Velcro", "Boa"] as const

// ── Clothing ─────────────────────────────────────────────────────────────────

export const GARMENT_TYPES = [
  "Jersey",
  "Trousers",
  "Whites",
  "Cap",
  "Sweater",
  "Compression",
] as const

export const FABRIC_TYPES = [
  "Polyester",
  "Cotton",
  "Poly-Cotton",
  "Merino Wool",
] as const

export const FIT_TYPES = ["Regular", "Slim", "Loose"] as const

export const SEASONS = ["Summer", "Winter", "All-Season"] as const

// ── Bags ─────────────────────────────────────────────────────────────────────

export const BAG_TYPES = [
  "Kit Bag",
  "Duffle",
  "Wheelie",
  "Backpack",
  "Coffin",
] as const

export const BAG_MATERIALS = ["Polyester", "Canvas", "PU Leather"] as const

// ── Bat Accessories ──────────────────────────────────────────────────────────

export const BAT_ACCESSORY_TYPES = [
  "Grip",
  "Edge Tape",
  "Anti-Scuff Sheet",
  "Toe Guard",
  "Bat Oil",
  "Grip Cone",
  "Bat Cover",
] as const

export const BAT_SIZES = [
  "Full / SH",
  "Long Handle",
  "Harrow",
  "Size 6",
  "Size 5",
  "Size 4",
  "Size 3",
] as const

// ── Training Equipment ───────────────────────────────────────────────────────

export const TRAINING_EQUIPMENT_TYPES = [
  "Stumps",
  "Bails",
  "Batting Tee",
  "Throw Down",
  "Catching Cradle",
  "Bowling Machine",
  "Practice Net",
] as const

export const TRAINING_MATERIALS = [
  "Wood",
  "Plastic",
  "Fiberglass",
  "Metal",
] as const

// ── Football ─────────────────────────────────────────────────────────────────

export const FOOTBALL_BALL_SIZES = [
  "Size 1",
  "Size 2",
  "Size 3",
  "Size 4",
  "Size 5",
] as const

export const FOOTBALL_BALL_TYPES = [
  "Match",
  "Training",
  "Futsal",
  "Beach",
] as const

export const FOOTBALL_PANEL_TYPES = [
  "32-Panel",
  "Thermally Bonded",
  "Hand Stitched",
] as const

export const FOOTBALL_BALL_MATERIALS = ["PU", "PVC", "Leather"] as const

export const BLADDER_TYPES = ["Butyl", "Latex"] as const

export const STUD_TYPES = [
  "FG (Firm Ground)",
  "SG (Soft Ground)",
  "AG (Artificial Ground)",
  "TF (Turf)",
  "IC (Indoor Court)",
] as const

export const SHIN_GUARD_TYPES = ["Slip-In", "Ankle", "Sleeve"] as const

export const SHIN_GUARD_MATERIALS = [
  "Fiberglass",
  "Carbon Fiber",
  "Foam",
  "Plastic",
] as const

export const GK_GLOVE_CUT_TYPES = [
  "Flat",
  "Roll Finger",
  "Negative",
  "Hybrid",
] as const

export const GK_GLOVE_PALM_MATERIALS = ["Latex", "Synthetic"] as const

// ── Basketball ───────────────────────────────────────────────────────────────

export const BASKETBALL_SIZES = ["Size 5", "Size 6", "Size 7"] as const

export const BASKETBALL_BALL_TYPES = [
  "Indoor",
  "Outdoor",
  "Indoor-Outdoor",
] as const

export const BASKETBALL_BALL_MATERIALS = [
  "Leather",
  "Composite Leather",
  "Rubber",
] as const

export const BASKETBALL_SHOE_CUTS = ["Low", "Mid", "High"] as const

export const BASKETBALL_CUSHIONING_TYPES = ["Air", "Foam", "Zoom"] as const

// ── Volleyball ───────────────────────────────────────────────────────────────

export const VOLLEYBALL_BALL_TYPES = [
  "Indoor",
  "Beach",
  "Training",
] as const

export const VOLLEYBALL_PANEL_COUNTS = ["8", "18"] as const

export const VOLLEYBALL_BALL_MATERIALS = [
  "Leather",
  "Synthetic",
  "Rubber",
] as const

export const VOLLEYBALL_SHOE_CUTS = ["Low", "Mid"] as const

export const VOLLEYBALL_CUSHIONING_TYPES = ["Gel", "Air", "Foam"] as const

// ─── Common Attributes ────────────────────────────────────────────────────────

/**
 * Fields shared across all sports and equipment types.
 * Stored under the `common` key in the `sports_attributes` jsonb column.
 */
export interface CommonAttributes {
  skill_level: string[]
  age_group: string[]
  activity_intensity: string[]
  playing_surface: string[]
  /** Free text. E.g. "MRF Approved", "SG Certified". */
  certification: string
  best_for: string[]
  /** Free text. E.g. "Ball, Kit Bag, Instruction Booklet". */
  in_box_includes: string
  customization_available: boolean
  protection_level: string
}

// ─── Sport-Specific Attribute Interfaces ──────────────────────────────────────

export interface BallAttributes {
  equipment_type: EquipmentType.Ball
  ball_type: string
  ball_grade: string[]
  seam_type: string
  ball_color: string[]
  ball_size: string
  /** Free text. E.g. "30–35 overs", "50+ overs". */
  overs_durability: string
}

export interface BatAttributes {
  equipment_type: EquipmentType.Bat
  wood_type: string
  blade_grade: string
  blade_profile: string
  blade_edge: string
  blade_spine: string
  /** Free text. E.g. "2lb 7oz–2lb 10oz". */
  bat_weight_range: string
  handle_type: string
  handle_length: string
  grip_included: boolean
  toe_guard_included: boolean
}

export interface BattingGlovesAttributes {
  equipment_type: EquipmentType.BattingGloves
  glove_hand: string
  palm_material: string
  ventilation: string
  wrist_closure: string
}

export interface WicketKeepingGlovesAttributes {
  equipment_type: EquipmentType.WicketKeepingGloves
  glove_hand: string
  palm_material: string
  webbing_type: string
}

export interface InnerGlovesAttributes {
  equipment_type: EquipmentType.InnerGloves
  glove_hand: string
  material: string
}

export interface BattingPadsAttributes {
  equipment_type: EquipmentType.BattingPads
  pad_side: string
  pad_material: string
  knee_roll: string
  straps_count: string
  shin_guard_included: boolean
}

export interface WicketKeepingPadsAttributes {
  equipment_type: EquipmentType.WicketKeepingPads
  pad_side: string
  pad_style: string
  straps_count: string
}

export interface HelmetAttributes {
  equipment_type: EquipmentType.Helmet
  helmet_standard: string
  grill_type: string
  peak_type: string
  size_adjustable: boolean
}

export interface BodyProtectionAttributes {
  equipment_type:
    | EquipmentType.AbdominalGuard
    | EquipmentType.ThighGuard
    | EquipmentType.ArmGuard
    | EquipmentType.ChestGuard
  guard_type: string
  material: string
  gender: string
}

export interface FootwearAttributes {
  equipment_type: EquipmentType.Footwear
  sole_type: string
  upper_material: string
  surface_type: string[]
  closure_type: string
}

export interface ClothingAttributes {
  equipment_type: EquipmentType.Clothing
  garment_type: string
  fabric: string
  fit_type: string
  gender: string
  season: string
  /** Free text. E.g. "White", "Royal Blue / Gold". */
  color: string
}

export interface BagAttributes {
  equipment_type: EquipmentType.Bag
  bag_type: string
  bag_material: string
  /** Free text. E.g. "65L". */
  capacity: string
  wheels: boolean
  waterproof: boolean
}

export interface BatAccessoryAttributes {
  equipment_type: EquipmentType.BatAccessory
  accessory_type: string
  compatible_bat_size: string[]
  /** Free text. E.g. "Natural Rubber", "Polyurethane". */
  material: string
}

export interface TrainingEquipmentAttributes {
  equipment_type: EquipmentType.TrainingEquipment
  training_type: string
  material: string
  portable: boolean
  surface_compatibility: string[]
}

// ─── Football Interfaces ──────────────────────────────────────────────────────

export interface FootballBallAttributes {
  equipment_type: EquipmentType.FootballBall
  ball_size: string
  ball_type: string
  panel_type: string
  material: string
  bladder_type: string
  fifa_approved: boolean
}

export interface FootballBootsAttributes {
  equipment_type: EquipmentType.FootballBoots
  stud_type: string
  upper_material: string
  closure_type: string
}

export interface FootballShinGuardsAttributes {
  equipment_type: EquipmentType.FootballShinGuards
  guard_type: string
  material: string
  gender: string
}

export interface GoalkeeperGlovesAttributes {
  equipment_type: EquipmentType.GoalkeeperGloves
  cut_type: string
  palm_material: string
  /** Free text. E.g. "3mm German Latex". */
  backhand: string
}

// ─── Basketball Interfaces ────────────────────────────────────────────────────

export interface BasketballBallAttributes {
  equipment_type: EquipmentType.BasketballBall
  ball_size: string
  ball_type: string
  material: string
  nba_approved: boolean
}

export interface BasketballShoesAttributes {
  equipment_type: EquipmentType.BasketballShoes
  cut_type: string
  surface_type: string[]
  cushioning: string
  closure_type: string
}

// ─── Volleyball Interfaces ────────────────────────────────────────────────────

export interface VolleyballBallAttributes {
  equipment_type: EquipmentType.VolleyballBall
  ball_type: string
  panel_count: string
  material: string
  fivb_approved: boolean
}

export interface VolleyballShoesAttributes {
  equipment_type: EquipmentType.VolleyballShoes
  cut_type: string
  surface_type: string[]
  cushioning: string
}

export interface VolleyballKneePadsAttributes {
  equipment_type: EquipmentType.VolleyballKneePads
  material: string
  thickness: string
  gender: string
}

// ─── Discriminated Union ──────────────────────────────────────────────────────

export type SportSpecificAttributes =
  | BallAttributes
  | BatAttributes
  | BattingGlovesAttributes
  | WicketKeepingGlovesAttributes
  | InnerGlovesAttributes
  | BattingPadsAttributes
  | WicketKeepingPadsAttributes
  | HelmetAttributes
  | BodyProtectionAttributes
  | FootwearAttributes
  | ClothingAttributes
  | BagAttributes
  | BatAccessoryAttributes
  | TrainingEquipmentAttributes
  // Football
  | FootballBallAttributes
  | FootballBootsAttributes
  | FootballShinGuardsAttributes
  | GoalkeeperGlovesAttributes
  // Basketball
  | BasketballBallAttributes
  | BasketballShoesAttributes
  // Volleyball
  | VolleyballBallAttributes
  | VolleyballShoesAttributes
  | VolleyballKneePadsAttributes

// ─── Main Shape ───────────────────────────────────────────────────────────────

export interface SportsAttributes {
  sport: Sport
  common: CommonAttributes
  sport_specific: SportSpecificAttributes
}

// ─── Default / Empty State ────────────────────────────────────────────────────

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
