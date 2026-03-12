import {
  Component,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react"
import { defineWidgetConfig } from "@medusajs/admin-sdk"
import type { DetailWidgetProps } from "@medusajs/types"
import {
  Badge,
  Button,
  Container,
  Heading,
  Input,
  Select,
  Skeleton,
  Switch,
  Text,
} from "@medusajs/ui"
import {
  AGE_GROUPS,
  ACTIVITY_INTENSITIES,
  BALL_COLORS,
  BALL_GRADES,
  BALL_SIZES,
  BALL_TYPES,
  BAG_MATERIALS,
  BAG_TYPES,
  BASKETBALL_BALL_MATERIALS,
  BASKETBALL_BALL_TYPES,
  BASKETBALL_CUSHIONING_TYPES,
  BASKETBALL_SHOE_CUTS,
  BASKETBALL_SIZES,
  BAT_ACCESSORY_TYPES,
  BAT_SIZES,
  BEST_FOR_OPTIONS,
  BLADE_EDGES,
  BLADE_GRADES,
  BLADE_PROFILES,
  BLADE_SPINES,
  BLADDER_TYPES,
  BODY_GUARD_MATERIALS,
  CLOSURE_TYPES,
  DEFAULT_SPORTS_ATTRIBUTES,
  EquipmentType,
  FABRIC_TYPES,
  FIT_TYPES,
  FOOTBALL_BALL_MATERIALS,
  FOOTBALL_BALL_SIZES,
  FOOTBALL_BALL_TYPES,
  FOOTBALL_PANEL_TYPES,
  GARMENT_TYPES,
  GENDER_OPTIONS,
  GK_GLOVE_CUT_TYPES,
  GK_GLOVE_PALM_MATERIALS,
  GLOVE_VENTILATION_TYPES,
  HANDLE_LENGTHS,
  HANDLE_TYPES,
  HAND_OPTIONS,
  HELMET_STANDARDS,
  GRILL_TYPES,
  KNEE_ROLL_TYPES,
  PAD_MATERIALS,
  PALM_MATERIALS,
  PEAK_TYPES,
  PLAYING_SURFACES,
  PROTECTION_LEVELS,
  SEAM_TYPES,
  SEASONS,
  SHIN_GUARD_MATERIALS,
  SHIN_GUARD_TYPES,
  SHOE_SURFACES,
  SKILL_LEVELS,
  SOLE_TYPES,
  Sport,
  STRAP_COUNTS,
  STUD_TYPES,
  TRAINING_EQUIPMENT_TYPES,
  TRAINING_MATERIALS,
  UPPER_MATERIALS,
  VOLLEYBALL_BALL_MATERIALS,
  VOLLEYBALL_BALL_TYPES,
  VOLLEYBALL_CUSHIONING_TYPES,
  VOLLEYBALL_PANEL_COUNTS,
  VOLLEYBALL_SHOE_CUTS,
  WK_PAD_STYLES,
  WK_WEBBING_TYPES,
  WOOD_TYPES,
  WRIST_CLOSURE_TYPES,
  type BallAttributes,
  type BatAttributes,
  type BattingGlovesAttributes,
  type WicketKeepingGlovesAttributes,
  type InnerGlovesAttributes,
  type BattingPadsAttributes,
  type WicketKeepingPadsAttributes,
  type HelmetAttributes,
  type BodyProtectionAttributes,
  type FootwearAttributes,
  type ClothingAttributes,
  type BagAttributes,
  type BatAccessoryAttributes,
  type TrainingEquipmentAttributes,
  type FootballBallAttributes,
  type FootballBootsAttributes,
  type FootballShinGuardsAttributes,
  type GoalkeeperGlovesAttributes,
  type BasketballBallAttributes,
  type BasketballShoesAttributes,
  type VolleyballBallAttributes,
  type VolleyballShoesAttributes,
  type VolleyballKneePadsAttributes,
  type SportSpecificAttributes,
  type SportsAttributes,
} from "../../types/sports-attributes"

// ── Sport → valid equipment types ────────────────────────────────────────────
const SPORT_EQUIPMENT_MAP: Record<Sport, EquipmentType[]> = {
  [Sport.Cricket]: [
    EquipmentType.Ball,
    EquipmentType.Bat,
    EquipmentType.BattingGloves,
    EquipmentType.WicketKeepingGloves,
    EquipmentType.InnerGloves,
    EquipmentType.BattingPads,
    EquipmentType.WicketKeepingPads,
    EquipmentType.Helmet,
    EquipmentType.AbdominalGuard,
    EquipmentType.ThighGuard,
    EquipmentType.ArmGuard,
    EquipmentType.ChestGuard,
    EquipmentType.Footwear,
    EquipmentType.Clothing,
    EquipmentType.Bag,
    EquipmentType.BatAccessory,
    EquipmentType.TrainingEquipment,
  ],
  [Sport.Football]: [
    EquipmentType.FootballBall,
    EquipmentType.FootballBoots,
    EquipmentType.FootballShinGuards,
    EquipmentType.GoalkeeperGloves,
    EquipmentType.Footwear,
    EquipmentType.Clothing,
    EquipmentType.Bag,
    EquipmentType.TrainingEquipment,
  ],
  [Sport.Basketball]: [
    EquipmentType.BasketballBall,
    EquipmentType.BasketballShoes,
    EquipmentType.Clothing,
    EquipmentType.Bag,
    EquipmentType.TrainingEquipment,
  ],
  [Sport.Volleyball]: [
    EquipmentType.VolleyballBall,
    EquipmentType.VolleyballShoes,
    EquipmentType.VolleyballKneePads,
    EquipmentType.Clothing,
    EquipmentType.Bag,
    EquipmentType.TrainingEquipment,
  ],
}

// ── Default sport_specific state per equipment type ───────────────────────────
function getDefaultSpecific(type: EquipmentType): SportSpecificAttributes {
  switch (type) {
    case EquipmentType.Ball:
      return { equipment_type: EquipmentType.Ball, ball_type: "", ball_grade: [], seam_type: "", ball_color: [], ball_size: "", overs_durability: "" }
    case EquipmentType.Bat:
      return { equipment_type: EquipmentType.Bat, wood_type: "", blade_grade: "", blade_profile: "", blade_edge: "", blade_spine: "", bat_weight_range: "", handle_type: "", handle_length: "", grip_included: false, toe_guard_included: false }
    case EquipmentType.BattingGloves:
      return { equipment_type: EquipmentType.BattingGloves, glove_hand: "", palm_material: "", ventilation: "", wrist_closure: "" }
    case EquipmentType.WicketKeepingGloves:
      return { equipment_type: EquipmentType.WicketKeepingGloves, glove_hand: "", palm_material: "", webbing_type: "" }
    case EquipmentType.InnerGloves:
      return { equipment_type: EquipmentType.InnerGloves, glove_hand: "", material: "" }
    case EquipmentType.BattingPads:
      return { equipment_type: EquipmentType.BattingPads, pad_side: "", pad_material: "", knee_roll: "", straps_count: "", shin_guard_included: false }
    case EquipmentType.WicketKeepingPads:
      return { equipment_type: EquipmentType.WicketKeepingPads, pad_side: "", pad_style: "", straps_count: "" }
    case EquipmentType.Helmet:
      return { equipment_type: EquipmentType.Helmet, helmet_standard: "", grill_type: "", peak_type: "", size_adjustable: false }
    case EquipmentType.AbdominalGuard:
    case EquipmentType.ThighGuard:
    case EquipmentType.ArmGuard:
    case EquipmentType.ChestGuard:
      return { equipment_type: type as EquipmentType.AbdominalGuard, guard_type: "", material: "", gender: "" }
    case EquipmentType.Footwear:
      return { equipment_type: EquipmentType.Footwear, sole_type: "", upper_material: "", surface_type: [], closure_type: "" }
    case EquipmentType.Clothing:
      return { equipment_type: EquipmentType.Clothing, garment_type: "", fabric: "", fit_type: "", gender: "", season: "", color: "" }
    case EquipmentType.Bag:
      return { equipment_type: EquipmentType.Bag, bag_type: "", bag_material: "", capacity: "", wheels: false, waterproof: false }
    case EquipmentType.BatAccessory:
      return { equipment_type: EquipmentType.BatAccessory, accessory_type: "", compatible_bat_size: [], material: "" }
    case EquipmentType.TrainingEquipment:
      return { equipment_type: EquipmentType.TrainingEquipment, training_type: "", material: "", portable: false, surface_compatibility: [] }
    case EquipmentType.FootballBall:
      return { equipment_type: EquipmentType.FootballBall, ball_size: "", ball_type: "", panel_type: "", material: "", bladder_type: "", fifa_approved: false }
    case EquipmentType.FootballBoots:
      return { equipment_type: EquipmentType.FootballBoots, stud_type: "", upper_material: "", closure_type: "" }
    case EquipmentType.FootballShinGuards:
      return { equipment_type: EquipmentType.FootballShinGuards, guard_type: "", material: "", gender: "" }
    case EquipmentType.GoalkeeperGloves:
      return { equipment_type: EquipmentType.GoalkeeperGloves, cut_type: "", palm_material: "", backhand: "" }
    case EquipmentType.BasketballBall:
      return { equipment_type: EquipmentType.BasketballBall, ball_size: "", ball_type: "", material: "", nba_approved: false }
    case EquipmentType.BasketballShoes:
      return { equipment_type: EquipmentType.BasketballShoes, cut_type: "", surface_type: [], cushioning: "", closure_type: "" }
    case EquipmentType.VolleyballBall:
      return { equipment_type: EquipmentType.VolleyballBall, ball_type: "", panel_count: "", material: "", fivb_approved: false }
    case EquipmentType.VolleyballShoes:
      return { equipment_type: EquipmentType.VolleyballShoes, cut_type: "", surface_type: [], cushioning: "" }
    case EquipmentType.VolleyballKneePads:
      return { equipment_type: EquipmentType.VolleyballKneePads, material: "", thickness: "", gender: "" }
  }
}

// ── Module-level constants ────────────────────────────────────────────────────
const BALL_COLORS_SET = new Set<string>(BALL_COLORS)

// ── Error Boundary ────────────────────────────────────────────────────────────
class ErrorBoundary extends Component<{ children?: ReactNode }, { hasError: boolean }> {
  constructor(props: { children?: ReactNode }) {
    super(props)
    this.state = { hasError: false }
  }
  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true }
  }
  override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <Container>
          <Text className="text-red-500">
            Sports Attributes widget encountered an error. Please reload the page.
          </Text>
        </Container>
      )
    }
    return this.props.children ?? null
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const isKnownOption = (value: string, options: readonly string[]): boolean =>
  options.includes(value)

