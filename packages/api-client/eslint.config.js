import { baseConfig } from '@parkfairy/config/eslint/base';

export default [...baseConfig(import.meta.dirname), { ignores: ['src/generated/**'] }];
