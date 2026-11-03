#!/bin/sh
# Vercel "Ignored Build Step": exit 0 = SKIP the build, exit 1 = BUILD. (vercel.json limits ignoreCommand to 256 characters, hence a script.)
#  - never build previews (storage / ISR budget on the Hobby plan; CI runs the real compile check);
#  - production: build unless NOTHING outside docs, *.md, tests and .github changed since the LAST DEPLOYED commit
#    (comparing against the previous deployment, not just HEAD^, so a multi-commit push cannot skip a code change);
#  - whenever the comparison cannot be made (no previous SHA, SHA not in the clone) BUILD.
if [ "$VERCEL_ENV" != "production" ]; then exit 0; fi
[ -n "$VERCEL_GIT_PREVIOUS_SHA" ] || exit 1
git cat-file -e "$VERCEL_GIT_PREVIOUS_SHA" 2>/dev/null || exit 1
git diff --quiet "$VERCEL_GIT_PREVIOUS_SHA" HEAD -- . ':(exclude)docs' ':(exclude)*.md' ':(exclude)src/__tests__' ':(exclude).github'
