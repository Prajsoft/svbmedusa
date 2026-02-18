/**
 * Single source of truth for SKU token dictionaries and regex patterns.
 * Future sports/types should extend this module via additional constants.
 */

export const SKU_PREFIX = "SVB"

export const ALLOWED_TYPES = ["CRB"]

export const ALLOWED_CRB_MODELS = ["SWFP", "CLB", "BLTZ", "BLTZP"]

export const ALLOWED_COLORS = ["RED", "WHT", "PNK"]

export const ALLOWED_PACKS = ["P01", "P06", "P12"]

export const CRB_SKU_REGEX =
  /^SVB-CRB-(SWFP|CLB|BLTZ|BLTZP)-(RED|WHT|PNK)-(P01|P06|P12)$/
