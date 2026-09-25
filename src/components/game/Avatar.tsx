import type { AvatarConfig } from '@/types';

function shade(hex: string, amt: number): string {
  if (!hex.startsWith('#') || hex.length !== 7) return hex;
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v + amt)));
  const r = c((n >> 16) & 255);
  const g = c((n >> 8) & 255);
  const b = c(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

function Hair({ style, color }: { style: string; color: string }) {
  const dark = shade(color, -25);
  switch (style) {
    case 'bald':
      return <ellipse cx="44" cy="31" rx="5" ry="2.5" fill="#fff" opacity="0.35" />;
    case 'buzz':
      return <path d="M30.5 40 C30 26 39 21 50 21 C61 21 70 26 69.5 40 C66 32 59 29 50 29 C41 29 34 32 30.5 40Z" fill={color} opacity="0.85" />;
    case 'curly':
      return (
        <g fill={color}>
          {[
            [34, 33, 7], [41, 26, 7.5], [50, 23, 8], [59, 26, 7.5], [66, 33, 7], [31, 41, 5], [69, 41, 5],
          ].map(([x, y, r]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r={r} />
          ))}
          <circle cx="46" cy="27" r="3" fill={dark} opacity="0.4" />
        </g>
      );
    case 'long':
      return (
        <g fill={color}>
          <path d="M29 44 C27 26 38 20 50 20 C62 20 73 26 71 44 L72 68 C69 72 65 72 64 68 L65 42 C60 34 40 34 35 42 L36 68 C35 72 31 72 28 68Z" />
          <path d="M31 38 C36 28 47 26 58 30 C54 33 44 35 31 38Z" fill={dark} opacity="0.35" />
        </g>
      );
    case 'bun':
      return (
        <g fill={color}>
          <circle cx="50" cy="17" r="7.5" />
          <path d="M30 42 C29 27 38 22 50 22 C62 22 71 27 70 42 C66 33 58 30 50 30 C42 30 34 33 30 42Z" />
        </g>
      );
    case 'spiky':
      return <path d="M30 42 L31 30 L36 34 L37 21 L43 29 L47 17 L51 28 L56 18 L58 29 L64 21 L64 33 L70 30 L70 42 C65 33 58 31 50 31 C42 31 35 33 30 42Z" fill={color} />;
    case 'mohawk':
      return <path d="M44 34 C43 24 45 14 50 10 C55 14 57 24 56 34 C53 31 47 31 44 34Z" fill={color} />;
    case 'short':
    default:
      return (
        <g fill={color}>
          <path d="M30 43 C28 27 38 20 50 20 C63 20 72 27 70 43 C68 35 64 31 59 30 C55 33 45 34 36 32 C33 35 31 38 30 43Z" />
          <path d="M40 24 C46 21 56 21 62 25 C55 25 47 26 40 24Z" fill={dark} opacity="0.35" />
        </g>
      );
  }
}

function Outfit({ style, color, skin }: { style: string; color: string; skin: string }) {
  const dark = shade(color, -30);
  const light = shade(color, 30);
  const body = 'M16 100 C16 79 31 70 50 70 C69 70 84 79 84 100Z';
  switch (style) {
    case 'tank':
      return (
        <g>
          <path d={body} fill={skin} />
          <path d="M32 100 L34 76 C39 73 44 72 50 76 C56 72 61 73 66 76 L68 100Z" fill={color} />
        </g>
      );
    case 'hoodie':
      return (
        <g>
          <path d={body} fill={color} />
          <path d="M34 73 C38 84 62 84 66 73 C62 70 56 69 50 69 C44 69 38 70 34 73Z" fill={dark} />
          <path d="M45 80 L44 92 M55 80 L56 92" stroke={light} strokeWidth="1.8" strokeLinecap="round" />
          <path d="M38 94 L62 94" stroke={dark} strokeWidth="2" opacity="0.5" />
        </g>
      );
    case 'suit':
      return (
        <g>
          <path d={body} fill={color} />
          <path d="M42 71 L50 86 L58 71 C55 70 53 70 50 70 C47 70 45 70 42 71Z" fill="#fff" />
          <path d="M50 76 L47.5 80 L50 92 L52.5 80Z" fill="#c0392b" />
          <path d="M42 71 L50 86 L40 80Z M58 71 L50 86 L60 80Z" fill={dark} />
        </g>
      );
    case 'gi':
      return (
        <g>
          <path d={body} fill="#f5f5f5" />
          <path d="M40 71 L56 100 M60 71 L46 100" stroke="#ddd" strokeWidth="5" />
          <path d="M22 92 L78 92" stroke={color} strokeWidth="5" />
        </g>
      );
    case 'armor':
      return (
        <g>
          <path d={body} fill="#8e9aa8" />
          <path d="M16 100 C16 86 20 78 30 74 L34 86 Z M84 100 C84 86 80 78 70 74 L66 86Z" fill={color} />
          <path d="M38 76 L62 76 L60 96 L40 96Z" fill={shade('#8e9aa8', -20)} />
          <circle cx="50" cy="85" r="4" fill={color} />
        </g>
      );
    case 'tee':
    default:
      return (
        <g>
          <path d={body} fill={color} />
          <path d="M40 71 C44 77 56 77 60 71 C57 70 54 69.5 50 69.5 C46 69.5 43 70 40 71Z" fill={skin} />
          <path d="M40 71 C44 77 56 77 60 71" stroke={dark} strokeWidth="1.6" fill="none" />
        </g>
      );
  }
}

function Accessory({ style }: { style: string }) {
  switch (style) {
    case 'glasses':
      return (
        <g stroke="#222" strokeWidth="1.8" fill="none">
          <circle cx="42.5" cy="45" r="5.2" />
          <circle cx="57.5" cy="45" r="5.2" />
          <path d="M47.7 45 L52.3 45" />
        </g>
      );
    case 'sunglasses':
      return (
        <g>
          <path d="M35 42 L48 42 C48 49 45 51 41 51 C37 51 35 48 35 42Z M52 42 L65 42 C65 48 63 51 59 51 C55 51 52 49 52 42Z" fill="#111" />
          <path d="M48 43 L52 43" stroke="#111" strokeWidth="2" />
          <path d="M37 44 L41 44" stroke="#fff" strokeWidth="1.2" opacity="0.6" />
        </g>
      );
    case 'cap':
      return (
        <g>
          <path d="M29 37 C29 24 39 19 50 19 C61 19 71 24 71 37Z" fill="#2f6bff" />
          <path d="M50 37 L80 37 C80 41 75 42 50 41Z" fill="#1d4fd1" />
          <circle cx="50" cy="20" r="2" fill="#1d4fd1" />
        </g>
      );
    case 'headphones':
      return (
        <g>
          <path d="M27 46 C26 26 37 17 50 17 C63 17 74 26 73 46" stroke="#222" strokeWidth="3.5" fill="none" />
          <rect x="23" y="41" width="8" height="13" rx="4" fill="#ff5a1f" />
          <rect x="69" y="41" width="8" height="13" rx="4" fill="#ff5a1f" />
        </g>
      );
    case 'headband':
      return <path d="M30 35 C38 30 62 30 70 35 L70 39 C62 34 38 34 30 39Z" fill="#ff375f" />;
    case 'crown':
      return (
        <g>
          <path d="M36 25 L38 12 L44 19 L50 9 L56 19 L62 12 L64 25Z" fill="#ffc233" stroke="#e0a100" strokeWidth="1" />
          <circle cx="50" cy="19" r="1.8" fill="#ff375f" />
        </g>
      );
    case 'halo':
      return <ellipse cx="50" cy="13" rx="14" ry="3.5" fill="none" stroke="#ffd35a" strokeWidth="2.5" />;
    default:
      return null;
  }
}

export function Avatar({ config, size = 40, className, ring }: { config: AvatarConfig; size?: number; className?: string; ring?: string }) {
  const skin = config.skin;
  const gradient = config.background.startsWith('linear-gradient');
  return (
    <div
      className={`relative shrink-0 overflow-hidden rounded-full ${className ?? ''}`}
      style={{ width: size, height: size, background: config.background, boxShadow: ring ? `0 0 0 2px var(--lf-bg), 0 0 0 4px ${ring}` : undefined }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 100 100" width={size} height={size}>
        {!gradient && <rect width="100" height="100" fill={config.background} />}
        <Outfit style={config.outfit} color={config.outfitColor} skin={skin} />
        <rect x="44" y="58" width="12" height="14" rx="5" fill={shade(skin, -18)} />
        <circle cx="30" cy="46" r="4" fill={shade(skin, -10)} />
        <circle cx="70" cy="46" r="4" fill={shade(skin, -10)} />
        <circle cx="50" cy="44" r="20" fill={skin} />
        <ellipse cx="43" cy="46" rx="2.1" ry="2.6" fill="#1d1d24" />
        <ellipse cx="57" cy="46" rx="2.1" ry="2.6" fill="#1d1d24" />
        <circle cx="43.8" cy="45" r="0.7" fill="#fff" />
        <circle cx="57.8" cy="45" r="0.7" fill="#fff" />
        <circle cx="38" cy="52" r="3" fill="#ff7a8a" opacity="0.3" />
        <circle cx="62" cy="52" r="3" fill="#ff7a8a" opacity="0.3" />
        <path d="M45 53.5 C47.5 56.5 52.5 56.5 55 53.5" stroke="#1d1d24" strokeWidth="1.8" fill="none" strokeLinecap="round" />
        <Hair style={config.hairStyle} color={config.hairColor} />
        <Accessory style={config.accessory} />
      </svg>
    </div>
  );
}
