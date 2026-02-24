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
  EquipmentType,
  PLAYING_SURFACES,
  PROTECTION_LEVELS,
  SEAM_TYPES,
  SKILL_LEVELS,
  Sport,
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
function isKnownOption(value: string, options: readonly string[]): boolean {
  return options.includes(value)
}

// ── MultiChip ─────────────────────────────────────────────────────────────────
// Toggleable pill buttons for multi-select fields.
interface MultiChipProps {
  options: readonly string[]
  values: string[]
  onChange: (values: string[]) => void
  disabled: boolean
}

function MultiChip({ options, values, onChange, disabled }: MultiChipProps) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
      {options.map((opt) => {
        const active = values.includes(opt)
        return (
          <button
            key={opt}
            type="button"
            disabled={disabled}
            onClick={() =>
              onChange(active ? values.filter((v) => v !== opt) : [...values, opt])
            }
            style={{
              padding: "3px 10px",
              borderRadius: "9999px",
              border: `1px solid ${active ? "#7c3aed" : "#d1d5db"}`,
              backgroundColor: active ? "#7c3aed" : "transparent",
              color: active ? "#fff" : "inherit",
              fontSize: "12px",
              fontWeight: 500,
              cursor: disabled ? "not-allowed" : "pointer",
              opacity: disabled ? 0.6 : 1,
            }}
          >
            {opt}
          </button>
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

function ColorChips({ values, onChange, disabled }: ColorChipsProps) {
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
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
        {BALL_COLORS.map((color) => {
          const active = values.includes(color)
          return (
            <button
              key={color}
              type="button"
              disabled={disabled}
              onClick={() => toggleKnown(color)}
              style={{
                padding: "3px 10px",
                borderRadius: "9999px",
                border: `1px solid ${active ? "#7c3aed" : "#d1d5db"}`,
                backgroundColor: active ? "#7c3aed" : "transparent",
                color: active ? "#fff" : "inherit",
                fontSize: "12px",
                fontWeight: 500,
                cursor: disabled ? "not-allowed" : "pointer",
                opacity: disabled ? 0.6 : 1,
              }}
            >
              {color}
            </button>
          )
        })}
        <button
          type="button"
          disabled={disabled}
          onClick={toggleOther}
          style={{
            padding: "3px 10px",
            borderRadius: "9999px",
            border: `1px solid ${otherActive ? "#7c3aed" : "#d1d5db"}`,
            backgroundColor: otherActive ? "#7c3aed" : "transparent",
            color: otherActive ? "#fff" : "inherit",
            fontSize: "12px",
            fontWeight: 500,
            cursor: disabled ? "not-allowed" : "pointer",
            opacity: disabled ? 0.6 : 1,
          }}
        >
          Other
        </button>
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

function SelectWithOther({
  options,
  value,
  onChange,
  placeholder,
  disabled,
  error,
}: SelectWithOtherProps) {
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

function SimpleSelect({
  options,
  value,
  onChange,
  placeholder,
  disabled,
  error,
}: SimpleSelectProps) {
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

function FieldRow({ label, children }: FieldRowProps) {
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
function SportsAttributesWidget({ data }: DetailWidgetProps<{ id: string }>) {
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
    <K extends keyof SportsAttributes["sport_specific"]>(
      field: K,
      value: SportsAttributes["sport_specific"][K]
    ) => {
      setAttrs((prev) => ({
        ...prev,
        sport_specific: { ...prev.sport_specific, [field]: value },
      }))
    },
    []
  )

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

          {/* Sport / Equipment (read-only) */}
          <div style={gridStyle}>
            <FieldRow label="Sport">
              <Badge color="blue">{Sport.Cricket}</Badge>
            </FieldRow>
            <FieldRow label="Equipment Type">
              <Badge color="blue">{EquipmentType.Ball}</Badge>
            </FieldRow>
          </div>

          {/* ── Common Attributes ────────────────────────────────────────── */}
          <div>
            <Heading level="h3" style={{ marginBottom: "14px" }}>
              Common Attributes
            </Heading>
            <div style={gridStyle}>

              <FieldRow label="Skill Level">
                <MultiChip
                  options={SKILL_LEVELS}
                  values={attrs.common.skill_level}
                  onChange={(v) => updateCommon("skill_level", v)}
                  disabled={saving}
                />
              </FieldRow>

              <FieldRow label="Age Group">
                <MultiChip
                  options={AGE_GROUPS}
                  values={attrs.common.age_group}
                  onChange={(v) => updateCommon("age_group", v)}
                  disabled={saving}
                />
              </FieldRow>

              <FieldRow label="Activity Intensity">
                <SimpleSelect
                  options={ACTIVITY_INTENSITIES}
                  value={attrs.common.activity_intensity}
                  onChange={(v) => updateCommon("activity_intensity", v)}
                  placeholder="Select intensity..."
                  disabled={saving}
                  error={fieldErrors["common.activity_intensity"]}
                />
              </FieldRow>

              <FieldRow label="Best For">
                <SimpleSelect
                  options={BEST_FOR_OPTIONS}
                  value={attrs.common.best_for}
                  onChange={(v) => updateCommon("best_for", v)}
                  placeholder="Select audience..."
                  disabled={saving}
                  error={fieldErrors["common.best_for"]}
                />
              </FieldRow>

              <FieldRow label="Playing Surface">
                <MultiChip
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

          {/* ── Ball Attributes ───────────────────────────────────────────── */}
          <div>
            <Heading level="h3" style={{ marginBottom: "14px" }}>
              Ball Attributes
            </Heading>
            <div style={gridStyle}>

              <FieldRow label="Ball Type">
                <SelectWithOther
                  options={BALL_TYPES}
                  value={attrs.sport_specific.ball_type}
                  onChange={(v) => updateBall("ball_type", v)}
                  placeholder="Select type..."
                  disabled={saving}
                  error={fieldErrors["sport_specific.ball_type"]}
                />
              </FieldRow>

              <FieldRow label="Ball Grade">
                <SelectWithOther
                  options={BALL_GRADES}
                  value={attrs.sport_specific.ball_grade}
                  onChange={(v) => updateBall("ball_grade", v)}
                  placeholder="Select grade..."
                  disabled={saving}
                  error={fieldErrors["sport_specific.ball_grade"]}
                />
              </FieldRow>

              <FieldRow label="Seam Type">
                <SelectWithOther
                  options={SEAM_TYPES}
                  value={attrs.sport_specific.seam_type}
                  onChange={(v) => updateBall("seam_type", v)}
                  placeholder="Select seam type..."
                  disabled={saving}
                  error={fieldErrors["sport_specific.seam_type"]}
                />
              </FieldRow>

              <FieldRow label="Ball Size">
                <SelectWithOther
                  options={BALL_SIZES}
                  value={attrs.sport_specific.ball_size}
                  onChange={(v) => updateBall("ball_size", v)}
                  placeholder="Select size..."
                  disabled={saving}
                  error={fieldErrors["sport_specific.ball_size"]}
                />
              </FieldRow>

              <FieldRow label="Ball Color">
                <ColorChips
                  values={attrs.sport_specific.ball_color}
                  onChange={(v) => updateBall("ball_color", v)}
                  disabled={saving}
                />
              </FieldRow>

              <FieldRow label="Overs Durability">
                <Input
                  placeholder="e.g. 30–35 overs, 50+ overs"
                  value={attrs.sport_specific.overs_durability}
                  onChange={(e) => updateBall("overs_durability", e.target.value)}
                  disabled={saving}
                />
              </FieldRow>

            </div>
          </div>

        </div>
      )}
    </Container>
  )
}

// ── Default export ────────────────────────────────────────────────────────────
function ProductSportsAttributesWidget(props: DetailWidgetProps<{ id: string }>) {
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
