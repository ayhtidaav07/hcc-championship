#!/usr/bin/env bash
export ELECTRON_RUN_AS_NODE=1
exec /usr/share/code/code --experimental-strip-types --loader ./scripts/ts-loader.mjs "$@"
