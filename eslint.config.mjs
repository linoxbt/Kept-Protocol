import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // The rule the architecture encodes: verification can never depend on AI.
    files: ["src/core/**/*.ts", "src/receipts/**/*.ts", "src/chain/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["@/serv/*", "@/serv", "../serv/*", "@/extraction/*", "@/services/*"], message: "src/core, src/receipts and src/chain must not import SERV, extraction or services code." },
          ],
        },
      ],
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "coverage/**"]),
]);

export default eslintConfig;
