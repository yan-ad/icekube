import { defineTheme } from '@astryxdesign/core/theme';
import { neutralTheme } from '@astryxdesign/theme-neutral';

export const brandTheme = defineTheme({
  name: 'brand',
  extends: neutralTheme,

  typography: {
    body: {
      family: '-apple-system',
      fallbacks: 'Inter, BlinkMacSystemFont, sans-serif',
    },
    heading: {
      family: '-apple-system',
      fallbacks: 'Inter, BlinkMacSystemFont, sans-serif',
    },
    code: {
      family: 'ui-monospace',
      fallbacks: 'SFMono-Regular, Menlo, monospace',
    },
  },
});
