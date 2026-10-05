/**
 * Semantic design tokens for the mobile app.
 *
 * These tokens mirror the naming conventions used in web artifacts (index.css)
 * so that multi-artifact projects share a cohesive visual identity.
 *
 * Replace the placeholder values below with values that match the project's
 * brand. If a sibling web artifact exists, read its index.css and convert the
 * HSL values to hex so both artifacts use the same palette.
 *
 * To add dark mode, add a `dark` key with the same token names.
 * The useColors() hook will automatically pick it up.
 */

const colors = {
  light: {
    text: '#1e2421',
    tint: '#d94e39',
    background: '#f3f0e9',
    foreground: '#1e2421',
    card: '#fcfaf5',
    cardForeground: '#1e2421',
    primary: '#d94e39',
    primaryForeground: '#fffaf4',
    secondary: '#e7e2d9',
    secondaryForeground: '#353b36',
    muted: '#ebe7df',
    mutedForeground: '#777b73',
    accent: '#d9e9df',
    accentForeground: '#2e5846',
    destructive: '#bf3f37',
    destructiveForeground: '#ffffff',
    border: '#ded9cf',
    input: '#ded9cf',
  },
  dark: {
    text: '#f4f1e9',
    tint: '#ff7860',
    background: '#111715',
    foreground: '#f4f1e9',
    card: '#1b2421',
    cardForeground: '#f4f1e9',
    primary: '#ff7860',
    primaryForeground: '#241814',
    secondary: '#29332f',
    secondaryForeground: '#e7eae3',
    muted: '#202a26',
    mutedForeground: '#a2aea7',
    accent: '#273d34',
    accentForeground: '#c6ead6',
    destructive: '#e05d50',
    destructiveForeground: '#ffffff',
    border: '#35413b',
    input: '#35413b',
  },

  radius: 18,
};

export default colors;
