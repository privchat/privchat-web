export function taskElapsed(createdAt: number | undefined, endAt: number | null | undefined, locale: string): string | undefined {
  if (!createdAt || !Number.isFinite(createdAt) || endAt == null || !Number.isFinite(endAt) || endAt < createdAt) return;
  const minutes = Math.floor((endAt - createdAt) / 60_000);
  const units = minutes >= 1440 ? [[Math.floor(minutes / 1440), 'day'], [Math.floor(minutes / 60) % 24, 'hour']] as const
    : minutes >= 60 ? [[Math.floor(minutes / 60), 'hour'], [minutes % 60, 'minute']] as const
    : [[minutes || Math.floor((endAt - createdAt) / 1000), minutes ? 'minute' : 'second']] as const;
  return units.filter(([value], index) => index === 0 || value > 0).map(([value, unit]) =>
    new Intl.NumberFormat(locale, {style: 'unit', unit, unitDisplay: 'short'}).format(value)).join(' ');
}
