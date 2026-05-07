// Shared tab group color constants and utilities

export type AllowedColor = 'grey' | 'blue' | 'red' | 'yellow' | 'green' | 'pink' | 'purple' | 'cyan' | 'orange';
export const GROUP_COLOR_EMOJI: Record<AllowedColor, string> = {
  grey:   '⚫',
  blue:   '🔵',
  red:    '🔴',
  yellow: '🟡',
  green:  '🟢',
  pink:   '🩷',
  purple: '🟣',
  cyan:   '🩵',
  orange: '🟠',
};

export const GROUP_COLOR_HEX: Record<AllowedColor, string> = {
  grey:   '#dadce0',
  blue:   '#4285f4',
  red:    '#ea4335',
  yellow: '#fbbc04',
  green:  '#34a853',
  pink:   '#ff63b8',
  purple: '#a142f4',
  cyan:   '#24c1e0',
  orange: '#fa903e',
};

// Reverse mapping: emoji to color name
export const EMOJI_TO_COLOR: Record<string, AllowedColor> = Object.fromEntries(
  Object.entries(GROUP_COLOR_EMOJI).map(([color, emoji]) => [emoji, color as AllowedColor])
);

export interface GroupNameWithColor {
  color?: AllowedColor;
  name: string;
}
/** Parse color emoji and name from a bookmark folder title. Returns color and clean name. */
export function parseGroupNameWithColor(title: string): GroupNameWithColor {
  // Use spread operator to correctly parse unicode emojis which occupy multiple code points in a JS string
  const firstChar = [...title][0];
  if (firstChar && EMOJI_TO_COLOR[firstChar]) {
    return { color: EMOJI_TO_COLOR[firstChar], name: title.slice(firstChar.length).trim() };
  }
  return { name: title };
}

/** Format tab group name with color emoji prefix. */
export function formatGroupNameWithColor(name: string, color?: AllowedColor): string {
  const emoji = color ? GROUP_COLOR_EMOJI[color] : '';
  return emoji ? `${emoji} ${name}` : name;
}