// ── MultiCheckbox ─────────────────────────────────────────────────────────────
const MultiCheckbox = ({
  options,
  values,
  onChange,
  disabled,
}: {
  options: readonly string[]
  values: string[]
  onChange: (values: string[]) => void
  disabled: boolean
}) => (
  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
    {options.map((opt) => {
      const checked = values.includes(opt)
      const id = `mc-${opt.replace(/\s+/g, "-").toLowerCase()}`
      return (
        <div key={opt} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <input
            id={id}
            type="checkbox"
            checked={checked}
            disabled={disabled}
            onChange={() =>
              onChange(checked ? values.filter((v) => v !== opt) : [...values, opt])
            }
            style={{ width: "16px", height: "16px", cursor: disabled ? "not-allowed" : "pointer", accentColor: "#7c3aed", flexShrink: 0 }}
          />
          <label htmlFor={id} style={{ fontSize: "14px", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.6 : 1, userSelect: "none" }}>
            {opt}
          </label>
        </div>
      )
    })}
  </div>
)

// ── ColorChips ────────────────────────────────────────────────────────────────
const ColorChips = ({
  values,
  onChange,
  disabled,
}: {
  values: string[]
  onChange: (values: string[]) => void
  disabled: boolean
}) => {
  const customColors = values.filter((v) => !BALL_COLORS_SET.has(v))
  const [otherActive, setOtherActive] = useState(customColors.length > 0)
  const [otherText, setOtherText] = useState(customColors.join(", "))

  const toggleKnown = (color: string) => {
    onChange(values.includes(color) ? values.filter((v) => v !== color) : [...values, color])
  }

  const toggleOther = () => {
    if (otherActive) {
      setOtherActive(false)
      setOtherText("")
      onChange(values.filter((v) => BALL_COLORS_SET.has(v)))
    } else {
      setOtherActive(true)
    }
  }

  const applyOtherText = (text: string) => {
    setOtherText(text)
    const known = values.filter((v) => BALL_COLORS_SET.has(v))
    const custom = text.split(",").map((s) => s.trim()).filter(Boolean)
    onChange([...known, ...custom])
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        {BALL_COLORS.map((color) => {
          const checked = values.includes(color)
          const id = `bc-${color.replace(/\s+/g, "-").toLowerCase()}`
          return (
            <div key={color} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={() => toggleKnown(color)}
                style={{ width: "16px", height: "16px", cursor: disabled ? "not-allowed" : "pointer", accentColor: "#7c3aed", flexShrink: 0 }} />
              <label htmlFor={id} style={{ fontSize: "14px", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.6 : 1, userSelect: "none" }}>
                {color}
              </label>
            </div>
          )
        })}
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <input id="bc-other" type="checkbox" checked={otherActive} disabled={disabled} onChange={toggleOther}
            style={{ width: "16px", height: "16px", cursor: disabled ? "not-allowed" : "pointer", accentColor: "#7c3aed", flexShrink: 0 }} />
          <label htmlFor="bc-other" style={{ fontSize: "14px", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.6 : 1, userSelect: "none" }}>
            Other
          </label>
        </div>
      </div>
      {otherActive && (
        <Input placeholder="Custom colour(s), comma-separated" value={otherText}
          onChange={(e) => applyOtherText(e.target.value)} disabled={disabled} />
      )}
    </div>
  )
}

