// WILDCALL icon set: path data only (no DOM), so it can be tested in node.
//
// Every icon is drawn on a 24x24 grid for a 1.75px round-capped stroke in currentColor,
// with a few small solid accents (eyes, dots, keyholes) where a line would be muddy.
// ICONS[name] is the inner SVG markup; svgMarkup() wraps it into a complete <svg>.

/** A small solid accent dot. */
const dot = (x, y, r = 1.1) => `<circle cx="${x}" cy="${y}" r="${r}" fill="currentColor" stroke="none"/>`;
const p = (d) => `<path d="${d}"/>`;

/** An 8-tooth cog outline, computed once so the teeth are exactly even. */
function gearPath(teeth = 8, rOut = 9.6, rIn = 7.3) {
  const pts = [];
  const step = (Math.PI * 2) / teeth;
  const half = (deg) => (deg * Math.PI) / 180;
  for (let i = 0; i < teeth; i++) {
    const a = i * step - Math.PI / 2;
    for (const [r, off] of [[rIn, -half(17)], [rOut, -half(9)], [rOut, half(9)], [rIn, half(17)]]) {
      pts.push([12 + Math.cos(a + off) * r, 12 + Math.sin(a + off) * r]);
    }
  }
  return 'M' + pts.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join('L') + 'z';
}

