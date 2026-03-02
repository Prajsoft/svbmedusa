import { normalizeSportsAttributes } from "../api/admin/products/[id]/sports-attributes/normalize"

describe("normalizeSportsAttributes", () => {
  it("converts legacy scalar multi-select fields into arrays", () => {
    const input = {
      sport: "Cricket",
      common: {
        skill_level: "Beginner",
        age_group: "Adult",
        activity_intensity: "Training",
        playing_surface: "Grass",
        best_for: "Club",
        certification: "",
        in_box_includes: "",
        customization_available: false,
        protection_level: "",
      },
      sport_specific: {
        equipment_type: "Ball",
        ball_type: "Leather",
        ball_grade: "Match",
        seam_type: "Hand Stitched",
        ball_color: "Red",
        ball_size: "Size 5 (Standard)",
        overs_durability: "",
      },
    }

    const normalized = normalizeSportsAttributes(input) as Record<string, unknown>
    const common = normalized.common as Record<string, unknown>
    const sportSpecific = normalized.sport_specific as Record<string, unknown>

    expect(common.skill_level).toEqual(["Beginner"])
    expect(common.age_group).toEqual(["Adult"])
    expect(common.activity_intensity).toEqual(["Training"])
    expect(common.playing_surface).toEqual(["Grass"])
    expect(common.best_for).toEqual(["Club"])
    expect(sportSpecific.ball_grade).toEqual(["Match"])
    expect(sportSpecific.ball_color).toEqual(["Red"])
  })

  it("converts blank legacy scalar values into empty arrays", () => {
    const input = {
      common: {
        skill_level: "",
      },
      sport_specific: {
        ball_grade: "   ",
      },
    }

    const normalized = normalizeSportsAttributes(input) as Record<string, unknown>
    const common = normalized.common as Record<string, unknown>
    const sportSpecific = normalized.sport_specific as Record<string, unknown>

    expect(common.skill_level).toEqual([])
    expect(sportSpecific.ball_grade).toEqual([])
  })

  it("leaves non-string/non-array values unchanged so validation still catches them", () => {
    const input = {
      common: {
        activity_intensity: 123,
      },
      sport_specific: {
        ball_grade: { bad: true },
      },
    }

    const normalized = normalizeSportsAttributes(input) as Record<string, unknown>
    const common = normalized.common as Record<string, unknown>
    const sportSpecific = normalized.sport_specific as Record<string, unknown>

    expect(common.activity_intensity).toBe(123)
    expect(sportSpecific.ball_grade).toEqual({ bad: true })
  })
})
