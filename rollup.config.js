import typescript from '@rollup/plugin-typescript';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import { babel } from '@rollup/plugin-babel';
import { terser } from '@rollup/plugin-terser';

const production = !process.env.ROLLUP_WATCH;

export default [
  // ES Module build
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/index.esm.js',
      format: 'es',
      sourcemap: true,
    },
    plugins: [
      nodeResolve(),
      typescript({
        declaration: true,
        declarationDir: 'dist',
        rootDir: 'src',
      }),
      production && terser(),
    ].filter(Boolean),
  },
  // CommonJS build
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/index.js',
      format: 'cjs',
      sourcemap: true,
      exports: 'named',
    },
    plugins: [
      nodeResolve(),
      typescript({
        declaration: false,
      }),
      babel({
        babelHelpers: 'bundled',
        presets: [
          [
            '@babel/preset-env',
            {
              targets: {
                ie: '11',
                node: '12',
              },
            },
          ],
        ],
        exclude: 'node_modules/**',
      }),
      production && terser(),
    ].filter(Boolean),
  },
  // UMD build for browsers
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/index.umd.js',
      format: 'umd',
      name: 'GGSDK',
      sourcemap: true,
    },
    plugins: [
      nodeResolve(),
      typescript({
        declaration: false,
      }),
      babel({
        babelHelpers: 'bundled',
        presets: [
          [
            '@babel/preset-env',
            {
              targets: {
                browsers: ['> 1%', 'last 2 versions', 'not dead', 'IE 11'],
              },
            },
          ],
        ],
        exclude: 'node_modules/**',
      }),
      production && terser(),
    ].filter(Boolean),
  },
];