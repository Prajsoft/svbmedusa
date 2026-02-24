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
  BEST_FOR_OPTIONS,
  DEFAULT_SPORTS_ATTRIBUTES,
  EQUIPMENT_TYPES,
  EquipmentType,
  PLAYING_SURFACES,
  PROTECTION_LEVELS,
  SEAM_TYPES,
  SKILL_LEVELS,
  Sport,
  type BallAttributes,
  type SportsAttributes,
} from "../../types/sports-attributes"

// ── Module-level constants ────────────────────────────────────────────────────
const BALL_COLORS_SET = new Set<string>(BALL_COLORS)

// ── Error Boundary ────────────────────────────────────────────────────────────
interface EBProps {
  children?: ReactNode
}

interface EBState {
  hasError: boolean
}

class ErrorBoundary extends Component<EBProps, EBState> {
  constructor(props: EBProps) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(_error: Error): EBState {
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
const isKnownOption = (value: string, options: readonly string[]): boolean => {
  return options.includes(value)
}

// ── MultiCheckbox ─────────────────────────────────────────────────────────────
// Checkbox list for multi-select fields.
interface MultiCheckboxProps {
  options: readonly string[]
  values: string[]
  onChange: (values: string[]) => void
  disabled: boolean
}

const MultiCheckbox = ({ options, values, onChange, disabled }: MultiCheckboxProps) => {
  return (
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
              style={{
                width: "16px",
                height: "16px",
                cursor: disabled ? "not-allowed" : "pointer",
                accentColor: "#7c3aed",
                flexShrink: 0,
              }}
            />
            <label
              htmlFor={id}
              style={{
                fontSize: "14px",
                cursor: disabled ? "not-allowed" : "pointer",
                opacity: disabled ? 0.6 : 1,
                userSelect: "none",
              }}
            >
              {opt}
            </label>
          </div>
        )
      })}
    </div>
  )
}

// ── ColorChips ────────────────────────────────────────────────────────────────
// Multi-select chips for ball_color with "Other (specify)" support.
interface ColorChipsProps {
  values: string[]
  onChange: (values: string[]) => void
  disabled: boolean
}

const ColorChips = ({ values, onChange, disabled }: ColorChipsProps) => {
  const customColors = values.filter((v) => !BALL_COLORS_SET.has(v))
  const [otherActive, setOtherActive] = useState(customColors.length > 0)
  const [otherText, setOtherText] = useState(customColors.join(", "))

  const toggleKnown = (color: string) => {
    onChange(
      values.includes(color)
        ? values.filter((v) => v !== color)
        : [...values, color]
    )
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
    const custom = text
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
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
              <input
                id={id}
                type="checkbox"
                checked={checked}
                disabled={disabled}
                onChange={() => toggleKnown(color)}
                style={{
                  width: "16px",
                  height: "16px",
                  cursor: disabled ? "not-allowed" : "pointer",
                  accentColor: "#7c3aed",
                  flexShrink: 0,
                }}
              />
              <label
                htmlFor={id}
                style={{
                  fontSize: "14px",
                  cursor: disabled ? "not-allowed" : "pointer",
                  opacity: disabled ? 0.6 : 1,
                  userSelect: "none",
                }}
              >
                {color}
              </label>
            </div>
          )
        })}
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <input
            id="bc-other"
            type="checkbox"
            checked={otherActive}
            disabled={disabled}
            onChange={toggleOther}
            style={{
              width: "16px",
              height: "16px",
              cursor: disabled ? "not-allowed" : "pointer",
              accentColor: "#7c3aed",
              flexShrink: 0,
            }}
          />
          <label
            htmlFor="bc-other"
            style={{
              fontSize: "14px",
              cursor: disabled ? "not-allowed" : "pointer",
              opacity: disabled ? 0.6 : 1,
              userSelect: "none",
            }}
          >
            Other
          </label>
        </div>
      </div>
      {otherActive && (
        <Input
          placeholder="Custom colour(s), comma-separated"
          value={otherText}
          onChange={(e) => applyOtherText(e.target.value)}
          disabled={disabled}
        />
      )}
    </div>
  )
}

