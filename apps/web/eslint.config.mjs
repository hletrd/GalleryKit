import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // C3-A5 / C3-COL-LOW-4: ignore underscore-prefixed unused variables and
  // discards. The privacy-field omission pattern in lib/data.ts uses
  // {latitude: _omitLatitude, ...rest} = adminSelectFields to enforce that
  // PII fields like GPS, original filenames, and admin-only HDR / pipeline
  // metadata are explicitly stripped from publicSelectFields. Each discard
  // previously carried an inline `eslint-disable-next-line` comment that
  // was formatter-fragile; the configured ignorePattern makes those
  // comments redundant. The underscore-prefix convention is the project's
  // existing discard marker (see _highBitdepthAvifProbePromise,
  // _cachedSupportsCanvasP3, _omitLatitudeAdmin, etc.).
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Playwright artifacts are generated on demand and may not exist.
    "test-results/**",
    "playwright-report/**",
  ]),
]);

export default eslintConfig;
