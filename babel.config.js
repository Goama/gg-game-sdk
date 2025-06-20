module.exports = {
    presets: [
      [
        '@babel/preset-env',
        {
          targets: {
            browsers: ['> 1%', 'last 2 versions', 'not dead', 'IE 11'],
            node: '12',
          },
          modules: false,
        },
      ],
      '@babel/preset-typescript',
    ],
    env: {
      test: {
        presets: [
          [
            '@babel/preset-env',
            {
              targets: {
                node: 'current',
              },
            },
          ],
          '@babel/preset-typescript',
        ],
      },
    },
  };