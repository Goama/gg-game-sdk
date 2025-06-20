# Automated Publishing with GitHub Actions

This guide shows you how to set up automated version management and publishing using GitHub Actions workflows.

## 🚀 Setup Steps

### 1. Repository Setup

```bash
# Push your code to GitHub
git add .
git commit -m "Initial commit: gg-game-sdk with automated workflows"
git push origin main
```

### 2. Configure NPM Token

1. **Get NPM Token:**
   ```bash
   npm login
   npm token create --read-only=false
   ```

2. **Add to GitHub Secrets:**
   - Go to your GitHub repository
   - Settings → Secrets and variables → Actions
   - Click "New repository secret"
   - Name: `NPM_TOKEN`
   - Value: Your NPM token

### 3. Workflow Files Structure

```
.github/
└── workflows/
    ├── ci-cd.yml      # Main CI/CD pipeline
    └── release.yml    # Manual release workflow
```

## 🔄 Automated Workflows

### CI/CD Pipeline (`ci-cd.yml`)

**Triggers:**
- ✅ Push to `main` or `develop` branches
- ✅ Pull requests to `main`
- ✅ GitHub releases

**Jobs:**
1. **Test** - Runs on Node 16, 18, 20
2. **Build** - Creates distribution files
3. **Publish NPM** - Publishes to npm (on release)
4. **Publish GPR** - Publishes to GitHub Packages (on release)

### Release Workflow (`release.yml`)

**Manual Trigger:**
- Go to Actions tab → "Release" workflow → "Run workflow"
- Choose version type: `patch`, `minor`, `major`, or `prerelease`

**What it does:**
1. ✅ Runs tests and builds
2. ✅ Bumps version in package.json
3. ✅ Updates CHANGELOG.md
4. ✅ Creates git commit and tag
5. ✅ Creates GitHub release
6. ✅ Triggers automatic NPM publishing

## 📦 Publishing Options

### Option 1: Manual Release (Recommended)

```bash
# Go to GitHub → Actions → Release → Run workflow
# Select version type (patch/minor/major)
# Click "Run workflow"
```

### Option 2: Git Tag Release

```bash
# Create and push a tag
git tag v1.0.1
git push origin v1.0.1

# This automatically triggers publishing
```

### Option 3: GitHub Release

1. Go to GitHub → Releases → "Create a new release"
2. Choose a tag (or create new): `v1.0.1`
3. Generate release notes
4. Click "Publish release"

## 🏷️ Version Management

### Semantic Versioning

- **Patch** (`1.0.0` → `1.0.1`): Bug fixes
- **Minor** (`1.0.0` → `1.1.0`): New features
- **Major** (`1.0.0` → `2.0.0`): Breaking changes
- **Prerelease** (`1.0.0` → `1.1.0-alpha.0`): Beta versions

### Version Bump Examples

```bash
# Manual version bump (if needed)
npm version patch   # 1.0.0 → 1.0.1
npm version minor   # 1.0.0 → 1.1.0  
npm version major   # 1.0.0 → 2.0.0
npm version prerelease --preid=alpha  # 1.0.0 → 1.0.1-alpha.0
```

## 🔍 Monitoring

### Build Status

Check the "Actions" tab in your GitHub repository:
- ✅ Green checkmark = Success
- ❌ Red X = Failed
- 🟡 Yellow circle = In progress

### NPM Package Status

```bash
# Check published versions
npm view gg-game-sdk versions --json

# Check latest version
npm view gg-game-sdk version
```

## 🛠️ Workflow Features

### Security Features
- ✅ Runs tests before publishing
- ✅ Uses GitHub secrets for tokens
- ✅ Only publishes on release events
- ✅ Multi-node version testing

### Publishing Features
- ✅ Publishes to both NPM and GitHub Packages
- ✅ Automatic version tagging
- ✅ Generates release notes
- ✅ Updates changelog
- ✅ Creates build artifacts

### Development Features
- ✅ Linting on every push
- ✅ Testing on multiple Node versions
- ✅ Build verification
- ✅ Code coverage reporting

## 🐛 Troubleshooting

### Publishing Fails

1. **Check NPM token:**
   ```bash
   npm whoami  # Should show your username
   ```

2. **Verify secrets:**
   - GitHub → Settings → Secrets → Check `NPM_TOKEN`

3. **Check package name:**
   - Ensure `gg-game-sdk` is available on npm
   - Or use scoped name: `@yourusername/gg-game-sdk`

### Build Fails

1. **Check logs in Actions tab**
2. **Run locally:**
   ```bash
   npm ci
   npm test
   npm run build
   ```

### Version Conflicts

```bash
# Reset to last good state
git reset --hard HEAD~1
git push --force origin main

# Or manually fix version
npm version 1.0.0 --no-git-tag-version
```

## 📋 Release Checklist

Before releasing:
- ✅ All tests pass locally
- ✅ Documentation is updated
- ✅ CHANGELOG notes are ready
- ✅ No sensitive data in code
- ✅ Build works locally

## 🎯 Benefits

✅ **No manual publishing** - Everything automated  
✅ **Version consistency** - Git tags match npm versions  
✅ **Quality gates** - Tests must pass before publishing  
✅ **Release notes** - Auto-generated changelogs  
✅ **Multi-registry** - Publishes to npm + GitHub  
✅ **Rollback friendly** - Easy to revert releases  

SDK is now ready for professional automated publishing! 🚀