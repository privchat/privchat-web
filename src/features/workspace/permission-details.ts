/** Runtime supplies a bounded, redacted JSON summary. A tool name alone is not informed consent. */
export function permissionDetails(summary: unknown): string | null {
  if (summary && typeof summary === 'object' && !Array.isArray(summary)) {
    const {action, title, command, cwd, paths} = summary as Record<string, unknown>;
    if (typeof action !== 'string' || !['command', 'file_change', 'tool'].includes(action) || typeof title !== 'string' || !title.trim()) return null;
    const lines = [title];
    if (typeof command === 'string' && command.trim()) lines.push(command);
    if (typeof cwd === 'string' && cwd.trim()) lines.push(cwd);
    if (Array.isArray(paths)) lines.push(...paths.filter((path): path is string => typeof path === 'string' && !!path.trim()));
    return lines.join('\n');
  }
  if (typeof summary !== 'string') return null;
  try {
    const details = JSON.parse(summary) as Record<string, unknown>;
    if (details.kind !== 'tool' || typeof details.tool !== 'string' || !details.tool.trim() || !details.input || typeof details.input !== 'object' || Array.isArray(details.input)) return null;
    return JSON.stringify(details, null, 2);
  } catch { return null; }
}

export function canApprovePermission(summary: unknown, remoteApprovable?: boolean): boolean {
  if (!permissionDetails(summary) || remoteApprovable === false) return false;
  if (typeof summary === 'string') return true; // Legacy bounded tool summaries.
  const details = summary as Record<string, unknown>;
  if (remoteApprovable !== true || details.remoteApprovable !== true) return false;
  const command = typeof details.command === 'string' && !!details.command.trim();
  const paths = Array.isArray(details.paths) && details.paths.length > 0
    && details.paths.every(path => typeof path === 'string' && !!path.trim());
  if (details.action === 'command') return command;
  if (details.action === 'file_change') return paths;
  return command || paths;
}
