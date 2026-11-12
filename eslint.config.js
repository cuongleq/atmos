import js from '@eslint/js';
import typescriptEslint from 'typescript-eslint';

export default [
  {
    ignores: ['node_modules', 'dist', 'raw', '*.log', '*.json', '*.config.*', '*.mjs', '*.js', 'src/engine', 'data-ingestion', 'src/app', 'src/monitoring'],
  },
  ...typescriptEslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: typescriptEslint.parser,
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: process.cwd(),
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { 'argsIgnorePattern': '^_', 'varsIgnorePattern': '^_' }],
      'curly': 'error',
      '@typescript-eslint/no-floating-promises': 'warn',
      'no-var': 'error',
      'prefer-const': 'error',
      'eqeqeq': ['error', 'always', { 'null': 'ignore' }],
      'no-duplicate-imports': 'error',
    },
  },
];