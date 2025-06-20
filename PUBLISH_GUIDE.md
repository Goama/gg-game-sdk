# Publishing Guide for gg-game-sdk

## Prerequisites

1. **Node.js and npm**: Ensure you have Node.js 12+ and npm installed
2. **NPM Account**: Create an account at [npmjs.com](https://www.npmjs.com)
3. **Git Repository**: Set up a repository on GitHub

## Setup Instructions

### 1. Initialize the Project

```bash
# Create project directory
mkdir gg-game-sdk
cd gg-game-sdk

# Initialize git
git init

# Copy all the provided files into the directory
# (package.json, src/index.ts, rollup.config.js, etc.)

# Install dependencies
npm install
```

### 2. Update package.json

Update the following fields in `package.json`:

```json
{
  "author": "Your Name <your.email@example.com>",
  "repository": {
    "type": "git",
    "url": "https://github.com/yourusername/gg-game-sdk.git"
  },
  "bugs": {
    "url": "https://github.com/yourusername/gg-game-sdk/issues"
  },
  "homepage": "https://github.com/yourusername/gg-game-sdk#readme"
}
```

### 3. Build and Test

```bash
# Run tests
npm test

# Build the package
npm run build

# Lint the code
npm run lint
```

### 4. Set Up GitHub Repository

```bash
# Add remote origin
git remote add origin https://github.com/yourusername/gg-game-sdk.git

# Add all files
git add .

# Commit
git commit -m "Initial commit: gg-game-sdk v1.0.0"

# Push to GitHub
git push -u origin main
```

### 5. Login to NPM

```bash
# Login to npm
npm login

# Verify login
npm whoami
```

### 6. Publish to NPM

```bash
# Dry run to check what will be published
npm publish --dry-run

# Publish to npm
npm publish
```

## Verification

After publishing, verify your package:

1. **Check on npmjs.com**: Visit `https://www.npmjs.com/package/gg-game-sdk`
2. **Test installation**: 
   ```bash
   # In a new directory
   npm install gg-game-sdk
   ```
3. **Test import**:
   ```javascript
   const ggSDK = require('gg-game-sdk');
   console.log(ggSDK);
   ```

## Publishing Updates

For future updates:

```bash
# Update version in package.json
npm version patch  # for bug fixes
npm version minor  # for new features
npm version major  # for breaking changes

# Build and test
npm run build
npm test

# Commit version bump
git add .
git commit -m "Bump version to X.X.X"
git push

# Publish update
npm publish
```

## Package Structure

Your final package structure should look like:

```
gg-game-sdk/
├── dist/                 # Built files (generated)
│   ├── index.js         # CommonJS build
│   ├── index.esm.js     # ES Module build
│   ├── index.umd.js     # UMD build
│   └── index.d.ts       # TypeScript definitions
├── src/
│   ├── index.ts         # Main source file
│   └── index.test.ts    # Tests
├── .eslintrc.js
├── .gitignore
├── babel.config.js
├── jest.config.js
├── LICENSE
├── package.json
├── README.md
├── rollup.config.js
└── tsconfig.json
```

## Build Outputs

The build process creates multiple formats:

- **dist/index.js**: CommonJS for Node.js
- **dist/index.esm.js**: ES Modules for modern bundlers
- **dist/index.umd.js**: UMD for browser script tags
- **dist/index.d.ts**: TypeScript definitions

## Usage Examples

Once published, users can install and use your package:

```bash
npm install gg-game-sdk
```

```javascript
// ES6
import ggSDK from 'gg-game-sdk';

// CommonJS
const ggSDK = require('gg-game-sdk');

// Browser (UMD) - Multiple access methods
<script src="https://unpkg.com/gg-game-sdk"></script>
<script>
  GGSDK.gameOver(100);        // Global UMD
  window.GGSDK.gameOver(100); // Window property  
</script>
```

## Troubleshooting

**Package name taken**: If `gg-game-sdk` is already taken, try:
- `@yourname/gg-game-sdk` (scoped package)
- `gg-game-sdk-js`
- `goama-game-sdk`

**Build errors**: Ensure all dependencies are installed:
```bash
npm install
```

**Permission errors**: Make sure you're logged into npm:
```bash
npm login
```

**TypeScript errors**: Check your tsconfig.json and ensure TypeScript is installed:
```bash
npm install -D typescript
```

## Best Practices

1. **Semantic Versioning**: Follow semver (major.minor.patch)
2. **Changelog**: Keep a CHANGELOG.md for version history
3. **Tests**: Maintain good test coverage
4. **Documentation**: Keep README.md updated
5. **License**: Include appropriate license (MIT recommended)

## Support

For issues with the publishing process:
- Check [npm docs](https://docs.npmjs.com/)
- Visit [npm support](https://www.npmjs.com/support)
- Check GitHub Actions for CI/CD automation