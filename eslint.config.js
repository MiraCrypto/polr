import antfu from '@antfu/eslint-config'

export default antfu(
  {
    typescript: true,
    isInEditor: false,
    ignores: [
      'public/**',
      'dist/**',
    ],
  },
  {
    rules: {
      'dot-notation': 'off',
      'ts/dot-notation': 'off',
      'node/prefer-global/process': 'off',
      'pnpm/yaml-enforce-settings': 'off',
    },
  },
)