// ── SelectWithOther ───────────────────────────────────────────────────────────
// Dropdown with an "Other (specify)" option that reveals a text input.
interface SelectWithOtherProps {
  options: readonly string[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled: boolean
  error?: string
}

const SelectWithOther = ({
  options,
  value,
  onChange,
  placeholder,
  disabled,
  error,
}: SelectWithOtherProps) => {
  const known = value === "" || isKnownOption(value, options)
  const displayValue = known ? value : "other"
  const [otherText, setOtherText] = useState(known ? "" : value)
  // Track whether "other" mode is active locally, so the text input stays
  // visible even when the parent value is still "" (user picked "other" but
  // hasn't typed yet).
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

  const handleText = (text: string) => {
    setOtherText(text)
    onChange(text)
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      <Select value={displayValue} onValueChange={handleSelect} disabled={disabled}>
        <Select.Trigger>
          <Select.Value placeholder={placeholder ?? "Select..."} />
        </Select.Trigger>
        <Select.Content>
          {options.map((opt) => (
            <Select.Item key={opt} value={opt}>
              {opt}
            </Select.Item>
          ))}
          <Select.Item value="other">Other (specify)</Select.Item>
        </Select.Content>
      </Select>
      {(isOtherMode || displayValue === "other") && (
        <Input
          placeholder="Specify..."
          value={otherText}
          onChange={(e) => handleText(e.target.value)}
          disabled={disabled}
        />
      )}
      {error && (
        <Text size="small" className="text-red-500">
          {error}
        </Text>
      )}
    </div>
  )
}

// ── SimpleSelect ──────────────────────────────────────────────────────────────
// Plain dropdown without an "Other" option.
interface SimpleSelectProps {
  options: readonly string[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled: boolean
  error?: string
}

const SimpleSelect = ({
  options,
  value,
  onChange,
  placeholder,
  disabled,
  error,
}: SimpleSelectProps) => {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <Select.Trigger>
          <Select.Value placeholder={placeholder ?? "Select..."} />
        </Select.Trigger>
        <Select.Content>
          {options.map((opt) => (
            <Select.Item key={opt} value={opt}>
              {opt}
            </Select.Item>
          ))}
        </Select.Content>
      </Select>
      {error && (
        <Text size="small" className="text-red-500">
          {error}
        </Text>
      )}
    </div>
  )
}

// ── FieldRow ──────────────────────────────────────────────────────────────────
interface FieldRowProps {
  label: string
  children: ReactNode
}

const FieldRow = ({ label, children }: FieldRowProps) => {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      <Text size="small" weight="plus">
        {label}
      </Text>
      {children}
    </div>
  )
}

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
  // Incrementing counter lets us cancel stale fetch responses on retry or unmount.
  const fetchIdRef = useRef(0)

  // ── Fetch (callable for both initial load and retry) ────────────────────────
  const fetchData = useCallback(async () => {
    const fetchId = ++fetchIdRef.current
    setLoading(true)
    setFetchError(null)
    try {
      const res = await fetch(
        `/admin/products/${productId}/sports-attributes`,
        { credentials: "include" }
      )
      if (fetchId !== fetchIdRef.current) return // superseded by a newer call
      if (!res.ok) {
        setFetchError(`Failed to load sports attributes (HTTP ${res.status}).`)
        return
      }
      const body = (await res.json()) as { sports_attributes: SportsAttributes | null }
      if (fetchId !== fetchIdRef.current) return
      const loaded = body.sports_attributes ?? DEFAULT_SPORTS_ATTRIBUTES
      setAttrs(loaded)
      setSavedAttrs(loaded)
    } catch (err) {
      if (fetchId !== fetchIdRef.current) return
      setFetchError(
        err instanceof Error ? err.message : "Failed to load sports attributes."
      )
    } finally {
      if (fetchId === fetchIdRef.current) {
        setLoading(false)
      }
    }
  }, [productId])

  // ── Initial fetch ───────────────────────────────────────────────────────────
  useEffect(() => {
    fetchData()
    return () => {
      // Mark any in-flight fetch as stale when the component unmounts or
      // productId changes, so it cannot call setState after teardown.
      fetchIdRef.current++
    }
  }, [fetchData])

  // ── Cleanup saved timer ─────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (savedTimerRef.current !== null) {
        window.clearTimeout(savedTimerRef.current)
      }
    }
  }, [])

  const isDirty = JSON.stringify(attrs) !== JSON.stringify(savedAttrs)

  // ── Update helpers ──────────────────────────────────────────────────────────
  const updateCommon = useCallback(
    <K extends keyof SportsAttributes["common"]>(
      field: K,
      value: SportsAttributes["common"][K]
    ) => {
      setAttrs((prev) => ({
        ...prev,
        common: { ...prev.common, [field]: value },
      }))
    },
    []
  )

  const updateBall = useCallback(
    <K extends keyof BallAttributes>(field: K, value: BallAttributes[K]) => {
      setAttrs((prev) => ({
        ...prev,
        sport_specific: { ...prev.sport_specific, [field]: value },
      }))
    },
    []
  )

  const handleEquipmentTypeChange = useCallback((newType: string) => {
    setAttrs((prev) => ({
      ...prev,
      sport_specific:
        newType === EquipmentType.Ball
          ? {
              equipment_type: EquipmentType.Ball,
              ball_type: "",
              ball_grade: [],
              seam_type: "",
              ball_color: [],
              ball_size: "",
              overs_durability: "",
            }
          : { equipment_type: newType as EquipmentType },
    }))
  }, [])

  // ── Save ────────────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    setSaving(true)
    setSaveError(null)
    setFieldErrors({})
    try {
      const res = await fetch(
        `/admin/products/${productId}/sports-attributes`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(attrs),
        }
      )
      const body = (await res.json()) as {
        success?: boolean
        error?: string
        details?: Record<string, string>
      }
      if (!res.ok) {
        if (body.details && typeof body.details === "object") {
          setFieldErrors(body.details)
        }
        setSaveError(body.error ?? `Save failed (HTTP ${res.status}).`)
        return
      }
      setSavedAttrs(attrs)
      setSaved(true)
      if (savedTimerRef.current !== null) {
        window.clearTimeout(savedTimerRef.current)
      }
      savedTimerRef.current = window.setTimeout(() => {
        setSaved(false)
      }, 3000)
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : "Failed to save sports attributes."
      )
    } finally {
      setSaving(false)
    }
  }, [productId, attrs])

  // ── Loading skeleton ────────────────────────────────────────────────────────
  const renderSkeleton = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <Skeleton key={i} style={{ height: "36px", borderRadius: "6px" }} />
      ))}
    </div>
  )

  // ── Two-column grid style ───────────────────────────────────────────────────
  const gridStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "16px 24px",
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <Container>
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "20px",
        }}
      >
        <Heading level="h2">Sports Attributes</Heading>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          {saved && <Badge color="green">Saved</Badge>}
          {isDirty && !saved && <Badge color="orange">Unsaved changes</Badge>}
          <Button
            size="small"
            isLoading={saving}
            disabled={!isDirty || saving}
            onClick={handleSave}
          >
            Save
          </Button>
        </div>
      </div>

      {/* Global errors */}
      {fetchError && (
        <div style={{ marginBottom: "16px", display: "flex", alignItems: "center", gap: "12px" }}>
          <Text className="text-red-500">{fetchError}</Text>
          <Button
            size="small"
            variant="secondary"
            onClick={fetchData}
            disabled={loading}
          >
            Retry
          </Button>
        </div>
      )}
      {saveError && (
        <div style={{ marginBottom: "16px" }}>
          <Text className="text-red-500">
            {saveError} — click Save to try again.
          </Text>
        </div>
      )}

      {loading ? (
        renderSkeleton()
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "28px" }}>

          {/* Sport / Equipment Type */}
          <div style={gridStyle}>
            <FieldRow label="Sport">
              <Badge color="blue">{Sport.Cricket}</Badge>
            </FieldRow>
            <FieldRow label="Equipment Type">
              <Select
                value={attrs.sport_specific.equipment_type}
                onValueChange={handleEquipmentTypeChange}
                disabled={saving}
              >
                <Select.Trigger>
                  <Select.Value placeholder="Select type..." />
                </Select.Trigger>
                <Select.Content>
                  {EQUIPMENT_TYPES.map((t) => (
                    <Select.Item key={t} value={t}>
                      {t}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select>
            </FieldRow>
          </div>

          {/* ── Common Attributes ────────────────────────────────────────── */}
          <div>
            <Heading level="h3" style={{ marginBottom: "14px" }}>
              Common Attributes
            </Heading>
            <div style={gridStyle}>

              <FieldRow label="Skill Level">
                <MultiCheckbox
                  options={SKILL_LEVELS}
                  values={attrs.common.skill_level}
                  onChange={(v) => updateCommon("skill_level", v)}
                  disabled={saving}
                />
              </FieldRow>

              <FieldRow label="Age Group">
                <MultiCheckbox
                  options={AGE_GROUPS}
                  values={attrs.common.age_group}
                  onChange={(v) => updateCommon("age_group", v)}
                  disabled={saving}
                />
              </FieldRow>

              <FieldRow label="Activity Intensity">
                <MultiCheckbox
                  options={ACTIVITY_INTENSITIES}
                  values={attrs.common.activity_intensity}
                  onChange={(v) => updateCommon("activity_intensity", v)}
                  disabled={saving}
                />
              </FieldRow>

              <FieldRow label="Best For">
                <MultiCheckbox
                  options={BEST_FOR_OPTIONS}
                  values={attrs.common.best_for}
                  onChange={(v) => updateCommon("best_for", v)}
                  disabled={saving}
                />
              </FieldRow>

              <FieldRow label="Playing Surface">
                <MultiCheckbox
                  options={PLAYING_SURFACES}
                  values={attrs.common.playing_surface}
                  onChange={(v) => updateCommon("playing_surface", v)}
                  disabled={saving}
                />
              </FieldRow>

              <FieldRow label="Protection Level">
                <SimpleSelect
                  options={PROTECTION_LEVELS}
                  value={attrs.common.protection_level}
                  onChange={(v) => updateCommon("protection_level", v)}
                  placeholder="Select level..."
                  disabled={saving}
                  error={fieldErrors["common.protection_level"]}
                />
              </FieldRow>

              <FieldRow label="Certification">
                <Input
                  placeholder="e.g. MRF Approved, SG Certified"
                  value={attrs.common.certification}
                  onChange={(e) => updateCommon("certification", e.target.value)}
                  disabled={saving}
                />
              </FieldRow>

              <FieldRow label="In-Box Includes">
                <Input
                  placeholder="e.g. Ball, Kit Bag, Instruction Booklet"
                  value={attrs.common.in_box_includes}
                  onChange={(e) => updateCommon("in_box_includes", e.target.value)}
                  disabled={saving}
                />
              </FieldRow>

              <FieldRow label="Customization Available">
                <div
                  style={{ display: "flex", alignItems: "center", gap: "10px", height: "36px" }}
                >
                  <Switch
                    checked={attrs.common.customization_available}
                    onCheckedChange={(v) => updateCommon("customization_available", v)}
                    disabled={saving}
                  />
                  <Text size="small">
                    {attrs.common.customization_available ? "Yes" : "No"}
                  </Text>
                </div>
              </FieldRow>

            </div>
          </div>

          {/* ── Ball Attributes (only when equipment type is Ball) ─────── */}
          {attrs.sport_specific.equipment_type === EquipmentType.Ball && (() => {
            const ball = attrs.sport_specific as BallAttributes
            return (
              <div>
                <Heading level="h3" style={{ marginBottom: "14px" }}>
                  Ball Attributes
                </Heading>
                <div style={gridStyle}>

                  <FieldRow label="Ball Type">
                    <SelectWithOther
                      options={BALL_TYPES}
                      value={ball.ball_type}
                      onChange={(v) => updateBall("ball_type", v)}
                      placeholder="Select type..."
                      disabled={saving}
                      error={fieldErrors["sport_specific.ball_type"]}
                    />
                  </FieldRow>

                  <FieldRow label="Ball Grade">
                    <MultiCheckbox
                      options={BALL_GRADES}
                      values={ball.ball_grade}
                      onChange={(v) => updateBall("ball_grade", v)}
                      disabled={saving}
                    />
                  </FieldRow>

                  <FieldRow label="Seam Type">
                    <SelectWithOther
                      options={SEAM_TYPES}
                      value={ball.seam_type}
                      onChange={(v) => updateBall("seam_type", v)}
                      placeholder="Select seam type..."
                      disabled={saving}
                      error={fieldErrors["sport_specific.seam_type"]}
                    />
                  </FieldRow>

                  <FieldRow label="Ball Size">
                    <SelectWithOther
                      options={BALL_SIZES}
                      value={ball.ball_size}
                      onChange={(v) => updateBall("ball_size", v)}
                      placeholder="Select size..."
                      disabled={saving}
                      error={fieldErrors["sport_specific.ball_size"]}
                    />
                  </FieldRow>

                  <FieldRow label="Ball Color">
                    <ColorChips
                      values={ball.ball_color}
                      onChange={(v) => updateBall("ball_color", v)}
                      disabled={saving}
                    />
                  </FieldRow>

                  <FieldRow label="Overs Durability">
                    <Input
                      placeholder="e.g. 30–35 overs, 50+ overs"
                      value={ball.overs_durability}
                      onChange={(e) => updateBall("overs_durability", e.target.value)}
                      disabled={saving}
                    />
                  </FieldRow>

                </div>
              </div>
            )
          })()}

        </div>
      )}
    </Container>
  )
}

// ── Default export ────────────────────────────────────────────────────────────
const ProductSportsAttributesWidget = (props: DetailWidgetProps<{ id: string }>) => {
  return (
    <ErrorBoundary>
      <SportsAttributesWidget {...props} />
    </ErrorBoundary>
  )
}

export const config = defineWidgetConfig({
  zone: "product.details.after",
})

export default ProductSportsAttributesWidget
