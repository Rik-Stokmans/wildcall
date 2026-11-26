// Pure helpers for the time / weather / forecast readout.

/**
 * Forecast slots to show for stats.forecast hours. Slots are 3-hour steps from the
 * server; keep those starting within `hoursAllowed` of now (at least one when allowed > 0).
 */
export function forecastSlots(forecast, now, hoursAllowed) {
  if (!(hoursAllowed > 0) || !Array.isArray(forecast)) return [];
  const withOffset = forecast.map((s) => ({ ...s, offset: (((s.hour - now) % 24) + 24) % 24 }));
  withOffset.sort((a, b) => a.offset - b.offset);
  const within = withOffset.filter((s) => s.offset <= hoursAllowed);
  return within.length ? within : withOffset.slice(0, 1);
}
