# Media context

Read root AGENTS.md. Python workers are stateless and receive no DB credentials.
Keep FFmpeg arguments declarative, bounded and local-only; preserve source timestamps.
Validate edits before output and probe temporary renders before atomic replacement.
Use original synthetic fixtures; inspect real output with ffprobe and sampled frames.
Run npm run test:media and npm run check:python. Update media contracts and related tests together.
