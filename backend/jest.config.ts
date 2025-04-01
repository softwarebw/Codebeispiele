import type {Config} from '@jest/types';

const config: Config.InitialOptions = {
    testTimeout: 30000,
    preset: 'ts-jest',
    testEnvironment: 'node',
};

export default config;
