/**
 * Source artwork for all app icons: "forged ascent" — a minimal anvil with three
 * rising bars and a spark (forge + progression). White background, gray symbol.
 * `scale` shrinks the symbol for maskable icons (safe zone), `rounded` adds corners
 * for the favicon only (platforms mask the others themselves).
 */
export function iconSvg({ size = 512, rounded = true, scale = 1 } = {}) {
  const r = rounded ? 112 : 0;
  const t = (1 - scale) * 256;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${r}" fill="#ffffff"/>
  ${rounded ? `<rect x="1" y="1" width="510" height="510" rx="${r - 1}" fill="none" stroke="#e4e4e8" stroke-width="2"/>` : ''}
  <g transform="translate(${t} ${t}) scale(${scale})">
    <rect x="170" y="236" width="46" height="52" rx="12" fill="#b4b6bc"/>
    <rect x="233" y="188" width="46" height="100" rx="12" fill="#95979e"/>
    <rect x="296" y="136" width="46" height="152" rx="12" fill="#74767d"/>
    <path d="M319 72 L327 94 L349 102 L327 110 L319 132 L311 110 L289 102 L311 94 Z" fill="#5c5e65"/>
    <path d="M104 306 L384 306 C397 306 408 317 408 330 L408 334 C408 346 399 355 387 356 L330 362 L312 392 L346 392 C356 392 364 400 364 410 L364 418 C364 428 356 436 346 436 L166 436 C156 436 148 428 148 418 L148 410 C148 400 156 392 166 392 L200 392 L182 362 L150 356 C124 351 108 332 104 306 Z" fill="#5c5e65"/>
  </g>
</svg>`;
}
