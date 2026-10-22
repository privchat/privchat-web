/** Runtime supplies a bounded, redacted JSON summary. A tool name alone is not informed consent. */
export function permissionDetails(summary: string): string | null {
  try {
    const details = JSON.parse(summary) as Record<string, unknown>;
    if (details.kind !== 'tool' || typeof details.tool !== 'string' || !details.tool.trim() || !details.input || typeof details.input !== 'object' || Array.isArray(details.input)) return null;
    return JSON.stringify(details, null, 2);
  } catch { return null; }
}