// ── SelectWithOther ───────────────────────────────────────────────────────────
const SelectWithOther = ({
  options,
  value,
  onChange,
  placeholder,
  disabled,
  error,
}: {
  options: readonly string[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled: boolean
  error?: string
}) => {
  const known = value === "" || isKnownOption(value, options)
  const displayValue = known ? value : "other"
  const [otherText, setOtherText] = useState(known ? "" : value)
  const [isOtherMode, setIsOtherMode] = useState(!known)

  const handleSelect = (v: string) => {
    if (v === "other") {
      setIsOtherMode(true)
      onChange(otherText)
    } else {
      setIsOtherMode(false)
      setOtherText("")
      onChange(v)
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      <Select value={displayValue} onValueChange={handleSelect} disabled={disabled}>
        <Select.Trigger>
          <Select.Value placeholder={placeholder ?? "Select..."} />
        </Select.Trigger>
        <Select.Content>
          {options.map((opt) => (
            <Select.Item key={opt} value={opt}>{opt}</Select.Item>
          ))}
          <Select.Item value="other">Other (specify)</Select.Item>
        </Select.Content>
      </Select>
      {(isOtherMode || displayValue === "other") && (
        <Input placeholder="Specify..." value={otherText}
          onChange={(e) => { setOtherText(e.target.value); onChange(e.target.value) }}
          disabled={disabled} />
      )}
      {error && <Text size="small" className="text-red-500">{error}</Text>}
    </div>
  )
}

// ── SimpleSelect ──────────────────────────────────────────────────────────────
const SimpleSelect = ({
  options,
  value,
  onChange,
  placeholder,
  disabled,
  error,
}: {
  options: readonly string[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled: boolean
  error?: string
}) => (
  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <Select.Trigger>
        <Select.Value placeholder={placeholder ?? "Select..."} />
      </Select.Trigger>
      <Select.Content>
        {options.map((opt) => (
          <Select.Item key={opt} value={opt}>{opt}</Select.Item>
        ))}
      </Select.Content>
    </Select>
    {error && <Text size="small" className="text-red-500">{error}</Text>}
  </div>
)

// ── FieldRow ──────────────────────────────────────────────────────────────────
const FieldRow = ({ label, children }: { label: string; children: ReactNode }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
    <Text size="small" weight="plus">{label}</Text>
    {children}
  </div>
)

// ── SwitchRow ─────────────────────────────────────────────────────────────────
const SwitchRow = ({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  disabled: boolean
}) => (
  <FieldRow label={label}>
    <div style={{ display: "flex", alignItems: "center", gap: "10px", height: "36px" }}>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
      <Text size="small">{checked ? "Yes" : "No"}</Text>
    </div>
  </FieldRow>
)

// ── SportsAttributesWidget ────────────────────────────────────────────────────
const SportsAttributesWidget = ({ data }: DetailWidgetProps<{ id: string }>) => {
  const productId = data.id

  const [attrs, setAttrs] = useState<SportsAttributes>(DEFAULT_SPORTS_ATTRIBUTES)
  const [savedAttrs, setSavedAttrs] = useState<SportsAttributes>(DEFAULT_SPORTS_ATTRIBUTES)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const savedTimerRef = useRef<number | null>(null)
  const fetchIdRef = useRef(0)

  const fetchData = useCallback(async () => {
    const fetchId = ++fetchIdRef.current
    setLoading(true)
    setFetchError(null)
    try {
      const res = await fetch(`/admin/products/${productId}/sports-attributes`, { credentials: "include" })
      if (fetchId !== fetchIdRef.current) return
      if (!res.ok) { setFetchError(`Failed to load sports attributes (HTTP ${res.status}).`); return }
      const body = (await res.json()) as { sports_attributes: SportsAttributes | null }
      if (fetchId !== fetchIdRef.current) return
      const loaded = body.sports_attributes ?? DEFAULT_SPORTS_ATTRIBUTES
      setAttrs(loaded)
      setSavedAttrs(loaded)
    } catch (err) {
      if (fetchId !== fetchIdRef.current) return
      setFetchError(err instanceof Error ? err.message : "Failed to load sports attributes.")
    } finally {
      if (fetchId === fetchIdRef.current) setLoading(false)
    }
  }, [productId])

  useEffect(() => {
    fetchData()
    return () => { fetchIdRef.current++ }
  }, [fetchData])

  useEffect(() => {
    return () => { if (savedTimerRef.current !== null) window.clearTimeout(savedTimerRef.current) }
  }, [])

  const isDirty = JSON.stringify(attrs) !== JSON.stringify(savedAttrs)

  const updateCommon = useCallback(
    <K extends keyof SportsAttributes["common"]>(field: K, value: SportsAttributes["common"][K]) => {
      setAttrs((prev) => ({ ...prev, common: { ...prev.common, [field]: value } }))
    }, []
  )

  // Generic updater for sport_specific fields
  const updateSpecific = useCallback((field: string, value: unknown) => {
    setAttrs((prev) => ({ ...prev, sport_specific: { ...prev.sport_specific, [field]: value } }))
  }, [])

  const handleSportChange = useCallback((newSport: string) => {
    const sport = newSport as Sport
    const firstType = SPORT_EQUIPMENT_MAP[sport][0]
    setAttrs((prev) => ({ ...prev, sport, sport_specific: getDefaultSpecific(firstType) }))
  }, [])

  const handleEquipmentTypeChange = useCallback((newType: string) => {
    setAttrs((prev) => ({ ...prev, sport_specific: getDefaultSpecific(newType as EquipmentType) }))
  }, [])

  const handleSave = useCallback(async () => {
    setSaving(true)
    setSaveError(null)
    setFieldErrors({})
    try {
      const res = await fetch(`/admin/products/${productId}/sports-attributes`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(attrs),
      })
      const body = (await res.json()) as { success?: boolean; error?: string; details?: Record<string, string> }
      if (!res.ok) {
        if (body.details) setFieldErrors(body.details)
        setSaveError(body.error ?? `Save failed (HTTP ${res.status}).`)
        return
      }
      setSavedAttrs(attrs)
      setSaved(true)
      if (savedTimerRef.current !== null) window.clearTimeout(savedTimerRef.current)
      savedTimerRef.current = window.setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save sports attributes.")
    } finally {
      setSaving(false)
    }
  }, [productId, attrs])

  const renderSkeleton = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <Skeleton key={i} style={{ height: "36px", borderRadius: "6px" }} />
      ))}
    </div>
  )

  const gridStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "16px 24px",
  }

  const et = attrs.sport_specific.equipment_type
  const sp = attrs.sport_specific
  const validTypes = SPORT_EQUIPMENT_MAP[attrs.sport]

  // ── Render equipment-type-specific section ───────────────────────────────────
  const renderSpecificSection = () => {
    switch (et) {

      // ── Cricket Ball ──────────────────────────────────────────────────────
      case EquipmentType.Ball: {
        const s = sp as BallAttributes
        return (
          <Section title="Ball Attributes">
            <FieldRow label="Ball Type">
              <SelectWithOther options={BALL_TYPES} value={s.ball_type} onChange={(v) => updateSpecific("ball_type", v)}
                placeholder="Select type..." disabled={saving} error={fieldErrors["sport_specific.ball_type"]} />
            </FieldRow>
            <FieldRow label="Ball Grade">
              <MultiCheckbox options={BALL_GRADES} values={s.ball_grade} onChange={(v) => updateSpecific("ball_grade", v)} disabled={saving} />
            </FieldRow>
            <FieldRow label="Seam Type">
              <SelectWithOther options={SEAM_TYPES} value={s.seam_type} onChange={(v) => updateSpecific("seam_type", v)}
                placeholder="Select seam type..." disabled={saving} error={fieldErrors["sport_specific.seam_type"]} />
            </FieldRow>
            <FieldRow label="Ball Size">
              <SelectWithOther options={BALL_SIZES} value={s.ball_size} onChange={(v) => updateSpecific("ball_size", v)}
                placeholder="Select size..." disabled={saving} error={fieldErrors["sport_specific.ball_size"]} />
            </FieldRow>
            <FieldRow label="Ball Color">
              <ColorChips values={s.ball_color} onChange={(v) => updateSpecific("ball_color", v)} disabled={saving} />
            </FieldRow>
            <FieldRow label="Overs Durability">
              <Input placeholder="e.g. 30–35 overs, 50+ overs" value={s.overs_durability}
                onChange={(e) => updateSpecific("overs_durability", e.target.value)} disabled={saving} />
            </FieldRow>
          </Section>
        )
      }

      // ── Cricket Bat ───────────────────────────────────────────────────────
      case EquipmentType.Bat: {
        const s = sp as BatAttributes
        return (
          <Section title="Bat Attributes">
            <FieldRow label="Wood Type">
              <SimpleSelect options={WOOD_TYPES} value={s.wood_type} onChange={(v) => updateSpecific("wood_type", v)}
                placeholder="Select wood..." disabled={saving} />
            </FieldRow>
            <FieldRow label="Blade Grade">
              <SimpleSelect options={BLADE_GRADES} value={s.blade_grade} onChange={(v) => updateSpecific("blade_grade", v)}
                placeholder="Select grade..." disabled={saving} />
            </FieldRow>
            <FieldRow label="Blade Profile">
              <SimpleSelect options={BLADE_PROFILES} value={s.blade_profile} onChange={(v) => updateSpecific("blade_profile", v)}
                placeholder="Select profile..." disabled={saving} />
            </FieldRow>
            <FieldRow label="Blade Edge">
              <SimpleSelect options={BLADE_EDGES} value={s.blade_edge} onChange={(v) => updateSpecific("blade_edge", v)}
                placeholder="Select edge..." disabled={saving} />
            </FieldRow>
            <FieldRow label="Blade Spine">
              <SimpleSelect options={BLADE_SPINES} value={s.blade_spine} onChange={(v) => updateSpecific("blade_spine", v)}
                placeholder="Select spine..." disabled={saving} />
            </FieldRow>
            <FieldRow label="Handle Type">
              <SimpleSelect options={HANDLE_TYPES} value={s.handle_type} onChange={(v) => updateSpecific("handle_type", v)}
                placeholder="Select handle..." disabled={saving} />
            </FieldRow>
            <FieldRow label="Handle Length">
              <SimpleSelect options={HANDLE_LENGTHS} value={s.handle_length} onChange={(v) => updateSpecific("handle_length", v)}
                placeholder="Select length..." disabled={saving} />
            </FieldRow>
            <FieldRow label="Weight Range">
              <Input placeholder="e.g. 2lb 7oz–2lb 10oz" value={s.bat_weight_range}
                onChange={(e) => updateSpecific("bat_weight_range", e.target.value)} disabled={saving} />
            </FieldRow>
            <SwitchRow label="Grip Included" checked={s.grip_included} onChange={(v) => updateSpecific("grip_included", v)} disabled={saving} />
            <SwitchRow label="Toe Guard Included" checked={s.toe_guard_included} onChange={(v) => updateSpecific("toe_guard_included", v)} disabled={saving} />
          </Section>
        )
      }

      // ── Batting Gloves ────────────────────────────────────────────────────
      case EquipmentType.BattingGloves: {
        const s = sp as BattingGlovesAttributes
        return (
          <Section title="Batting Gloves Attributes">
            <FieldRow label="Hand">
              <SimpleSelect options={HAND_OPTIONS} value={s.glove_hand} onChange={(v) => updateSpecific("glove_hand", v)}
                placeholder="Select hand..." disabled={saving} />
            </FieldRow>
            <FieldRow label="Palm Material">
              <SimpleSelect options={PALM_MATERIALS} value={s.palm_material} onChange={(v) => updateSpecific("palm_material", v)}
                placeholder="Select material..." disabled={saving} />
            </FieldRow>
            <FieldRow label="Ventilation">
              <SimpleSelect options={GLOVE_VENTILATION_TYPES} value={s.ventilation} onChange={(v) => updateSpecific("ventilation", v)}
                placeholder="Select ventilation..." disabled={saving} />
            </FieldRow>
            <FieldRow label="Wrist Closure">
              <SimpleSelect options={WRIST_CLOSURE_TYPES} value={s.wrist_closure} onChange={(v) => updateSpecific("wrist_closure", v)}
                placeholder="Select closure..." disabled={saving} />
            </FieldRow>
          </Section>
        )
      }

      // ── WK Gloves ─────────────────────────────────────────────────────────
      case EquipmentType.WicketKeepingGloves: {
        const s = sp as WicketKeepingGlovesAttributes
        return (
          <Section title="Wicket Keeping Gloves Attributes">
            <FieldRow label="Hand">
              <SimpleSelect options={HAND_OPTIONS} value={s.glove_hand} onChange={(v) => updateSpecific("glove_hand", v)}
                placeholder="Select hand..." disabled={saving} />
            </FieldRow>
            <FieldRow label="Palm Material">
              <SimpleSelect options={PALM_MATERIALS} value={s.palm_material} onChange={(v) => updateSpecific("palm_material", v)}
                placeholder="Select material..." disabled={saving} />
            </FieldRow>
            <FieldRow label="Webbing Type">
              <SimpleSelect options={WK_WEBBING_TYPES} value={s.webbing_type} onChange={(v) => updateSpecific("webbing_type", v)}
                placeholder="Select webbing..." disabled={saving} />
            </FieldRow>
          </Section>
        )
      }

      // ── Inner Gloves ──────────────────────────────────────────────────────
      case EquipmentType.InnerGloves: {
        const s = sp as InnerGlovesAttributes
        return (
          <Section title="Inner Gloves Attributes">
            <FieldRow label="Hand">
              <SimpleSelect options={HAND_OPTIONS} value={s.glove_hand} onChange={(v) => updateSpecific("glove_hand", v)}
                placeholder="Select hand..." disabled={saving} />
            </FieldRow>
            <FieldRow label="Material">
              <Input placeholder="e.g. Cotton, Lycra" value={s.material}
                onChange={(e) => updateSpecific("material", e.target.value)} disabled={saving} />
            </FieldRow>
          </Section>
        )
      }

      // ── Batting Pads ──────────────────────────────────────────────────────
      case EquipmentType.BattingPads: {
        const s = sp as BattingPadsAttributes
        return (
          <Section title="Batting Pads Attributes">
            <FieldRow label="Side">
              <SimpleSelect options={["Left", "Right", "Pair"]} value={s.pad_side}
                onChange={(v) => updateSpecific("pad_side", v)} placeholder="Select side..." disabled={saving} />
            </FieldRow>
            <FieldRow label="Pad Material">
              <SimpleSelect options={PAD_MATERIALS} value={s.pad_material} onChange={(v) => updateSpecific("pad_material", v)}
                placeholder="Select material..." disabled={saving} />
            </FieldRow>
            <FieldRow label="Knee Roll">
              <SimpleSelect options={KNEE_ROLL_TYPES} value={s.knee_roll} onChange={(v) => updateSpecific("knee_roll", v)}
                placeholder="Select knee roll..." disabled={saving} />
            </FieldRow>
            <FieldRow label="Straps">
              <SimpleSelect options={STRAP_COUNTS} value={s.straps_count} onChange={(v) => updateSpecific("straps_count", v)}
                placeholder="Select straps..." disabled={saving} />
            </FieldRow>
            <SwitchRow label="Shin Guard Included" checked={s.shin_guard_included}
              onChange={(v) => updateSpecific("shin_guard_included", v)} disabled={saving} />
          </Section>
        )
      }

      // ── WK Pads ───────────────────────────────────────────────────────────
      case EquipmentType.WicketKeepingPads: {
        const s = sp as WicketKeepingPadsAttributes
        return (
          <Section title="Wicket Keeping Pads Attributes">
            <FieldRow label="Side">
              <SimpleSelect options={["Left", "Right", "Pair"]} value={s.pad_side}
                onChange={(v) => updateSpecific("pad_side", v)} placeholder="Select side..." disabled={saving} />
            </FieldRow>
            <FieldRow label="Pad Style">
              <SimpleSelect options={WK_PAD_STYLES} value={s.pad_style} onChange={(v) => updateSpecific("pad_style", v)}
                placeholder="Select style..." disabled={saving} />
            </FieldRow>
            <FieldRow label="Straps">
              <SimpleSelect options={STRAP_COUNTS} value={s.straps_count} onChange={(v) => updateSpecific("straps_count", v)}
                placeholder="Select straps..." disabled={saving} />
            </FieldRow>
          </Section>
        )
      }

      // ── Helmet ────────────────────────────────────────────────────────────
      case EquipmentType.Helmet: {
        const s = sp as HelmetAttributes
        return (
          <Section title="Helmet Attributes">
            <FieldRow label="Standard">
              <SimpleSelect options={HELMET_STANDARDS} value={s.helmet_standard}
                onChange={(v) => updateSpecific("helmet_standard", v)} placeholder="Select standard..." disabled={saving} />
            </FieldRow>
            <FieldRow label="Grill Type">
              <SimpleSelect options={GRILL_TYPES} value={s.grill_type} onChange={(v) => updateSpecific("grill_type", v)}
                placeholder="Select grill..." disabled={saving} />
            </FieldRow>
            <FieldRow label="Peak Type">
              <SimpleSelect options={PEAK_TYPES} value={s.peak_type} onChange={(v) => updateSpecific("peak_type", v)}
                placeholder="Select peak..." disabled={saving} />
            </FieldRow>
            <SwitchRow label="Size Adjustable" checked={s.size_adjustable}
              onChange={(v) => updateSpecific("size_adjustable", v)} disabled={saving} />
          </Section>
        )
      }

      // ── Body Protection (Abdominal / Thigh / Arm / Chest) ─────────────────
      case EquipmentType.AbdominalGuard:
      case EquipmentType.ThighGuard:
      case EquipmentType.ArmGuard:
      case EquipmentType.ChestGuard: {
        const s = sp as BodyProtectionAttributes
        return (
          <Section title="Body Protection Attributes">
            <FieldRow label="Guard Type">
              <SimpleSelect options={["Abdominal", "Thigh", "Arm", "Chest", "Rib"]} value={s.guard_type}
                onChange={(v) => updateSpecific("guard_type", v)} placeholder="Select guard type..." disabled={saving} />
            </FieldRow>
            <FieldRow label="Material">
              <SimpleSelect options={BODY_GUARD_MATERIALS} value={s.material} onChange={(v) => updateSpecific("material", v)}
                placeholder="Select material..." disabled={saving} />
            </FieldRow>
            <FieldRow label="Gender">
              <SimpleSelect options={GENDER_OPTIONS} value={s.gender} onChange={(v) => updateSpecific("gender", v)}
                placeholder="Select gender..." disabled={saving} />
            </FieldRow>
          </Section>
        )
      }

      // ── Bat Accessory ─────────────────────────────────────────────────────
      case EquipmentType.BatAccessory: {
        const s = sp as BatAccessoryAttributes
        return (
          <Section title="Bat Accessory Attributes">
            <FieldRow label="Accessory Type">
              <SimpleSelect options={BAT_ACCESSORY_TYPES} value={s.accessory_type}
                onChange={(v) => updateSpecific("accessory_type", v)} placeholder="Select type..." disabled={saving} />
            </FieldRow>
            <FieldRow label="Compatible Bat Sizes">
              <MultiCheckbox options={BAT_SIZES} values={s.compatible_bat_size}
                onChange={(v) => updateSpecific("compatible_bat_size", v)} disabled={saving} />
            </FieldRow>
            <FieldRow label="Material">
              <Input placeholder="e.g. Natural Rubber, PU" value={s.material}
                onChange={(e) => updateSpecific("material", e.target.value)} disabled={saving} />
            </FieldRow>
          </Section>
        )
      }

      // ── Footwear (shared) ─────────────────────────────────────────────────
      case EquipmentType.Footwear: {
        const s = sp as FootwearAttributes
        return (
          <Section title="Footwear Attributes">
            <FieldRow label="Sole Type">
              <SimpleSelect options={SOLE_TYPES} value={s.sole_type} onChange={(v) => updateSpecific("sole_type", v)}
                placeholder="Select sole..." disabled={saving} />
            </FieldRow>
            <FieldRow label="Upper Material">
              <SimpleSelect options={UPPER_MATERIALS} value={s.upper_material} onChange={(v) => updateSpecific("upper_material", v)}
                placeholder="Select material..." disabled={saving} />
            </FieldRow>
            <FieldRow label="Surface Type">
              <MultiCheckbox options={SHOE_SURFACES} values={s.surface_type}
                onChange={(v) => updateSpecific("surface_type", v)} disabled={saving} />
            </FieldRow>
            <FieldRow label="Closure Type">
              <SimpleSelect options={CLOSURE_TYPES} value={s.closure_type} onChange={(v) => updateSpecific("closure_type", v)}
                placeholder="Select closure..." disabled={saving} />
            </FieldRow>
          </Section>
        )
      }

      // ── Clothing (shared) ─────────────────────────────────────────────────
      case EquipmentType.Clothing: {
        const s = sp as ClothingAttributes
        return (
          <Section title="Clothing Attributes">
            <FieldRow label="Garment Type">
              <SimpleSelect options={GARMENT_TYPES} value={s.garment_type} onChange={(v) => updateSpecific("garment_type", v)}
                placeholder="Select garment..." disabled={saving} />
            </FieldRow>
            <FieldRow label="Fabric">
              <SimpleSelect options={FABRIC_TYPES} value={s.fabric} onChange={(v) => updateSpecific("fabric", v)}
                placeholder="Select fabric..." disabled={saving} />
            </FieldRow>
            <FieldRow label="Fit">
              <SimpleSelect options={FIT_TYPES} value={s.fit_type} onChange={(v) => updateSpecific("fit_type", v)}
                placeholder="Select fit..." disabled={saving} />
            </FieldRow>
            <FieldRow label="Gender">
              <SimpleSelect options={GENDER_OPTIONS} value={s.gender} onChange={(v) => updateSpecific("gender", v)}
                placeholder="Select gender..." disabled={saving} />
            </FieldRow>
            <FieldRow label="Season">
              <SimpleSelect options={SEASONS} value={s.season} onChange={(v) => updateSpecific("season", v)}
                placeholder="Select season..." disabled={saving} />
            </FieldRow>
            <FieldRow label="Color">
              <Input placeholder="e.g. White, Royal Blue / Gold" value={s.color}
                onChange={(e) => updateSpecific("color", e.target.value)} disabled={saving} />
            </FieldRow>
          </Section>
        )
      }

      // ── Bag (shared) ──────────────────────────────────────────────────────
      case EquipmentType.Bag: {
        const s = sp as BagAttributes
        return (
          <Section title="Bag Attributes">
            <FieldRow label="Bag Type">
              <SimpleSelect options={BAG_TYPES} value={s.bag_type} onChange={(v) => updateSpecific("bag_type", v)}
                placeholder="Select type..." disabled={saving} />
            </FieldRow>
            <FieldRow label="Material">
              <SimpleSelect options={BAG_MATERIALS} value={s.bag_material} onChange={(v) => updateSpecific("bag_material", v)}
                placeholder="Select material..." disabled={saving} />
            </FieldRow>
            <FieldRow label="Capacity">
              <Input placeholder="e.g. 65L" value={s.capacity}
                onChange={(e) => updateSpecific("capacity", e.target.value)} disabled={saving} />
            </FieldRow>
            <SwitchRow label="Wheels" checked={s.wheels} onChange={(v) => updateSpecific("wheels", v)} disabled={saving} />
            <SwitchRow label="Waterproof" checked={s.waterproof} onChange={(v) => updateSpecific("waterproof", v)} disabled={saving} />
          </Section>
        )
      }

      // ── Training Equipment (shared) ───────────────────────────────────────
      case EquipmentType.TrainingEquipment: {
        const s = sp as TrainingEquipmentAttributes
        return (
          <Section title="Training Equipment Attributes">
            <FieldRow label="Equipment Type">
              <SimpleSelect options={TRAINING_EQUIPMENT_TYPES} value={s.training_type}
                onChange={(v) => updateSpecific("training_type", v)} placeholder="Select type..." disabled={saving} />
            </FieldRow>
            <FieldRow label="Material">
              <SimpleSelect options={TRAINING_MATERIALS} value={s.material} onChange={(v) => updateSpecific("material", v)}
                placeholder="Select material..." disabled={saving} />
            </FieldRow>
            <FieldRow label="Surface Compatibility">
              <MultiCheckbox options={PLAYING_SURFACES} values={s.surface_compatibility}
                onChange={(v) => updateSpecific("surface_compatibility", v)} disabled={saving} />
            </FieldRow>
            <SwitchRow label="Portable" checked={s.portable} onChange={(v) => updateSpecific("portable", v)} disabled={saving} />
          </Section>
        )
      }

      // ── Football Ball ─────────────────────────────────────────────────────
      case EquipmentType.FootballBall: {
        const s = sp as FootballBallAttributes
        return (
          <Section title="Football Attributes">
            <FieldRow label="Size">
              <SimpleSelect options={FOOTBALL_BALL_SIZES} value={s.ball_size}
                onChange={(v) => updateSpecific("ball_size", v)} placeholder="Select size..." disabled={saving} />
            </FieldRow>
            <FieldRow label="Type">
              <SimpleSelect options={FOOTBALL_BALL_TYPES} value={s.ball_type}
                onChange={(v) => updateSpecific("ball_type", v)} placeholder="Select type..." disabled={saving} />
            </FieldRow>
            <FieldRow label="Panel Construction">
              <SimpleSelect options={FOOTBALL_PANEL_TYPES} value={s.panel_type}
                onChange={(v) => updateSpecific("panel_type", v)} placeholder="Select panel..." disabled={saving} />
            </FieldRow>
            <FieldRow label="Material">
              <SimpleSelect options={FOOTBALL_BALL_MATERIALS} value={s.material}
                onChange={(v) => updateSpecific("material", v)} placeholder="Select material..." disabled={saving} />
            </FieldRow>
            <FieldRow label="Bladder">
              <SimpleSelect options={BLADDER_TYPES} value={s.bladder_type}
                onChange={(v) => updateSpecific("bladder_type", v)} placeholder="Select bladder..." disabled={saving} />
            </FieldRow>
            <SwitchRow label="FIFA Approved" checked={s.fifa_approved}
              onChange={(v) => updateSpecific("fifa_approved", v)} disabled={saving} />
          </Section>
        )
      }

      // ── Football Boots ────────────────────────────────────────────────────
      case EquipmentType.FootballBoots: {
        const s = sp as FootballBootsAttributes
        return (
          <Section title="Football Boots Attributes">
            <FieldRow label="Stud Type">
              <SimpleSelect options={STUD_TYPES} value={s.stud_type}
                onChange={(v) => updateSpecific("stud_type", v)} placeholder="Select stud type..." disabled={saving} />
            </FieldRow>
            <FieldRow label="Upper Material">
              <SimpleSelect options={UPPER_MATERIALS} value={s.upper_material}
                onChange={(v) => updateSpecific("upper_material", v)} placeholder="Select material..." disabled={saving} />
            </FieldRow>
            <FieldRow label="Closure Type">
              <SimpleSelect options={CLOSURE_TYPES} value={s.closure_type}
                onChange={(v) => updateSpecific("closure_type", v)} placeholder="Select closure..." disabled={saving} />
            </FieldRow>
          </Section>
        )
      }

      // ── Football Shin Guards ──────────────────────────────────────────────
      case EquipmentType.FootballShinGuards: {
        const s = sp as FootballShinGuardsAttributes
        return (
          <Section title="Shin Guard Attributes">
            <FieldRow label="Guard Type">
              <SimpleSelect options={SHIN_GUARD_TYPES} value={s.guard_type}
                onChange={(v) => updateSpecific("guard_type", v)} placeholder="Select type..." disabled={saving} />
            </FieldRow>
            <FieldRow label="Material">
              <SimpleSelect options={SHIN_GUARD_MATERIALS} value={s.material}
                onChange={(v) => updateSpecific("material", v)} placeholder="Select material..." disabled={saving} />
            </FieldRow>
            <FieldRow label="Gender">
              <SimpleSelect options={GENDER_OPTIONS} value={s.gender}
                onChange={(v) => updateSpecific("gender", v)} placeholder="Select gender..." disabled={saving} />
            </FieldRow>
          </Section>
        )
      }

      // ── Goalkeeper Gloves ─────────────────────────────────────────────────
      case EquipmentType.GoalkeeperGloves: {
        const s = sp as GoalkeeperGlovesAttributes
        return (
          <Section title="Goalkeeper Gloves Attributes">
            <FieldRow label="Cut Type">
              <SimpleSelect options={GK_GLOVE_CUT_TYPES} value={s.cut_type}
                onChange={(v) => updateSpecific("cut_type", v)} placeholder="Select cut..." disabled={saving} />
            </FieldRow>
            <FieldRow label="Palm Material">
              <SimpleSelect options={GK_GLOVE_PALM_MATERIALS} value={s.palm_material}
                onChange={(v) => updateSpecific("palm_material", v)} placeholder="Select material..." disabled={saving} />
            </FieldRow>
            <FieldRow label="Backhand">
              <Input placeholder="e.g. 3mm German Latex" value={s.backhand}
                onChange={(e) => updateSpecific("backhand", e.target.value)} disabled={saving} />
            </FieldRow>
          </Section>
        )
      }

      // ── Basketball Ball ───────────────────────────────────────────────────
      case EquipmentType.BasketballBall: {
        const s = sp as BasketballBallAttributes
        return (
          <Section title="Basketball Attributes">
            <FieldRow label="Size">
              <SimpleSelect options={BASKETBALL_SIZES} value={s.ball_size}
                onChange={(v) => updateSpecific("ball_size", v)} placeholder="Select size..." disabled={saving} />
            </FieldRow>
            <FieldRow label="Type">
              <SimpleSelect options={BASKETBALL_BALL_TYPES} value={s.ball_type}
                onChange={(v) => updateSpecific("ball_type", v)} placeholder="Select type..." disabled={saving} />
            </FieldRow>
            <FieldRow label="Material">
              <SimpleSelect options={BASKETBALL_BALL_MATERIALS} value={s.material}
                onChange={(v) => updateSpecific("material", v)} placeholder="Select material..." disabled={saving} />
            </FieldRow>
            <SwitchRow label="NBA Approved" checked={s.nba_approved}
              onChange={(v) => updateSpecific("nba_approved", v)} disabled={saving} />
          </Section>
        )
      }

      // ── Basketball Shoes ──────────────────────────────────────────────────
      case EquipmentType.BasketballShoes: {
        const s = sp as BasketballShoesAttributes
        return (
          <Section title="Basketball Shoes Attributes">
            <FieldRow label="Cut">
              <SimpleSelect options={BASKETBALL_SHOE_CUTS} value={s.cut_type}
                onChange={(v) => updateSpecific("cut_type", v)} placeholder="Select cut..." disabled={saving} />
            </FieldRow>
            <FieldRow label="Surface Type">
              <MultiCheckbox options={["Indoor", "Outdoor", "All-Court"]} values={s.surface_type}
                onChange={(v) => updateSpecific("surface_type", v)} disabled={saving} />
            </FieldRow>
            <FieldRow label="Cushioning">
              <SimpleSelect options={BASKETBALL_CUSHIONING_TYPES} value={s.cushioning}
                onChange={(v) => updateSpecific("cushioning", v)} placeholder="Select cushioning..." disabled={saving} />
            </FieldRow>
            <FieldRow label="Closure Type">
              <SimpleSelect options={CLOSURE_TYPES} value={s.closure_type}
                onChange={(v) => updateSpecific("closure_type", v)} placeholder="Select closure..." disabled={saving} />
            </FieldRow>
          </Section>
        )
      }

      // ── Volleyball Ball ───────────────────────────────────────────────────
      case EquipmentType.VolleyballBall: {
        const s = sp as VolleyballBallAttributes
        return (
          <Section title="Volleyball Attributes">
            <FieldRow label="Type">
              <SimpleSelect options={VOLLEYBALL_BALL_TYPES} value={s.ball_type}
                onChange={(v) => updateSpecific("ball_type", v)} placeholder="Select type..." disabled={saving} />
            </FieldRow>
            <FieldRow label="Panel Count">
              <SimpleSelect options={VOLLEYBALL_PANEL_COUNTS} value={s.panel_count}
                onChange={(v) => updateSpecific("panel_count", v)} placeholder="Select panels..." disabled={saving} />
            </FieldRow>
            <FieldRow label="Material">
              <SimpleSelect options={VOLLEYBALL_BALL_MATERIALS} value={s.material}
                onChange={(v) => updateSpecific("material", v)} placeholder="Select material..." disabled={saving} />
            </FieldRow>
            <SwitchRow label="FIVB Approved" checked={s.fivb_approved}
              onChange={(v) => updateSpecific("fivb_approved", v)} disabled={saving} />
          </Section>
        )
      }

      // ── Volleyball Shoes ──────────────────────────────────────────────────
      case EquipmentType.VolleyballShoes: {
        const s = sp as VolleyballShoesAttributes
        return (
          <Section title="Volleyball Shoes Attributes">
            <FieldRow label="Cut">
              <SimpleSelect options={VOLLEYBALL_SHOE_CUTS} value={s.cut_type}
                onChange={(v) => updateSpecific("cut_type", v)} placeholder="Select cut..." disabled={saving} />
            </FieldRow>
            <FieldRow label="Surface Type">
              <MultiCheckbox options={["Indoor", "Outdoor", "Beach"]} values={s.surface_type}
                onChange={(v) => updateSpecific("surface_type", v)} disabled={saving} />
            </FieldRow>
            <FieldRow label="Cushioning">
              <SimpleSelect options={VOLLEYBALL_CUSHIONING_TYPES} value={s.cushioning}
                onChange={(v) => updateSpecific("cushioning", v)} placeholder="Select cushioning..." disabled={saving} />
            </FieldRow>
          </Section>
        )
      }

      // ── Volleyball Knee Pads ──────────────────────────────────────────────
      case EquipmentType.VolleyballKneePads: {
        const s = sp as VolleyballKneePadsAttributes
        return (
          <Section title="Volleyball Knee Pads Attributes">
            <FieldRow label="Material">
              <Input placeholder="e.g. EVA Foam, Neoprene" value={s.material}
                onChange={(e) => updateSpecific("material", e.target.value)} disabled={saving} />
            </FieldRow>
            <FieldRow label="Thickness">
              <Input placeholder="e.g. 10mm, 15mm" value={s.thickness}
                onChange={(e) => updateSpecific("thickness", e.target.value)} disabled={saving} />
            </FieldRow>
            <FieldRow label="Gender">
              <SimpleSelect options={GENDER_OPTIONS} value={s.gender}
                onChange={(v) => updateSpecific("gender", v)} placeholder="Select gender..." disabled={saving} />
            </FieldRow>
          </Section>
        )
      }

      default:
        return null
    }
  }

  return (
    <Container>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
        <Heading level="h2">Sports Attributes</Heading>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          {saved && <Badge color="green">Saved</Badge>}
          {isDirty && !saved && <Badge color="orange">Unsaved changes</Badge>}
          <Button size="small" isLoading={saving} disabled={!isDirty || saving} onClick={handleSave}>Save</Button>
        </div>
      </div>

      {fetchError && (
        <div style={{ marginBottom: "16px", display: "flex", alignItems: "center", gap: "12px" }}>
          <Text className="text-red-500">{fetchError}</Text>
          <Button size="small" variant="secondary" onClick={fetchData} disabled={loading}>Retry</Button>
        </div>
      )}
      {saveError && (
        <div style={{ marginBottom: "16px" }}>
          <Text className="text-red-500">{saveError} — click Save to try again.</Text>
        </div>
      )}

      {loading ? renderSkeleton() : (
        <div style={{ display: "flex", flexDirection: "column", gap: "28px" }}>

          {/* Sport + Equipment Type */}
          <div style={gridStyle}>
            <FieldRow label="Sport">
              <Select value={attrs.sport} onValueChange={handleSportChange} disabled={saving}>
                <Select.Trigger>
                  <Select.Value placeholder="Select sport..." />
                </Select.Trigger>
                <Select.Content>
                  {Object.values(Sport).map((s) => (
                    <Select.Item key={s} value={s}>{s}</Select.Item>
                  ))}
                </Select.Content>
              </Select>
            </FieldRow>
            <FieldRow label="Equipment Type">
              <Select value={et} onValueChange={handleEquipmentTypeChange} disabled={saving}>
                <Select.Trigger>
                  <Select.Value placeholder="Select type..." />
                </Select.Trigger>
                <Select.Content>
                  {validTypes.map((t) => (
                    <Select.Item key={t} value={t}>{t}</Select.Item>
                  ))}
                </Select.Content>
              </Select>
            </FieldRow>
          </div>

          {/* Common Attributes */}
          <div>
            <Heading level="h3" style={{ marginBottom: "14px" }}>Common Attributes</Heading>
            <div style={gridStyle}>
              <FieldRow label="Skill Level">
                <MultiCheckbox options={SKILL_LEVELS} values={attrs.common.skill_level}
                  onChange={(v) => updateCommon("skill_level", v)} disabled={saving} />
              </FieldRow>
              <FieldRow label="Age Group">
                <MultiCheckbox options={AGE_GROUPS} values={attrs.common.age_group}
                  onChange={(v) => updateCommon("age_group", v)} disabled={saving} />
              </FieldRow>
              <FieldRow label="Activity Intensity">
                <MultiCheckbox options={ACTIVITY_INTENSITIES} values={attrs.common.activity_intensity}
                  onChange={(v) => updateCommon("activity_intensity", v)} disabled={saving} />
              </FieldRow>
              <FieldRow label="Best For">
                <MultiCheckbox options={BEST_FOR_OPTIONS} values={attrs.common.best_for}
                  onChange={(v) => updateCommon("best_for", v)} disabled={saving} />
              </FieldRow>
              <FieldRow label="Playing Surface">
                <MultiCheckbox options={PLAYING_SURFACES} values={attrs.common.playing_surface}
                  onChange={(v) => updateCommon("playing_surface", v)} disabled={saving} />
              </FieldRow>
              <FieldRow label="Protection Level">
                <SimpleSelect options={PROTECTION_LEVELS} value={attrs.common.protection_level}
                  onChange={(v) => updateCommon("protection_level", v)} placeholder="Select level..."
                  disabled={saving} error={fieldErrors["common.protection_level"]} />
              </FieldRow>
              <FieldRow label="Certification">
                <Input placeholder="e.g. MRF Approved, SG Certified" value={attrs.common.certification}
                  onChange={(e) => updateCommon("certification", e.target.value)} disabled={saving} />
              </FieldRow>
              <FieldRow label="In-Box Includes">
                <Input placeholder="e.g. Ball, Kit Bag, Instruction Booklet" value={attrs.common.in_box_includes}
                  onChange={(e) => updateCommon("in_box_includes", e.target.value)} disabled={saving} />
              </FieldRow>
              <SwitchRow label="Customization Available" checked={attrs.common.customization_available}
                onChange={(v) => updateCommon("customization_available", v)} disabled={saving} />
            </div>
          </div>

          {/* Equipment-type-specific section */}
          {renderSpecificSection()}

        </div>
      )}
    </Container>
  )
}

// ── Section helper ────────────────────────────────────────────────────────────
const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <div>
    <Heading level="h3" style={{ marginBottom: "14px" }}>{title}</Heading>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px 24px" }}>
      {children}
    </div>
  </div>
)

// ── Default export ────────────────────────────────────────────────────────────
const ProductSportsAttributesWidget = (props: DetailWidgetProps<{ id: string }>) => (
  <ErrorBoundary>
    <SportsAttributesWidget {...props} />
  </ErrorBoundary>
)

export const config = defineWidgetConfig({
  zone: "product.details.after",
})

export default ProductSportsAttributesWidget
