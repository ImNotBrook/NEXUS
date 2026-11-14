# Deployment

## Hosting target

NEXUS is a static Vite PWA. The deployment target is GitHub Pages, avoiding a backend, paid hosting, secrets, and billing activation. The Vite base path and PWA manifest are configured for the repository subpath `/NEXUS/`.

## One-time repository setting

In the GitHub repository, open **Settings → Pages → Build and deployment** and set **Source** to **GitHub Actions**. The repository connector used for this build can commit source files and inspect workflow runs, but it does not expose the Pages settings write operation needed to change this setting on the user's behalf.

## Automated deployment

After the Pages source is set to GitHub Actions, every push to `main` and every manual dispatch of `.github/workflows/deploy.yml` will:

1. Install the project dependencies with Node.js 22.
2. Run the Vitest suite.
3. Build the production PWA.
4. Upload `dist/` as a Pages artifact.
5. Deploy only if the test and build steps succeed.

The workflow URL is shown in the GitHub Actions run after deployment succeeds. Do not treat the site as deployed until the workflow reports success and the URL opens over HTTPS.

## Install on Android

Once deployed, open the Pages URL in Chrome on the Galaxy A55, use the browser menu, and choose **Install app** or **Add to Home screen** (the label depends on the Chrome version). The paper account is stored locally in that browser's IndexedDB. It does not sync to another device and can be lost if browser storage is cleared.

## Current deployment status

The latest verified GitHub Actions CI run passed the full test suite and production build. The Pages deployment run reported success for commit `36d35b47844111f2c9a78a4a78bf4f5562a5282d`.

**Live site:** https://imnotbrook.github.io/NEXUS/

No paid services, hosted database, exchange credentials or billing activation were introduced. The static app remains hosted on GitHub Pages; journal and paper-account data remain local to the browser/device.
