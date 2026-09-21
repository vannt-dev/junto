import schema from "../contracts/review-finding.schema.json" with { type: "json" }

/** Validate the small shared contract directly; the JSON schema is bundled with the plugin. */
export function validReviewFinding(input: unknown): boolean {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false
  const value = input as Record<string, unknown>
  const allowed = Object.keys(schema.properties)
  if (schema.required.some(key => !(key in value)) || Object.keys(value).some(key => !allowed.includes(key))) return false
  for (const key of ["id", "source", "file", "message"]) {
    if (typeof value[key] !== "string" || (key !== "message" && value[key].length === 0)) return false
  }
  return typeof value.severity === "string" && schema.properties.severity.enum.includes(value.severity)
    && typeof value.category === "string" && schema.properties.category.enum.includes(value.category)
    && (value.line === null || (typeof value.line === "number" && Number.isInteger(value.line) && value.line >= schema.properties.line.minimum))
    && value.metadata !== null && typeof value.metadata === "object" && !Array.isArray(value.metadata)
}