export const ICONS = {
  /* ---------------------------------------------------------------- tools */
  binoculars: p('M3.3 15 5.2 6.5h3.1l1.5 5M20.7 15 18.8 6.5h-3.1l-1.5 5M9.8 11.5h4.4')
    + '<circle cx="6.6" cy="16.2" r="3.6"/><circle cx="17.4" cy="16.2" r="3.6"/>' + p('M10.2 16.2h3.6'),
  camera: p('M4 8.5h3.2L8.8 6h6.4l1.6 2.5H20a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5a1 1 0 0 1 1-1z')
    + '<circle cx="12" cy="13.2" r="3.7"/>' + dot(17.7, 11.2, 0.9),
  recorder: '<rect x="7.5" y="2.8" width="9" height="18.4" rx="2.8"/><circle cx="12" cy="8.2" r="2.2"/>'
    + p('M10 13.2h4M10 16.2h4') + dot(12, 19, 0.5),
  microphone: '<rect x="9" y="3" width="6" height="11" rx="3"/>' + p('M5.8 11.5a6.2 6.2 0 0 0 12.4 0M12 17.7V21M8.8 21h6.4M9 7.5h3M9 10.5h3'),
  headphones: p('M4 15.5V12a8 8 0 0 1 16 0v3.5') + '<rect x="2.8" y="14" width="4.2" height="6.5" rx="1.6"/><rect x="17" y="14" width="4.2" height="6.5" rx="1.6"/>',
  backpack: p('M6 10.5a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4V19a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2zM9 6.5V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.5M9 13.5h6V18a.5.5 0 0 1-.5.5h-5A.5.5 0 0 1 9 18zM12 13.5v2.2'),
  compass: '<circle cx="12" cy="12" r="9"/>' + p('M15.6 8.4 13.4 13.4 8.4 15.6l2.2-5z') + dot(12, 12, 0.9),
  map: p('M3 6.5 9 4l6 2.5 6-2.5v13.5l-6 2.5-6-2.5-6 2.5zM9 4v13.5M15 6.5V20'),
  clothing: p('M9 4 3.5 6.8l1.9 4 2.1-1V20h9V9.8l2.1 1 1.9-4L15 4a3.2 3.2 0 0 1-6 0zM12 7.5V20'),
  lens: '<circle cx="10.2" cy="10.2" r="6.6"/>' + p('M6.8 9.6a3.6 3.6 0 0 1 3-2.9M15.2 15.2l5 5M17.4 13l3.6 3.6'),
  journal: p('M6.2 3.5h10.8a2 2 0 0 1 2 2V20.5H7.6A1.6 1.6 0 0 1 6 18.9V3.7M6 18.9A1.6 1.6 0 0 1 7.6 17.3H19M10 8h5M10 11.2h3.4'),
  film: '<rect x="3.5" y="5" width="17" height="14" rx="2"/>' + p('M8 5v14M16 5v14M3.5 9h4.5M3.5 12h4.5M3.5 15h4.5M16 9h4.5M16 12h4.5M16 15h4.5'),
  seed: p('M12 3c4.2 3.2 6.2 6.8 6.2 10.4a6.2 6.2 0 0 1-12.4 0C5.8 9.8 7.8 6.2 12 3zM12 20v-8.5M12 15.2l2.6-2.4M12 17.6l-2.4-2'),

  /* ---------------------------------------------------------- disciplines */
  acoustics: dot(5.5, 12, 1.5) + p('M9.6 8.4a5 5 0 0 1 0 7.2M13.4 5.4a9.4 9.4 0 0 1 0 13.2M17.2 2.8a13.6 13.6 0 0 1 0 18.4'),
  observation: p('M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12z') + '<circle cx="12" cy="12" r="3"/>' + p('M12 2.5v1.6M6 4.4l.9 1.3M18 4.4l-.9 1.3'),
  photography: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5.2"/>' + p('M8.6 10.6a3.8 3.8 0 0 1 2.4-2.2M17.2 5.2l1.6 1.6') + dot(12, 12, 1.5),
  knowledge: p('M12 6.6C10 5 7 4.6 3.5 5v13c3.5-.4 6.5.1 8.5 1.6 2-1.5 5-2 8.5-1.6V5c-3.5-.4-6.5 0-8.5 1.6zM12 6.6v13'),
  fieldcraft: p('M6 3.5h6.2V9l5.2 2.2a2.6 2.6 0 0 1 1.6 2.4V18a1 1 0 0 1-1 1H6zM6 16h13M6 6.4h3M6 9.2h3M6 12h3'),

  /* ---------------------------------------------------------- progression */
  xp: p('M11 3c.7 4.8 1.7 5.8 6.5 6.5C12.7 10.2 11.7 11.2 11 16c-.7-4.8-1.7-5.8-6.5-6.5C9.3 8.8 10.3 7.8 11 3zM18.6 14.6c.3 2.2.8 2.7 3 3-2.2.3-2.7.8-3 3-.3-2.2-.8-2.7-3-3 2.2-.3 2.7-.8 3-3z'),
  level: '<circle cx="12" cy="12" r="9"/>' + p('M12 16.5V8M8.4 11.4 12 7.8l3.6 3.6'),
  rank: p('M4 8.5 12 4l8 4.5M4 13.5 12 9l8 4.5M4 18.5 12 14l8 4.5'),
  skillpoint: p('M7.2 4h9.6l4 5L12 20.2 3.2 9zM3.2 9h17.6M9 4l3 5 3-5M12 9v11.2'),
  credits: '<circle cx="12" cy="12" r="9"/>' + p('M15 9.3a4 4 0 1 0 0 5.4'),
  reputation: p('M12 3l7.5 3v5.4c0 4.6-3 8-7.5 9.6-4.5-1.6-7.5-5-7.5-9.6V6zM12 8.6l1.2 2.4 2.6.4-1.9 1.8.5 2.6-2.4-1.3-2.4 1.3.5-2.6-1.9-1.8 2.6-.4z'),
  star: p('M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.9z'),
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.2"/>' + p('M8 10.5V8a4 4 0 0 1 8 0v2.5M12 14.5v2'),
  check: p('M4.8 12.8l4.6 4.6L19.4 7'),
  quest: p('M12 2.8 21.2 12 12 21.2 2.8 12zM12 7.6v5') + dot(12, 15.9, 1),
  badge: '<circle cx="12" cy="9.5" r="5.8"/>' + p('M8.6 14.4 6.8 21l5.2-2.4 5.2 2.4-1.8-6.6M12 6.9l.9 1.8 2 .3-1.4 1.4.3 2-1.8-.9-1.8.9.3-2-1.4-1.4 2-.3z'),

  /* --------------------------------------------------------------- nature */
  bird: p('M3 20.2c3.2-6.2 6.8-10.6 11.2-12C15 5.4 19 5.2 19.8 8.4L22 9.4l-2.7 1.3c-.2 4.8-3.4 8.4-8.4 8.4-3 0-5.5.6-7.9 1.1zM9.2 14.6c2.2.7 4.4.1 6-1.8') + dot(17.2, 8.5, 0.8) + p('M11.8 19.2v2.3M14.4 18.6v2.6'),
  feather: p('M19.8 4.2c-7.5-1.2-13.2 2.2-14.4 9.2-.3 1.6-.2 3.2.3 4.7 6.7.4 12.8-3 14.1-13.9zM5.4 19 14 10.4M8.7 15.7l4.8.4M10.8 13l4.4.2'),
  leaf: p('M5.5 19.5c-.2-9 4.6-14.2 14-15 .3 9.4-4.7 14.8-12.6 15.2-.5 0-1 0-1.4-.2zM5 20.5l8.6-8.6M9.6 16.4l.2-4.2M12.4 13.6l3.8-.4'),
  tree: p('M12 3a5.2 5.2 0 0 0-4.8 7.3A4.4 4.4 0 0 0 8.6 18.6h6.8a4.4 4.4 0 0 0 1.4-8.3A5.2 5.2 0 0 0 12 3zM12 18.6v3M9.8 8.4a2.4 2.4 0 0 1 2-1.4'),
  footprint: p('M12 20.5V12M12 12 6 8.6M12 12V4M12 12l6-3.4M9.2 17.3h5.6'),
  nest: p('M3.2 12.4h17.6a8.8 7.2 0 0 1-17.6 0zM6.2 14.8l3 1.8M10.4 15l3.2 2.2M15.2 15.4l2.6-1.6') + '<ellipse cx="9.4" cy="9" rx="2.2" ry="2.9"/><ellipse cx="14.8" cy="9.5" rx="2.1" ry="2.7"/>',
  egg: p('M12 3c4 0 6.6 6 6.6 10a6.6 6.6 0 0 1-13.2 0C5.4 9 8 3 12 3zM9.4 14.2h.01M13.6 11.4h.01M13.2 16.6h.01M10.8 9.8h.01'),
  pond: '<ellipse cx="11.5" cy="16" rx="8.7" ry="4"/>' + p('M8 16c1.2.8 2.4.8 3.6 0M17.8 12.2V4.6M15.6 12.6 14.8 7.6M19.6 12.2 20.6 7') + dot(17.8, 4.2, 0.7),
  mountain: p('M2.5 19.5 9 8.2l4 6.5 2.6-3.7 5.9 8.5zM9 8.2l-1.8 3.2 1.9.8 1.5-1 1.6 1.4') ,
  wave: p('M3 8.6c3-3 6-3 9 0s6 3 9 0M3 14.6c3-3 6-3 9 0s6 3 9 0M3 20c3-2 6-2 9 0'),
  snow: p('M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M9.6 4.9 12 7l2.4-2.1M9.6 19.1 12 17l2.4 2.1'),

  /* -------------------------------------------------------------- weather */
  sunny: '<circle cx="12" cy="12" r="4.2"/>' + p('M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.9 1.9M16.6 16.6l1.9 1.9M5.5 18.5l1.9-1.9M16.6 7.4l1.9-1.9'),
  cloudy: p('M7.6 18.6a4.1 4.1 0 0 1-.5-8.2A5.9 5.9 0 0 1 18.4 11.4a3.6 3.6 0 0 1-.8 7.2z'),
  rain: p('M7.6 14.4a3.8 3.8 0 0 1-.5-7.5 5.6 5.6 0 0 1 10.7 1.5 3.2 3.2 0 0 1-.7 6zM8.2 17.4l-1 2.6M12.4 17.4l-1 2.6M16.6 17.4l-1 2.6'),
  wind: p('M3 8.6h9.6a2.6 2.6 0 1 0-2.6-2.6M3 12.6h14.2a2.6 2.6 0 1 1-2.6 2.6M3 16.6h6'),
  mist: p('M7.2 9.4a4.8 4.8 0 0 1 9.6 0M3 13h18M5 16.6h14M8.2 20.2h7.6M12 3v1.8M5.2 5.4l1.3 1.3M18.8 5.4l-1.3 1.3'),
  moon: p('M20.2 14.6A8.6 8.6 0 1 1 9.4 3.8a6.9 6.9 0 0 0 10.8 10.8z') + dot(16.5, 6.5, 0.6),
  dawn: p('M3 18h18M7.2 18a4.8 4.8 0 0 1 9.6 0M12 6.6v2.6M5.4 10.4l1.8 1.8M18.6 10.4l-1.8 1.8M8 21.2h8M12 3.8l-1.8 1.9M12 3.8l1.8 1.9'),

  /* ------------------------------------------------------------------- ui */
  close: p('M6 6l12 12M18 6 6 18'),
  back: p('M19 12H5.2M10.8 6.2 5 12l5.8 5.8'),
  forward: p('M5 12h13.8M13.2 6.2 19 12l-5.8 5.8'),
  up: p('M12 19V5.2M6.2 10.8 12 5l5.8 5.8'),
  down: p('M12 5v13.8M6.2 13.2 12 19l5.8-5.8'),
  plus: p('M12 5v14M5 12h14'),
  minus: p('M5 12h14'),
  search: '<circle cx="10.5" cy="10.5" r="6.3"/>' + p('M15.3 15.3 20.5 20.5'),
  filter: p('M4 5.5h16l-6 7.2V19l-4 2v-8.3z'),
  sort: p('M7 4v16M3.6 16.6 7 20l3.4-3.4M17 20V4M13.6 7.4 17 4l3.4 3.4'),
  pin: p('M9 3.5h6l-.9 6 3 3.5H6.9l3-3.5zM12 13v8'),
  play: p('M8 5.2v13.6l11-6.8z'),
  pause: p('M8.5 5v14M15.5 5v14'),
  stop: '<rect x="6" y="6" width="12" height="12" rx="2.2"/>',
  eye: p('M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12z') + '<circle cx="12" cy="12" r="3"/>',
  ear: p('M7 9.2a5 5 0 0 1 10 0c0 3-2.6 3.8-3.2 6.2a3 3 0 0 1-5.2 1.2M10 9.4a2 2 0 0 1 4 0c0 1.2-.8 1.6-1.4 2.4'),
  note: p('M5 4h14v10l-6 6H5zM19 14h-6v6M8.4 8.6h7.2M8.4 11.8h4'),
  info: '<circle cx="12" cy="12" r="9"/>' + p('M12 11v5.6') + dot(12, 7.8, 1),
  warning: p('M12 3.6 21.5 20h-19zM12 10v4.6') + dot(12, 17.4, 1),
  home: p('M3.5 11 12 4l8.5 7M5.6 9.6V20h12.8V9.6M10 20v-5.6h4V20'),
  shop: p('M4 9.2 5.4 4h13.2L20 9.2a2.5 2.5 0 0 1-5 0 2.5 2.5 0 0 1-5 0 2.5 2.5 0 0 1-5 0zM5.2 11.8V20h13.6v-8.2M9.8 20v-4.6h4.4V20'),
  upgrade: p('M12 20V8.2M6.4 13.6 12 8l5.6 5.6M5 4h14'),
  storage: '<rect x="3.4" y="6" width="17.2" height="14" rx="1.8"/>' + p('M3.4 10.6h17.2M10 14.2h4'),
  desk: p('M3 10h18M5 10v10.5M19 10v10.5M8.2 10V6.6h4.2V10M9 14.2h6v3.2H9zM16.4 10V7l-1.6-1.4') ,
  wall: '<rect x="3.5" y="4.2" width="8" height="6.6" rx="1"/><rect x="13.7" y="6.4" width="6.8" height="9" rx="1"/><rect x="4.5" y="13.2" width="6" height="6.6" rx="1"/>' + p('M13.7 18.4h6.8') + dot(7.5, 4.2, 0.6),
  settings: `<path d="${gearPath()}"/><circle cx="12" cy="12" r="3"/>`,

  /* ------------------------------------------------------------------ poi */
  cabin: p('M2.5 12.6 12 4.4l9.5 8.2M5 11v9.5h14V11M16.4 8.2V5h2.2v4.6M9.6 20.5v-5.2h4.8v5.2M5 15.2h4.6M14.4 15.2H19'),
  tower: p('M5 4.4 12 2l7 2.4M6.4 4.4h11.2v5.4H6.4zM8.2 9.8 6.6 21M15.8 9.8 17.4 21M7.4 15.4h9.2M7.4 21l8.6-8.2M16.6 21l-8.6-8.2'),
  station: p('M3.5 20.5V10.6L12 6.4l8.5 4.2v9.9M12 6.4V2.8l4 1.4-4 1.4M9.8 20.5v-5h4.4v5M2.5 20.5h19'),
  camp: p('M2.5 20.5 12 4.6l9.5 15.9zM12 20.5l-3.2-6.6h6.4zM1.8 20.5h20.4'),
  viewpoint: p('M3.8 11.4 16.6 5.6l1.9 4.2-12.7 5.8zM11.2 13.6v7.4M11.2 17.2 8 21M11.2 17.2 14.4 21M19.8 8.6l1.7-.8'),
  hide: p('M2.6 8.6 12 4.2l9.4 4.4M4 8.6V19.4h16V8.6M7.2 12.6h9.6M5 19.4v1.8M19 19.4v1.8'),
  landmark: p('M9 21 7.4 9 12 3l4.6 6L15 21zM6.4 21h11.2M9.6 10.4h4.8'),
  npc: '<circle cx="12" cy="8" r="3.7"/>' + p('M4.8 20.6c0-4.2 3-6.8 7.2-6.8s7.2 2.6 7.2 6.8'),
  page: p('M6 3.5h9.4L18 6.1V20.5l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5L6 20.5zM9.2 8.6h5.6M9.2 12h5.6'),
  relic: p('M8.8 3.5h6.4M10 3.5v3c-2.8.9-4.6 3.4-4.6 6.5 0 3.6 2 6.2 4.6 7.5h4c2.6-1.3 4.6-3.9 4.6-7.5 0-3.1-1.8-5.6-4.6-6.5v-3M5.6 12.6h12.8M8.6 16.4 10 15l1.4 1.4L12.8 15l1.4 1.4'),
  cache: p('M3.4 12V9.6a4.2 4.2 0 0 1 4.2-4.2h8.8a4.2 4.2 0 0 1 4.2 4.2V12M3 12h18v8H3zM12 12v1.4') + '<rect x="10.4" y="13" width="3.2" height="3.4" rx=".8"/>',
  gate: p('M4.6 21V9.8a7.4 7.4 0 0 1 14.8 0V21M9.4 21v-7.2M14.6 21v-7.2M9.4 13.8h5.2M2.6 21h18.8'),

  /* --------------------------------------------------------------- extras */
  clock: '<circle cx="12" cy="12" r="9"/>' + p('M12 7v5.2l3.2 2'),
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.2"/>' + p('M8 3v4M16 3v4M3.5 10h17M8 13.8h.01M12 13.8h.01M16 13.8h.01M8 17h.01M12 17h.01'),
  trophy: p('M8 4h8v5.2a4 4 0 0 1-8 0zM8 6.2H5.4A2.6 2.6 0 0 0 8 10M16 6.2h2.6A2.6 2.6 0 0 1 16 10M12 13.2V17M8.6 20.5h6.8M9.6 17h4.8'),
  pencil: p('M4 20.2l.9-4L16.4 4.7a2.1 2.1 0 0 1 3 3L7.9 19.3zM14.6 6.5l2.9 2.9'),
  speaker: p('M4 9.6h3.6L12.4 6v12l-4.8-3.6H4zM15.8 9a4.2 4.2 0 0 1 0 6M18.4 6.4a8 8 0 0 1 0 11.2'),
  trash: p('M4.5 6.5h15M9 6.5V4.2h6v2.3M6.4 6.5l.9 13.3h9.4l.9-13.3M10 10.4v6M14 10.4v6'),
  heart: p('M12 20.2C5.6 15.4 3.4 12.2 3.4 9a4.4 4.4 0 0 1 8.6-1.3A4.4 4.4 0 0 1 20.6 9c0 3.2-2.2 6.4-8.6 11.2z'),
  flag: p('M6 21V3.8M6 4.6h11.4l-2.6 3.6 2.6 3.6H6'),
};

