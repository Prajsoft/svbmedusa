/**
 * @jest-environment jsdom
 *
 * Widget unit tests — ProductSportsAttributesWidget
 *
 * All UI library components are mocked with minimal HTML equivalents so tests
 * focus on widget behaviour rather than Radix UI internals.
 * global.fetch is mocked for every test; no real server is needed.
 */

import "@testing-library/jest-dom"
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react"
import type { SportsAttributes } from "../types/sports-attributes"
import { DEFAULT_SPORTS_ATTRIBUTES } from "../types/sports-attributes"

// ── Mock @medusajs/ui ─────────────────────────────────────────────────────────
jest.mock("@medusajs/ui", () => {
  const React = require("react") as typeof import("react")

  const Badge = ({ children, color, ...rest }: { children: React.ReactNode; color?: string; [k: string]: unknown }) =>
    React.createElement("span", { "data-testid": "badge", "data-color": color, ...rest }, children)

  const Button = ({
    children,
    isLoading,
    disabled,
    onClick,
    ...rest
  }: {
    children: React.ReactNode
    isLoading?: boolean
    disabled?: boolean
    onClick?: () => void
    [k: string]: unknown
  }) =>
    React.createElement(
      "button",
      { "data-testid": "button", disabled: disabled ?? isLoading, onClick, ...rest },
      isLoading ? "Loading..." : children
    )

  const Container = ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", { "data-testid": "container" }, children)

  const Heading = ({ children, level = "h2" }: { children?: React.ReactNode; level?: string }) =>
    React.createElement(level, null, children)

  const Input = ({
    value,
    onChange,
    disabled,
    placeholder,
    ...rest
  }: {
    value?: string
    onChange?: React.ChangeEventHandler<HTMLInputElement>
    disabled?: boolean
    placeholder?: string
    [k: string]: unknown
  }) =>
    React.createElement("input", {
      "data-testid": "input",
      value: value ?? "",
      onChange,
      disabled,
      placeholder,
      ...rest,
    })

  // Select renders as a plain <select> so fireEvent.change works.
  // Trigger → null, Value → null, Content → fragment, Item → <option>.
  // A hidden placeholder <option value=""> is prepended so that when the
  // controlled value is "" the native select's .value property is also "".
  const Select = Object.assign(
    ({
      children,
      value,
      onValueChange,
      disabled,
    }: {
      children?: React.ReactNode
      value?: string
      onValueChange?: (v: string) => void
      disabled?: boolean
    }) =>
      React.createElement(
        "select",
        {
          "data-testid": "select",
          value: value ?? "",
          onChange: (e: React.ChangeEvent<HTMLSelectElement>) =>
            onValueChange?.(e.target.value),
          disabled,
        },
        React.createElement("option", { value: "" }),
        children
      ),
    {
      Trigger: () => null,
      Value: () => null,
      Content: ({ children }: { children?: React.ReactNode }) =>
        React.createElement(React.Fragment, null, children),
      Item: ({ children, value }: { children?: React.ReactNode; value: string }) =>
        React.createElement("option", { value }, children),
    }
  )

  const Skeleton = () =>
    React.createElement("div", { "data-testid": "skeleton" })

  const Switch = ({
    checked,
    onCheckedChange,
    disabled,
  }: {
    checked?: boolean
    onCheckedChange?: (v: boolean) => void
    disabled?: boolean
  }) =>
    React.createElement("input", {
      "data-testid": "switch",
      type: "checkbox",
      checked: checked ?? false,
      onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
        onCheckedChange?.(e.target.checked),
      disabled,
    })

  const Text = ({
    children,
    size,
    weight,
    className,
    as: As = "p",
    ...rest
  }: {
    children?: React.ReactNode
    size?: string
    weight?: string
    className?: string
    as?: keyof JSX.IntrinsicElements
    [k: string]: unknown
  }) =>
    React.createElement(As, { "data-size": size, "data-weight": weight, className, ...rest }, children)

  return { Badge, Button, Container, Heading, Input, Select, Skeleton, Switch, Text }
})

// ── Mock @medusajs/admin-sdk ───────────────────────────────────────────────────
jest.mock("@medusajs/admin-sdk", () => ({
  defineWidgetConfig: (cfg: unknown) => cfg,
}))

// ── Import the widget AFTER mocks are in place ────────────────────────────────
import ProductSportsAttributesWidget from "../admin/widgets/product-sports-attributes"

