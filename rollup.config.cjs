const typescript = require('@rollup/plugin-typescript');
const { nodeResolve } = require('@rollup/plugin-node-resolve');
const { babel } = require('@rollup/plugin-babel');
const terser = require('@rollup/plugin-terser');

const production = !process.env.ROLLUP_WATCH;

module.exports = [
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
        importHelpers: false,
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
        importHelpers: false,
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
        importHelpers: false,
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