import antfu from '@antfu/eslint-config'
import eslintConfigPrettier from 'eslint-config-prettier'

export default antfu(
  {
    ignores: [
      'node_modules',
      'dist',
      '.next',
      '.turbo',
      '**/.turbo',
      'coverage',
      '**/src/infra/db/migrations/meta/*.json',
      '**/*.md',
    ],
    typescript: true,
    formatters: false,
    markdown: false,
    node: false,
    rules: {
      'node/prefer-global/process': 'off',
      'node/prefer-global/buffer': 'off',
      'antfu/if-newline': 'off',
      'antfu/consistent-list-newline': 'off',
      'antfu/no-top-level-await': 'off',
      'import/consistent-type-specifier-style': 'off',
      'jsonc/sort-keys': 'off',
      'no-alert': 'off',
      'no-console': 'off',
      'perfectionist/sort-imports': 'off',
      'perfectionist/sort-named-imports': 'off',
      'pnpm/json-enforce-catalog': 'off',
      'pnpm/yaml-enforce-settings': 'off',
      'regexp/use-ignore-case': 'off',
      'ts/consistent-type-definitions': 'off',
      'yaml/quotes': 'off',
    },
  },
  eslintConfigPrettier,
)
