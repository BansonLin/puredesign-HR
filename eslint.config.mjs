// ESLint 9 flat config.
//
// eslint-config-next@15.5.x still ships an eslintrc-style config (`extends`),
// which needs @eslint/eslintrc's FlatCompat to load. PLAN 5.2 rules out
// @eslint/eslintrc, so this file composes the equivalent of
// `next/core-web-vitals` + `next/typescript` from the flat configs the
// underlying plugins export. The plugins are resolved through
// eslint-config-next's own dependency tree (they are its declared
// dependencies), so no package outside the PLAN §5 whitelist is added and
// pnpm's strict node_modules is respected.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const nextConfigRequire = createRequire(
  require.resolve("eslint-config-next/package.json"),
);

const nextPlugin = nextConfigRequire("@next/eslint-plugin-next");
const tsPlugin = nextConfigRequire("@typescript-eslint/eslint-plugin");
const tsParser = nextConfigRequire("@typescript-eslint/parser");
const reactPlugin = nextConfigRequire("eslint-plugin-react");
const reactHooksPlugin = nextConfigRequire("eslint-plugin-react-hooks");
const jsxA11yPlugin = nextConfigRequire("eslint-plugin-jsx-a11y");
const importPlugin = nextConfigRequire("eslint-plugin-import");

const eslintConfig = [
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "coverage/**",
      "test-results/**",
      "playwright-report/**",
      "next-env.d.ts",
    ],
  },
  // next/core-web-vitals
  nextPlugin.flatConfig.coreWebVitals,
  reactPlugin.configs.flat.recommended,
  reactPlugin.configs.flat["jsx-runtime"],
  {
    plugins: {
      "react-hooks": reactHooksPlugin,
      "jsx-a11y": jsxA11yPlugin,
      import: importPlugin,
    },
    settings: {
      react: { version: "detect" },
    },
    rules: {
      ...reactHooksPlugin.configs.recommended.rules,
      "import/no-anonymous-default-export": "warn",
      "react/no-unknown-property": "off",
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      "jsx-a11y/alt-text": ["warn", { elements: ["img"], img: ["Image"] }],
      "jsx-a11y/aria-props": "warn",
      "jsx-a11y/aria-proptypes": "warn",
      "jsx-a11y/aria-unsupported-elements": "warn",
      "jsx-a11y/role-has-required-aria-props": "warn",
      "jsx-a11y/role-supports-aria-props": "warn",
      "react/jsx-no-target-blank": "off",
    },
  },
  // next/typescript
  ...tsPlugin.configs["flat/recommended"].map((config) => ({
    ...config,
    files: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"],
  })),
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { sourceType: "module" },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": "warn",
      "@typescript-eslint/no-unused-expressions": "warn",
    },
  },
];

export default eslintConfig;
