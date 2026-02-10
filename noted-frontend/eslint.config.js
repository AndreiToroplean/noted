import { includeIgnoreFile } from '@eslint/compat';
import eslintJs from '@eslint/js';
import angular from 'angular-eslint';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import unusedImports from 'eslint-plugin-unused-imports';
import { defineConfig } from 'eslint/config';
import { fileURLToPath } from 'node:url';
import tseslint from 'typescript-eslint';

const gitignorePath = fileURLToPath(new URL('.gitignore', import.meta.url));

export default defineConfig([
  includeIgnoreFile(gitignorePath, 'Imported .gitignore patterns'),
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    extends: [
      eslintJs.configs.recommended,
      ...tseslint.configs.recommended,
      ...tseslint.configs.stylistic,
      ...angular.configs.tsRecommended,
      eslintPluginPrettierRecommended,
    ],
    processor: angular.processInlineTemplates,
    plugins: {
      'unused-imports': unusedImports,
    },
    rules: {
      '@angular-eslint/directive-selector': [
        'warn',
        {
          type: 'attribute',
          prefix: ['app', 'lz'],
          style: 'camelCase',
        },
      ],
      '@angular-eslint/component-selector': [
        'warn',
        {
          type: 'element',
          prefix: ['app', 'lz'],
          style: 'kebab-case',
        },
      ],
      'prettier/prettier': 'warn',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-confusing-non-null-assertion': 'off',
      '@typescript-eslint/no-inferrable-types': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-empty-function': 'warn',
      '@typescript-eslint/no-empty-object-type': 'warn',
      '@angular-eslint/component-class-suffix': 'warn',
      '@angular-eslint/no-empty-lifecycle-method': 'warn',
      'unused-imports/no-unused-imports': 'warn',
      'no-constant-condition': 'warn',
      'no-empty': 'warn',
    },
  },
  {
    files: ['**/*.html'],
    extends: [...angular.configs.templateRecommended, ...angular.configs.templateAccessibility],
    rules: {
      '@angular-eslint/template/elements-content': 'off',
    },
  },
]);
