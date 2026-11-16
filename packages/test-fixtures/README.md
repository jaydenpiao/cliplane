# Synthetic fixtures

`nightdrift-original.mp4` is an original 24-second procedural animation with generated
engine audio. No game footage, game assets, voice, music or third-party imagery is used.
The visible overlay identifies it as an original demo. It is distributed under the
repository's Apache-2.0 license. The demo reproduction bundle includes its generator.

`npm run seed` loops this input and varies its hue to create three explicitly synthetic
65-second sample recordings. It probes and analyzes the actual files. Existing sources
are preserved; seeding never overwrites an uploaded original or silently replaces media.

`ranking-labels.json` is a synthetic evaluation fixture, not a creator-quality benchmark.
