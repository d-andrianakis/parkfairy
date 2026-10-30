import { baseConfig } from '@parkfairy/config/eslint/base';
import { noLiteralStrings } from '@parkfairy/config/eslint/i18n';

export default [...baseConfig(import.meta.dirname), noLiteralStrings(['src/components/**/*.tsx'])];
