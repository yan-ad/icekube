import { defineTheme } from '@astryxdesign/core/theme';
import { neutralTheme } from '@astryxdesign/theme-neutral';
import { palette, white } from './azure/azure.palette';

export const brandTheme = defineTheme({
  name: 'brand',
  extends: neutralTheme,

  tokens: {
    '--color-accent': [palette.azure.light[40], palette.azure.dark[70]],
    '--color-on-accent': [white, palette.azure.dark[5]],
    '--color-accent-muted': [palette.azure.light[95], palette.azure.dark[15]],
    '--color-text-accent': [palette.azure.light[35], palette.azure.dark[75]],
    '--color-icon-accent': [palette.azure.light[35], palette.azure.dark[75]],
  },

  localTokens: {
    '--color-log-background': '#000000',
    '--color-log-text': '#f5f5f5',
    '--color-log-match-background': '#facc15',
    '--color-log-match-text': '#000000',
  },

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
