---
name: Workspace package installs
description: Install dependencies into the intended package in this pnpm monorepo.
---

The generic language-package installer runs package adds at the workspace root and does not support targeting a specific artifact. For artifact-only dependencies, use the package's pnpm workspace filter so the dependency is recorded in that artifact's `package.json` and importer in the lockfile.

**Why:** The repository root is a workspace container, not a package target; a root add can be rejected or change project-level configuration when the dependency belongs only to one artifact.

**How to apply:** Use `pnpm --filter @workspace/<slug> add -D <package>` for app-specific development dependencies. Keep the package in the artifact manifest rather than adding it to the workspace root.