/** Alternative names callers may plausibly use (item data, ad-hoc UI) → canonical icon. */
export const ICON_ALIASES = {
  sun: 'sunny', cloud: 'cloudy', gear: 'settings', user: 'npc', person: 'npc', book: 'knowledge',
  coin: 'credits', gold: 'credits', tent: 'camp', mic: 'microphone', binocular: 'binoculars',
  bag: 'backpack', x: 'close', ok: 'check', warn: 'warning', frame: 'wall', photo: 'camera',
  audio: 'acoustics', optics: 'binoculars', navigation: 'compass', trail: 'footprint', track: 'footprint',
  cog: 'settings', xpstar: 'xp', quill: 'feather', scope: 'viewpoint', crate: 'storage',
};

export const ICON_NAMES = Object.keys(ICONS);

/** The pinned vocabulary from the contract (kit.js header), by group. */
export const ICON_VOCABULARY = {
  tools: 'binoculars camera recorder microphone headphones backpack compass map clothing lens journal film seed',
  disciplines: 'acoustics observation photography knowledge fieldcraft',
  progression: 'xp level rank skillpoint credits reputation star lock check quest badge',
  nature: 'bird feather leaf tree footprint nest egg pond mountain wave snow',
  weather: 'sunny cloudy rain wind mist moon dawn',
  ui: 'close back forward up down plus minus search filter sort pin play pause stop eye ear note info warning home shop upgrade storage desk wall settings',
  poi: 'cabin tower station camp viewpoint hide landmark npc page relic cache gate',
};

/** Resolve aliases; returns the canonical name or null when the icon is unknown. */
export function resolveIcon(name) {
  const key = typeof name === 'string' ? name.toLowerCase() : '';
  if (Object.prototype.hasOwnProperty.call(ICONS, key)) return key;
  const alias = ICON_ALIASES[key];
  return alias && Object.prototype.hasOwnProperty.call(ICONS, alias) ? alias : null;
}

/** Inner markup for an icon: a neutral dot when the name is unknown. Never throws. */
export function iconInner(name) {
  const key = resolveIcon(name);
  return key ? ICONS[key] : dot(12, 12, 2.4);
}

/** A complete standalone <svg> string (handy for tests, CSS backgrounds and data URIs). */
export function svgMarkup(name, size = 20) {
  const s = Number.isFinite(+size) && +size > 0 ? +size : 20;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconInner(name)}</svg>`;
}