// ── Helpers ───────────────────────────────────────────────────────────────────
const PRODUCT_ID = "test-widget-product-001"

function makeProps(id = PRODUCT_ID) {
  return { data: { id } }
}

function mockFetchGet(payload: { sports_attributes: SportsAttributes | null }) {
  return jest.fn().mockResolvedValueOnce({ ok: true, json: async () => payload })
}

function mockFetchGetThenPost(
  getPayload: { sports_attributes: SportsAttributes | null },
  postPayload: { success: boolean; sports_attributes: SportsAttributes }
) {
  return jest
    .fn()
    .mockResolvedValueOnce({ ok: true, json: async () => getPayload })
    .mockResolvedValueOnce({ ok: true, json: async () => postPayload })
}

const FULL_ATTRS: SportsAttributes = {
  sport: "Cricket" as const,
  common: {
    skill_level: ["Beginner", "Intermediate"],
    age_group: ["Adult"],
    activity_intensity: ["Training"],
    playing_surface: ["Grass"],
    certification: "SG Approved",
    best_for: ["Club"],
    in_box_includes: "Ball, Pouch",
    customization_available: false,
    protection_level: "Standard",
  },
  sport_specific: {
    equipment_type: "Ball" as const,
    ball_type: "Leather",
    ball_grade: ["Match"],
    seam_type: "Hand Stitched",
    ball_color: ["Red", "White"],
    ball_size: "Size 5 (Standard)",
    overs_durability: "50+ overs",
  },
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe("ProductSportsAttributesWidget", () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(async () => {
    await act(async () => {
      jest.runOnlyPendingTimers()
    })
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  // ── Test 1 — Loading skeleton on mount ─────────────────────────────────────
  it("shows loading skeletons while the initial fetch is pending", () => {
    // Fetch never resolves during this test
    global.fetch = jest.fn(() => new Promise(() => {}))

    render(ProductSportsAttributesWidget(makeProps()))

    const skeletons = screen.getAllByTestId("skeleton")
    expect(skeletons.length).toBeGreaterThan(0)
  })

  // ── Test 2 — Populates fields from API response ────────────────────────────
  it("renders loaded data: selected chips and dropdown values are visible", async () => {
    global.fetch = mockFetchGet({ sports_attributes: FULL_ATTRS })

    render(ProductSportsAttributesWidget(makeProps()))

    // Wait for skeletons to disappear (fetch resolved)
    await waitFor(() => {
      expect(screen.queryByTestId("skeleton")).toBeNull()
    })

    // Beginner option should be selected in the multi-checkbox control
    expect(screen.getByRole("checkbox", { name: "Beginner" })).toBeChecked()
    // The ball_type select should show "Leather" as selected value
    const selects = screen.getAllByTestId("select")
    const ballTypeSelect = selects.find(
      (s) => (s as HTMLSelectElement).value === "Leather"
    )
    expect(ballTypeSelect).toBeDefined()
    // Certification text input should show the saved value
    const inputs = screen.getAllByTestId("input") as HTMLInputElement[]
    const certInput = inputs.find((i) => i.value === "SG Approved")
    expect(certInput).toBeDefined()
  })

  // ── Test 3 — Empty form for null sports_attributes ─────────────────────────
  it("shows default empty form when API returns sports_attributes: null", async () => {
    global.fetch = mockFetchGet({ sports_attributes: null })

    render(ProductSportsAttributesWidget(makeProps()))

    await waitFor(() => {
      expect(screen.queryByTestId("skeleton")).toBeNull()
    })

    // No chip buttons should have the active (purple) background
    const chipButtons = screen
      .getAllByRole("button")
      .filter((b) => !b.hasAttribute("data-testid")) // exclude the Save button
    const activeChip = chipButtons.find(
      (b) =>
        (b as HTMLButtonElement).style.backgroundColor === "rgb(124, 58, 237)"
    )
    expect(activeChip).toBeUndefined()

    // All selects should have empty value (showing placeholder)
    const selects = screen.getAllByTestId("select") as HTMLSelectElement[]
    for (const sel of selects) {
      expect(["", "Ball"]).toContain(sel.value)
    }
  })

  // ── Test 4 — Save button disabled while saving ─────────────────────────────
  it("disables the Save button while a save request is in flight", async () => {
    type FetchMock = { ok: boolean; json: () => Promise<unknown> }
    let resolveSave!: (v: FetchMock) => void
    const savePromise = new Promise<FetchMock>((r) => { resolveSave = r })

    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ sports_attributes: FULL_ATTRS }) })
      // The POST will not resolve until we call resolveSave
      .mockReturnValueOnce(savePromise)

    render(ProductSportsAttributesWidget(makeProps()))
    await waitFor(() => expect(screen.queryByTestId("skeleton")).toBeNull())

    // Dirty the form so Save becomes enabled
    fireEvent.click(screen.getByRole("checkbox", { name: "Beginner" }))

    const saveBtn = screen.getByRole("button", { name: /save/i }) as HTMLButtonElement
    expect(saveBtn.disabled).toBe(false)

    fireEvent.click(saveBtn)

    // Button should be disabled immediately after click while fetch is pending
    expect(saveBtn.disabled).toBe(true)

    // Resolve the save so the component can finish
    await act(async () => {
      resolveSave({ ok: true, json: async () => ({ success: true, sports_attributes: FULL_ATTRS }) })
    })
  })

  // ── Test 5 — Shows Saved badge after successful save ───────────────────────
  it("shows a Saved badge after a successful save, then hides it after 3 seconds", async () => {
    global.fetch = mockFetchGetThenPost(
      { sports_attributes: FULL_ATTRS },
      { success: true, sports_attributes: FULL_ATTRS }
    )

    render(ProductSportsAttributesWidget(makeProps()))
    await waitFor(() => expect(screen.queryByTestId("skeleton")).toBeNull())

    // Dirty the form
    fireEvent.click(screen.getByRole("checkbox", { name: "Beginner" }))

    fireEvent.click(screen.getByRole("button", { name: /save/i }))

    await waitFor(() => {
      const badges = screen.queryAllByTestId("badge")
      const savedBadge = badges.find((b) => b.textContent === "Saved")
      expect(savedBadge).toBeTruthy()
    })

    // After 3 seconds the badge should disappear
    act(() => { jest.advanceTimersByTime(3100) })

    await waitFor(() => {
      const badges = screen.queryAllByTestId("badge")
      const savedBadge = badges.find((b) => b.textContent === "Saved")
      expect(savedBadge).toBeFalsy()
    })
  })

  // ── Test 6 — Shows error message on failed save ───────────────────────────
  it("shows an error message when the save request fails", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ sports_attributes: FULL_ATTRS }) })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Internal server error" }) })

    render(ProductSportsAttributesWidget(makeProps()))
    await waitFor(() => expect(screen.queryByTestId("skeleton")).toBeNull())

    // Dirty the form and save
    fireEvent.click(screen.getByRole("checkbox", { name: "Beginner" }))
    fireEvent.click(screen.getByRole("button", { name: /save/i }))

    await waitFor(() => {
      expect(screen.getByText(/internal server error/i)).toBeInTheDocument()
    })

    // No "Saved" badge should appear
    const badges = screen.queryAllByTestId("badge")
    expect(badges.find((b) => b.textContent === "Saved")).toBeFalsy()
  })

  // ── Test 7 — Dirty state indicator on field change ────────────────────────
  it("shows Unsaved changes badge when a field is edited, clears it after save", async () => {
    global.fetch = mockFetchGetThenPost(
      { sports_attributes: FULL_ATTRS },
      { success: true, sports_attributes: FULL_ATTRS }
    )

    render(ProductSportsAttributesWidget(makeProps()))
    await waitFor(() => expect(screen.queryByTestId("skeleton")).toBeNull())

    // Initially no dirty indicator
    expect(
      screen.queryAllByTestId("badge").find((b) => b.textContent === "Unsaved changes")
    ).toBeFalsy()

    // Edit a field
    fireEvent.click(screen.getByRole("checkbox", { name: "Beginner" }))

    const dirtyBadge = screen
      .queryAllByTestId("badge")
      .find((b) => b.textContent === "Unsaved changes")
    expect(dirtyBadge).toBeTruthy()

    // Save
    fireEvent.click(screen.getByRole("button", { name: /save/i }))

    await waitFor(() => {
      const badges = screen.queryAllByTestId("badge")
      expect(badges.find((b) => b.textContent === "Unsaved changes")).toBeFalsy()
    })
  })

  // ── Test 8 — Other (specify) reveals text input for ball_type ─────────────
  it("reveals a text input when Other (specify) is selected in ball_type dropdown", async () => {
    global.fetch = mockFetchGet({ sports_attributes: null })

    render(ProductSportsAttributesWidget(makeProps()))
    await waitFor(() => expect(screen.queryByTestId("skeleton")).toBeNull())

    // The "Specify..." placeholder input should not be visible yet
    const specifyInputsBefore = (screen.queryAllByTestId("input") as HTMLInputElement[])
      .filter((i) => i.placeholder === "Specify...")
    expect(specifyInputsBefore).toHaveLength(0)

    // Select "Other (specify)" in ball_type dropdown (first select with options
    // containing "other" value)
    const selects = screen.getAllByTestId("select") as HTMLSelectElement[]
    const ballTypeSelect = selects.find(
      (s) =>
        Array.from(s.options).some((o) => o.value === "other") &&
        Array.from(s.options).some((o) => o.value === "Leather")
    )
    expect(ballTypeSelect).toBeDefined()
    fireEvent.change(ballTypeSelect!, { target: { value: "other" } })

    // The "Specify..." placeholder input should now appear
    await waitFor(() => {
      const specifyInputs = (screen.queryAllByTestId("input") as HTMLInputElement[])
        .filter((i) => i.placeholder === "Specify...")
      expect(specifyInputs.length).toBeGreaterThan(0)
    })
  })

  // ── Test 9 — Selecting a known option after Other hides the text input ────
  it("hides the Specify text input when a known option is re-selected in ball_type", async () => {
    global.fetch = mockFetchGet({ sports_attributes: null })

    render(ProductSportsAttributesWidget(makeProps()))
    await waitFor(() => expect(screen.queryByTestId("skeleton")).toBeNull())

    const selects = screen.getAllByTestId("select") as HTMLSelectElement[]
    const ballTypeSelect = selects.find(
      (s) =>
        Array.from(s.options).some((o) => o.value === "other") &&
        Array.from(s.options).some((o) => o.value === "Leather")
    )!

    // Open "Other"
    fireEvent.change(ballTypeSelect, { target: { value: "other" } })
    await waitFor(() => {
      expect(
        (screen.queryAllByTestId("input") as HTMLInputElement[]).some(
          (i) => i.placeholder === "Specify..."
        )
      ).toBe(true)
    })

    // Re-select a known option — should hide the text input
    fireEvent.change(ballTypeSelect, { target: { value: "Leather" } })
    await waitFor(() => {
      const specifyInputs = (screen.queryAllByTestId("input") as HTMLInputElement[])
        .filter((i) => i.placeholder === "Specify...")
      expect(specifyInputs).toHaveLength(0)
    })

    // ball_type value should now be "Leather" (reflected in the select)
    expect(ballTypeSelect.value).toBe("Leather")
  })

  // ── Test 10 — Typing custom color updates form state (dirty) ──────────────
  it("marks form dirty when a custom colour is typed into the Other color input", async () => {
    global.fetch = mockFetchGet({ sports_attributes: null })

    render(ProductSportsAttributesWidget(makeProps()))
    await waitFor(() => expect(screen.queryByTestId("skeleton")).toBeNull())

    // No dirty state initially
    expect(
      screen.queryAllByTestId("badge").find((b) => b.textContent === "Unsaved changes")
    ).toBeFalsy()

    // Click the "Other" checkbox in ball_color section
    fireEvent.click(screen.getByRole("checkbox", { name: "Other" }))

    // The custom color input should appear
    await waitFor(() => {
      const customInput = (screen.queryAllByTestId("input") as HTMLInputElement[])
        .find((i) => i.placeholder === "Custom colour(s), comma-separated")
      expect(customInput).toBeDefined()
    })

    const customInput = (screen.queryAllByTestId("input") as HTMLInputElement[])
      .find((i) => i.placeholder === "Custom colour(s), comma-separated")!

    // Type a custom color
    fireEvent.change(customInput, { target: { value: "Purple" } })

    // The value in the input should update
    expect(customInput.value).toBe("Purple")

    // Form should be dirty now (custom color was added)
    await waitFor(() => {
      const badges = screen.queryAllByTestId("badge")
      expect(
        badges.find((b) => b.textContent === "Unsaved changes")
      ).toBeTruthy()
    })
  })
})
